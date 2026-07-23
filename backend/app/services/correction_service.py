from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    CorrectionPackage,
    CorrectionPart,
    Scenario,
    Story,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.schemas.common import ActionRef, CommandAck, ResourceRef
from app.schemas.corrections import (
    CompletionAction,
    CorrectionActionRef,
    CorrectionPackageRef,
    CorrectionPackagesResponse,
    CorrectionPartRef,
    CorrectionSummaryRef,
)
from app.schemas.stories import UserRef
from app.services.permissions import (
    can_close_correction_package,
    can_complete_correction_part,
    can_create_correction_package,
    can_return_correction_part,
)
from app.services.notification_service import (
    notify_correction_package_created,
    notify_correction_part_completed,
)


CORRECTION_SCOPES = frozenset({"text", "video", "titles", "voiceover"})
CorrectionSource = Literal["internal", "external"]


@dataclass(frozen=True)
class CorrectionPartInput:
    scope: str
    description: str
    assignee_user_id: int


@dataclass(frozen=True)
class CorrectionContext:
    story: Story
    scenario: Scenario
    workflow: StoryWorkflowState
    production: StoryProductionState


def _error(code: str, message: str, http_status: int = status.HTTP_409_CONFLICT) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def _user_ref(user: User | None) -> UserRef | None:
    if user is None:
        return None
    return UserRef(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        position=user.position,
        function_codes=user.function_codes,
    )


def _context(db: Session, *, story_id: int, for_update: bool) -> CorrectionContext:
    story = db.get(Story, story_id)
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)

    scenario_query = select(Scenario).where(Scenario.story_id == story_id)
    workflow_query = select(StoryWorkflowState).where(StoryWorkflowState.story_id == story_id)
    production_query = select(StoryProductionState).where(StoryProductionState.story_id == story_id)
    if for_update:
        scenario_query = scenario_query.with_for_update()
        workflow_query = workflow_query.with_for_update()
        production_query = production_query.with_for_update()
    scenario = db.scalar(scenario_query)
    workflow = db.scalar(workflow_query)
    production = db.scalar(production_query)
    if scenario is None or workflow is None or production is None:
        raise _error("INVALID_TRANSITION", "Состояние сюжета не создано")
    return CorrectionContext(
        story=story,
        scenario=scenario,
        workflow=workflow,
        production=production,
    )


def _require_mutable(context: CorrectionContext) -> None:
    if context.story.archived_at is not None:
        raise _error("STORY_ARCHIVED", "Архивный сюжет нельзя изменять")


def _load_package_parts(
    db: Session,
    *,
    story_id: int,
    package_id: int,
    for_update: bool,
) -> tuple[CorrectionPackage, list[CorrectionPart]]:
    package_query = select(CorrectionPackage).where(
        CorrectionPackage.id == package_id,
        CorrectionPackage.story_id == story_id,
    )
    if for_update:
        package_query = package_query.with_for_update()
    package = db.scalar(package_query)
    if package is None:
        raise _error(
            "CORRECTION_PACKAGE_NOT_FOUND",
            "Пакет правок не найден",
            status.HTTP_404_NOT_FOUND,
        )
    parts_query = (
        select(CorrectionPart)
        .where(CorrectionPart.package_id == package_id)
        .order_by(CorrectionPart.id.asc())
    )
    if for_update:
        parts_query = parts_query.with_for_update()
    return package, list(db.execute(parts_query).scalars())


def _load_users(db: Session, user_ids: set[int | None]) -> dict[int, User]:
    actual_ids = {user_id for user_id in user_ids if user_id is not None}
    if not actual_ids:
        return {}
    return {
        user.id: user
        for user in db.execute(select(User).where(User.id.in_(actual_ids))).scalars().all()
    }


def _record_event(
    db: Session,
    *,
    story_id: int,
    revision_no: int,
    actor: User,
    event_code: str,
    now: datetime,
    payload: dict[str, object],
) -> StoryEvent:
    event = StoryEvent(
        story_id=story_id,
        event_code=event_code,
        actor_user_id=actor.id,
        revision_no=revision_no,
        payload=payload,
        created_at=now,
    )
    db.add(event)
    db.flush()
    return event


def _ack(
    db: Session,
    *,
    event: StoryEvent,
    changed_at: datetime,
    resource_type: str,
    resource_id: int,
) -> CommandAck:
    db.commit()
    return CommandAck(
        event_id=str(event.id),
        changed_at=changed_at,
        resource=ResourceRef(type=resource_type, id=resource_id),
    )


def reset_production_for_correction_scope(
    production: StoryProductionState,
    scope: str,
) -> None:
    if scope == "video":
        production.video_ready_by_user_id = None
        production.video_ready_at = None
        production.video_approved_for_titles_by_user_id = None
        production.video_approved_for_titles_at = None
    elif scope == "titles":
        production.titles_ready_by_user_id = None
        production.titles_ready_at = None
        production.titles_accepted_by_user_id = None
        production.titles_accepted_at = None
    elif scope == "voiceover":
        production.voiceover_ready = False
        production.voiceover_ready_by_user_id = None
        production.voiceover_ready_at = None


def _normalized_parts(parts: list[CorrectionPartInput]) -> list[CorrectionPartInput]:
    if not parts:
        raise _error(
            "CORRECTION_PARTS_REQUIRED",
            "Добавьте хотя бы одну часть пакета",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    normalized: list[CorrectionPartInput] = []
    for part in parts:
        if part.scope not in CORRECTION_SCOPES:
            raise _error(
                "CORRECTION_SCOPE_INVALID",
                "Область правки не поддерживается",
                status.HTTP_422_UNPROCESSABLE_CONTENT,
            )
        description = part.description.strip()
        if not description:
            raise _error(
                "VALIDATION_ERROR",
                "Описание правки обязательно",
                status.HTTP_422_UNPROCESSABLE_CONTENT,
            )
        normalized.append(
            CorrectionPartInput(
                scope=part.scope,
                description=description,
                assignee_user_id=part.assignee_user_id,
            )
        )

    return normalized


def _validate_assignees(
    db: Session,
    parts: list[CorrectionPartInput],
) -> dict[int, User]:
    assignee_ids = sorted({part.assignee_user_id for part in parts})
    users = list(
        db.execute(
            select(User).where(User.id.in_(assignee_ids)).order_by(User.id.asc()).with_for_update()
        ).scalars()
    )
    users_by_id = {user.id: user for user in users}
    if any(
        part.assignee_user_id not in users_by_id
        or not users_by_id[part.assignee_user_id].is_active
        for part in parts
    ):
        raise _error(
            "ASSIGNEE_INVALID",
            "Ответственный за правку недоступен",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    return users_by_id


def create_correction_package_rows(
    db: Session,
    *,
    story_id: int,
    revision_no: int,
    production: StoryProductionState,
    actor: User,
    source: CorrectionSource,
    parts: list[CorrectionPartInput],
    now: datetime,
    event_code: str = "correction_package_created",
) -> tuple[CorrectionPackage, StoryEvent]:
    if source == "internal" and len(parts) > 1:
        raise _error(
            "INTERNAL_CORRECTION_ONE_PART_REQUIRED",
            "Внутренний пакет содержит ровно одну часть",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    normalized = _normalized_parts(parts)
    _validate_assignees(db, normalized)
    package = CorrectionPackage(
        story_id=story_id,
        source=source,
        created_by_user_id=actor.id,
        created_at=now,
    )
    db.add(package)
    db.flush()
    rows = [
        CorrectionPart(
            package_id=package.id,
            scope=part.scope,
            description=part.description,
            assignee_user_id=part.assignee_user_id,
            state="pending",
        )
        for part in normalized
    ]
    db.add_all(rows)
    db.flush()
    for scope in {part.scope for part in normalized}:
        reset_production_for_correction_scope(production, scope)
    event = _record_event(
        db,
        story_id=story_id,
        revision_no=revision_no,
        actor=actor,
        event_code=event_code,
        now=now,
        payload={
            "package_id": package.id,
            "source": source,
            "parts": [
                {
                    "part_id": row.id,
                    "scope": row.scope,
                    "assignee_user_id": row.assignee_user_id,
                }
                for row in rows
            ],
        },
    )
    story = db.get(Story, story_id)
    assert story is not None
    notify_correction_package_created(
        db,
        story=story,
        actor=actor,
        package=package,
        parts=rows,
        now=now,
    )
    return package, event


def create_correction_package(
    db: Session,
    *,
    story_id: int,
    actor: User,
    source: CorrectionSource,
    parts: list[CorrectionPartInput],
) -> tuple[CorrectionPackage, StoryEvent, datetime]:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    if not can_create_correction_package(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    now = datetime.now(UTC)
    package, event = create_correction_package_rows(
        db,
        story_id=story_id,
        revision_no=context.scenario.revision_no,
        production=context.production,
        actor=actor,
        source=source,
        parts=parts,
        now=now,
    )
    return package, event, now


def create_correction_package_command(
    db: Session,
    *,
    story_id: int,
    actor: User,
    source: Literal["internal"],
    parts: list[CorrectionPartInput],
) -> CommandAck:
    package, event, now = create_correction_package(
        db,
        story_id=story_id,
        actor=actor,
        source=source,
        parts=parts,
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="correction_package",
        resource_id=package.id,
    )


def _correction_action(
    *,
    story_id: int,
    package_id: int,
    code: str,
    label: str,
    path: str,
    part: CorrectionPart | None = None,
    form: str | None = None,
) -> CorrectionActionRef:
    return CorrectionActionRef(
        code=code,
        label=label,
        method="POST",
        href=f"/api/v1/stories/{story_id}/correction-packages/{package_id}/{path}",
        form=form,
        part_id=part.id if part is not None else None,
        part_scope=part.scope if part is not None else None,
    )


def _completion_label(scope: str) -> str:
    if scope == "video":
        return "Правки выполнены — ролик готов"
    if scope == "titles":
        return "Правки выполнены — титры готовы"
    if scope == "voiceover":
        return "Правка озвучки выполнена"
    return "Правка текста выполнена"


def _completion_action_blocker(
    *,
    completion_action: CompletionAction,
    workflow: StoryWorkflowState,
    production: StoryProductionState,
) -> tuple[str, str] | None:
    if completion_action == "video_ready" and production.video_started_at is None:
        return "VIDEO_NOT_STARTED", "Монтаж ещё не начат"
    if completion_action == "titles_ready":
        if production.titles_started_at is None:
            return "TITLES_NOT_STARTED", "Работа над титрами ещё не начата"
        titles_gate = (
            workflow.editorial_revision is not None
            and workflow.proofread_revision is not None
            and production.video_approved_for_titles_at is not None
        )
        if not titles_gate:
            return "TITLES_INITIAL_GATE_NOT_MET", "Первоначальный допуск к титрам не выполнен"
    return None


def _completion_action_for_scope(scope: str) -> CompletionAction:
    if scope == "video":
        return "video_ready"
    if scope == "titles":
        return "titles_ready"
    return "none"


def _package_actions(
    *,
    actor: User,
    story: Story,
    workflow: StoryWorkflowState,
    production: StoryProductionState,
    package: CorrectionPackage,
    parts: list[CorrectionPart],
) -> tuple[CorrectionActionRef | None, list[CorrectionActionRef]]:
    if story.archived_at is not None or package.closed_at is not None:
        return None, []

    actions: list[CorrectionActionRef] = []
    all_complete = bool(parts) and all(part.state == "done" for part in parts)
    if all_complete and can_close_correction_package(actor):
        actions.append(
            _correction_action(
                story_id=story.id,
                package_id=package.id,
                code="correction_package_close",
                label="Закрыть пакет правок",
                path="close",
            )
        )
    for part in parts:
        if part.state == "pending" and can_complete_correction_part(
            actor, assignee_user_id=part.assignee_user_id
        ):
            completion_action = _completion_action_for_scope(part.scope)
            if _completion_action_blocker(
                completion_action=completion_action,
                workflow=workflow,
                production=production,
            ) is not None:
                continue
            actions.append(
                _correction_action(
                    story_id=story.id,
                    package_id=package.id,
                    code="correction_part_complete",
                    label=_completion_label(part.scope),
                    path=f"parts/{part.id}/complete",
                    part=part,
                )
            )
    if can_return_correction_part(actor):
        for part in parts:
            if part.state == "done":
                actions.append(
                    _correction_action(
                        story_id=story.id,
                        package_id=package.id,
                        code="correction_part_return",
                        label="Вернуть часть в работу",
                        path=f"parts/{part.id}/return",
                        part=part,
                        form="return_reason",
                    )
                )
    if not actions:
        return None, []
    return actions[0].model_copy(update={"emphasis": "primary"}), actions[1:]


def get_correction_packages(
    db: Session,
    *,
    story_id: int,
    actor: User,
) -> CorrectionPackagesResponse:
    context = _context(db, story_id=story_id, for_update=False)
    packages = list(
        db.execute(
            select(CorrectionPackage)
            .where(CorrectionPackage.story_id == story_id)
            .order_by(CorrectionPackage.created_at.desc(), CorrectionPackage.id.desc())
        ).scalars()
    )
    package_ids = [package.id for package in packages]
    parts = list(
        db.execute(
            select(CorrectionPart)
            .where(CorrectionPart.package_id.in_(package_ids or [-1]))
            .order_by(CorrectionPart.package_id.asc(), CorrectionPart.id.asc())
        ).scalars()
    )
    parts_by_package: dict[int, list[CorrectionPart]] = {package_id: [] for package_id in package_ids}
    for part in parts:
        parts_by_package.setdefault(part.package_id, []).append(part)
    users = _load_users(
        db,
        {
            *(package.created_by_user_id for package in packages),
            *(package.closed_by_user_id for package in packages),
            *(part.assignee_user_id for part in parts),
            *(part.completed_by_user_id for part in parts),
        },
    )

    items: list[CorrectionPackageRef] = []
    for package in packages:
        package_parts = parts_by_package.get(package.id, [])
        all_complete = bool(package_parts) and all(part.state == "done" for part in package_parts)
        primary, additional = _package_actions(
            actor=actor,
            story=context.story,
            workflow=context.workflow,
            production=context.production,
            package=package,
            parts=package_parts,
        )
        items.append(
            CorrectionPackageRef(
                id=package.id,
                source=package.source,
                created_by=_user_ref(users[package.created_by_user_id]),  # type: ignore[arg-type]
                created_at=package.created_at,
                parts=[
                    CorrectionPartRef(
                        id=part.id,
                        scope=part.scope,
                        description=part.description,
                        assignee=_user_ref(users[part.assignee_user_id]),  # type: ignore[arg-type]
                        state=part.state,
                        completed_by=_user_ref(users.get(part.completed_by_user_id or -1)),
                        completed_at=part.completed_at,
                    )
                    for part in package_parts
                ],
                all_parts_complete=all_complete,
                awaiting_leadership_review=(
                    all_complete and package.closed_at is None
                ),
                closed_by=_user_ref(users.get(package.closed_by_user_id or -1)),
                closed_at=package.closed_at,
                primary_action=primary,
                additional_actions=additional,
            )
        )

    can_create = (
        context.story.archived_at is None and can_create_correction_package(actor)
    )
    assignee_options: list[User] = []
    if can_create:
        assignee_options = list(
            db.execute(
                select(User)
                .where(User.is_active.is_(True))
                .order_by(User.display_name.asc(), User.id.asc())
            ).scalars()
        )
    return CorrectionPackagesResponse(
        story_id=story_id,
        items=items,
        assignee_options=[_user_ref(user) for user in assignee_options],  # type: ignore[list-item]
        create_action=(
            ActionRef(
                code="correction_package_create",
                label="Создать пакет правок",
                method="POST",
                href=f"/api/v1/stories/{story_id}/correction-packages",
                form="correction_package",
            )
            if can_create
            else None
        ),
    )


def get_correction_summary(db: Session, *, story_id: int) -> CorrectionSummaryRef:
    packages = list(
        db.execute(
            select(CorrectionPackage)
            .where(CorrectionPackage.story_id == story_id)
            .order_by(CorrectionPackage.id.asc())
        ).scalars()
    )
    package_ids = [package.id for package in packages]
    parts = list(
        db.execute(
            select(CorrectionPart)
            .where(CorrectionPart.package_id.in_(package_ids or [-1]))
            .order_by(CorrectionPart.package_id.asc(), CorrectionPart.id.asc())
        ).scalars()
    )
    states_by_package: dict[int, list[str]] = {package_id: [] for package_id in package_ids}
    for part in parts:
        states_by_package.setdefault(part.package_id, []).append(part.state)
    open_packages = [package for package in packages if package.closed_at is None]
    awaiting_count = sum(
        bool(states_by_package.get(package.id))
        and all(state == "done" for state in states_by_package[package.id])
        for package in open_packages
    )
    return CorrectionSummaryRef(
        href=f"/api/v1/stories/{story_id}/correction-packages",
        total_count=len(packages),
        open_count=len(open_packages),
        awaiting_leadership_review_count=awaiting_count,
    )


def _locked_part(
    db: Session,
    *,
    story_id: int,
    package_id: int,
    part_id: int,
) -> tuple[CorrectionPackage, list[CorrectionPart], CorrectionPart]:
    package, parts = _load_package_parts(
        db,
        story_id=story_id,
        package_id=package_id,
        for_update=True,
    )
    part = next((candidate for candidate in parts if candidate.id == part_id), None)
    if part is None:
        raise _error(
            "CORRECTION_PART_NOT_FOUND",
            "Часть пакета правок не найдена",
            status.HTTP_404_NOT_FOUND,
        )
    return package, parts, part


def complete_correction_part(
    db: Session,
    *,
    story_id: int,
    package_id: int,
    part_id: int,
    actor: User,
    completion_action: CompletionAction,
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    package, parts, part = _locked_part(
        db,
        story_id=story_id,
        package_id=package_id,
        part_id=part_id,
    )
    if package.closed_at is not None:
        raise _error("PACKAGE_CLOSED", "Пакет правок уже закрыт")
    if not can_complete_correction_part(actor, assignee_user_id=part.assignee_user_id):
        raise _error("PART_NOT_ASSIGNED", "Часть правки назначена другому сотруднику", status.HTTP_403_FORBIDDEN)
    if part.state == "done":
        raise _error("PART_ALREADY_COMPLETE", "Часть правки уже выполнена")
    if (
        (completion_action == "video_ready" and part.scope != "video")
        or (completion_action == "titles_ready" and part.scope != "titles")
    ):
        raise _error(
            "COMPLETION_ACTION_SCOPE_MISMATCH",
            "Действие завершения не соответствует области правки",
        )
    blocker = _completion_action_blocker(
        completion_action=completion_action,
        workflow=context.workflow,
        production=context.production,
    )
    if blocker is not None:
        raise _error(*blocker)

    now = datetime.now(UTC)
    part.state = "done"
    part.completed_by_user_id = actor.id
    part.completed_at = now
    if completion_action == "video_ready":
        context.production.video_ready_by_user_id = actor.id
        context.production.video_ready_at = now
    elif completion_action == "titles_ready":
        context.production.titles_ready_by_user_id = actor.id
        context.production.titles_ready_at = now
    event = _record_event(
        db,
        story_id=story_id,
        revision_no=context.scenario.revision_no,
        actor=actor,
        event_code="correction_part_completed",
        now=now,
        payload={
            "package_id": package.id,
            "part_id": part.id,
            "scope": part.scope,
            "completion_action": completion_action,
        },
    )
    notify_correction_part_completed(
        db,
        story=context.story,
        actor=actor,
        package=package,
        part=part,
        parts=parts,
        now=now,
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="correction_part",
        resource_id=part.id,
    )


def return_correction_part(
    db: Session,
    *,
    story_id: int,
    package_id: int,
    part_id: int,
    actor: User,
    reason: str,
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    if not can_return_correction_part(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    package, _parts, part = _locked_part(
        db,
        story_id=story_id,
        package_id=package_id,
        part_id=part_id,
    )
    if package.closed_at is not None:
        raise _error("PACKAGE_CLOSED", "Пакет правок уже закрыт")
    if part.state != "done":
        raise _error("PART_NOT_COMPLETE", "Можно вернуть только выполненную часть")
    normalized_reason = reason.strip()
    if not normalized_reason:
        raise _error(
            "RETURN_REASON_REQUIRED",
            "Укажите причину возврата",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )

    now = datetime.now(UTC)
    part.state = "pending"
    part.completed_by_user_id = None
    part.completed_at = None
    reset_production_for_correction_scope(context.production, part.scope)
    event = _record_event(
        db,
        story_id=story_id,
        revision_no=context.scenario.revision_no,
        actor=actor,
        event_code="correction_part_returned",
        now=now,
        payload={
            "package_id": package.id,
            "part_id": part.id,
            "scope": part.scope,
            "reason": normalized_reason,
        },
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="correction_part",
        resource_id=part.id,
    )


def close_correction_package(
    db: Session,
    *,
    story_id: int,
    package_id: int,
    actor: User,
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    if not can_close_correction_package(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    package, parts = _load_package_parts(
        db,
        story_id=story_id,
        package_id=package_id,
        for_update=True,
    )
    if package.closed_at is not None:
        raise _error("PACKAGE_ALREADY_CLOSED", "Пакет правок уже закрыт")
    if not parts or any(part.state != "done" for part in parts):
        raise _error(
            "PACKAGE_HAS_INCOMPLETE_PARTS",
            "Сначала завершите все части пакета",
        )

    now = datetime.now(UTC)
    package.closed_by_user_id = actor.id
    package.closed_at = now
    event = _record_event(
        db,
        story_id=story_id,
        revision_no=context.scenario.revision_no,
        actor=actor,
        event_code="correction_package_closed",
        now=now,
        payload={"package_id": package.id},
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="correction_package",
        resource_id=package.id,
    )
