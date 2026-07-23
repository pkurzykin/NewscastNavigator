from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CorrectionPackage,
    ExternalApprovalCycle,
    Scenario,
    Story,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.schemas.common import CommandAck, ResourceRef
from app.schemas.external_approval import (
    ExternalApprovalCycleRef,
    ExternalApprovalCyclesResponse,
    ExternalApprovalSummaryRef,
)
from app.schemas.stories import UserRef
from app.services.action_policy import external_approval_actions, external_approval_send_action
from app.services.correction_service import CorrectionPartInput, create_correction_package_rows
from app.services.notification_service import notify_external_approval_result
from app.services.permissions import is_leadership
from app.services.story_service import lock_story


@dataclass(frozen=True)
class ExternalApprovalContext:
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


def _context(db: Session, *, story_id: int, for_update: bool) -> ExternalApprovalContext:
    story = lock_story(db, story_id=story_id) if for_update else db.get(Story, story_id)
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)
    scenario_query = select(Scenario).where(Scenario.story_id == story_id)
    workflow_query = select(StoryWorkflowState).where(StoryWorkflowState.story_id == story_id)
    production_query = select(StoryProductionState).where(StoryProductionState.story_id == story_id)
    if for_update:
        scenario_query = scenario_query.with_for_update()
        workflow_query = workflow_query.with_for_update()
        production_query = production_query.with_for_update()
    # Keep the global Story -> Scenario -> Workflow -> Production lock order.
    scenario = db.scalar(scenario_query)
    workflow = db.scalar(workflow_query)
    production = db.scalar(production_query)
    if scenario is None or workflow is None or production is None:
        raise _error("INVALID_TRANSITION", "Состояние сюжета не создано")
    return ExternalApprovalContext(
        story=story,
        scenario=scenario,
        workflow=workflow,
        production=production,
    )


def _require_leadership(actor: User) -> None:
    if not actor.is_active or not is_leadership(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)


def _require_mutable(context: ExternalApprovalContext) -> None:
    if context.story.archived_at is not None:
        raise _error("STORY_ARCHIVED", "Архивный сюжет нельзя изменять")


def _open_correction_exists(db: Session, *, story_id: int, for_update: bool) -> bool:
    statement = (
        select(CorrectionPackage.id)
        .where(
            CorrectionPackage.story_id == story_id,
            CorrectionPackage.closed_at.is_(None),
        )
        .order_by(CorrectionPackage.id.asc())
        .limit(1)
    )
    if for_update:
        statement = statement.with_for_update()
    return db.scalar(statement) is not None


def _event(
    db: Session,
    *,
    context: ExternalApprovalContext,
    actor: User,
    code: str,
    now: datetime,
    payload: dict[str, object],
) -> StoryEvent:
    event = StoryEvent(
        story_id=context.story.id,
        event_code=code,
        actor_user_id=actor.id,
        revision_no=context.scenario.revision_no,
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


def send_external_approval(
    db: Session,
    *,
    story_id: int,
    actor: User,
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    _require_leadership(actor)
    pending = db.scalar(
        select(ExternalApprovalCycle)
        .where(
            ExternalApprovalCycle.story_id == story_id,
            ExternalApprovalCycle.result == "pending",
        )
        .with_for_update()
    )
    if pending is not None:
        raise _error(
            "EXTERNAL_CYCLE_ALREADY_PENDING",
            "Результат текущего внешнего согласования ещё не зафиксирован",
        )
    if _open_correction_exists(db, story_id=story_id, for_update=True):
        raise _error(
            "OPEN_CORRECTION_PACKAGE_EXISTS",
            "Сначала закройте текущий пакет правок",
        )
    cycle_no = int(
        db.scalar(
            select(func.coalesce(func.max(ExternalApprovalCycle.cycle_no), 0)).where(
                ExternalApprovalCycle.story_id == story_id
            )
        )
        or 0
    ) + 1
    now = datetime.now(UTC)
    cycle = ExternalApprovalCycle(
        story_id=story_id,
        cycle_no=cycle_no,
        sent_by_user_id=actor.id,
        sent_at=now,
        result="pending",
    )
    db.add(cycle)
    db.flush()
    event = _event(
        db,
        context=context,
        actor=actor,
        code="external_approval_sent",
        now=now,
        payload={"cycle_id": cycle.id, "cycle_no": cycle.cycle_no},
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="external_approval_cycle",
        resource_id=cycle.id,
    )


def record_external_approval_result(
    db: Session,
    *,
    story_id: int,
    cycle_id: int,
    actor: User,
    result: str,
    parts: list[CorrectionPartInput],
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    _require_leadership(actor)
    cycle = db.scalar(
        select(ExternalApprovalCycle)
        .where(
            ExternalApprovalCycle.id == cycle_id,
            ExternalApprovalCycle.story_id == story_id,
        )
        .with_for_update()
    )
    if cycle is None or cycle.result != "pending":
        raise _error(
            "EXTERNAL_CYCLE_NOT_PENDING",
            "Указанный цикл не ожидает результата",
        )

    now = datetime.now(UTC)
    package: CorrectionPackage | None = None
    if result == "changes_requested":
        package, event = create_correction_package_rows(
            db,
            story_id=story_id,
            revision_no=context.scenario.revision_no,
            production=context.production,
            actor=actor,
            source="external",
            parts=parts,
            now=now,
            event_code="external_approval_changes_requested",
        )
        event.payload = {
            **event.payload,
            "cycle_id": cycle.id,
            "cycle_no": cycle.cycle_no,
            "result": result,
        }
    else:
        if parts:
            raise _error(
                "CORRECTION_PARTS_NOT_ALLOWED",
                "Для согласованного результата части правок не нужны",
                status.HTTP_422_UNPROCESSABLE_CONTENT,
            )
        event = _event(
            db,
            context=context,
            actor=actor,
            code="external_approval_approved",
            now=now,
            payload={
                "cycle_id": cycle.id,
                "cycle_no": cycle.cycle_no,
                "result": result,
            },
        )

    cycle.result = result
    cycle.decided_by_user_id = actor.id
    cycle.decided_at = now
    cycle.correction_package_id = package.id if package is not None else None
    notify_external_approval_result(
        db,
        story=context.story,
        actor=actor,
        cycle=cycle,
        now=now,
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type=(
            "correction_package"
            if package is not None
            else "external_approval_cycle"
        ),
        resource_id=package.id if package is not None else cycle.id,
    )


def get_external_approval_cycles(
    db: Session,
    *,
    story_id: int,
    actor: User,
) -> ExternalApprovalCyclesResponse:
    context = _context(db, story_id=story_id, for_update=False)
    cycles = list(
        db.execute(
            select(ExternalApprovalCycle)
            .where(ExternalApprovalCycle.story_id == story_id)
            .order_by(ExternalApprovalCycle.cycle_no.desc(), ExternalApprovalCycle.id.desc())
        ).scalars()
    )
    user_ids = {
        *(cycle.sent_by_user_id for cycle in cycles),
        *(cycle.decided_by_user_id for cycle in cycles),
    }
    actual_user_ids = {user_id for user_id in user_ids if user_id is not None}
    users = {
        user.id: user
        for user in db.execute(
            select(User).where(User.id.in_(actual_user_ids or {-1}))
        ).scalars()
    }
    leadership = actor.is_active and is_leadership(actor)
    items: list[ExternalApprovalCycleRef] = []
    for cycle in cycles:
        primary, additional = external_approval_actions(
            user=actor,
            story=context.story,
            cycle=cycle,
        )
        items.append(
            ExternalApprovalCycleRef(
                id=cycle.id,
                cycle_no=cycle.cycle_no,
                sent_by=_user_ref(users[cycle.sent_by_user_id]),  # type: ignore[arg-type]
                sent_at=cycle.sent_at,
                result=cycle.result,  # type: ignore[arg-type]
                decided_by=_user_ref(users.get(cycle.decided_by_user_id or -1)),
                decided_at=cycle.decided_at,
                correction_package_id=cycle.correction_package_id,
                primary_action=primary,
                additional_actions=additional,
            )
        )
    has_pending = any(cycle.result == "pending" for cycle in cycles)
    open_correction = _open_correction_exists(db, story_id=story_id, for_update=False)
    send_action = None
    assignees: list[User] = []
    if leadership and context.story.archived_at is None:
        assignees = list(
            db.execute(
                select(User)
                .where(User.is_active.is_(True))
                .order_by(User.display_name.asc(), User.id.asc())
            ).scalars()
        )
        if not has_pending and not open_correction:
            send_action = external_approval_send_action(story_id)
    return ExternalApprovalCyclesResponse(
        story_id=story_id,
        items=items,
        assignee_options=[_user_ref(user) for user in assignees],  # type: ignore[list-item]
        send_action=send_action,
    )


def get_external_approval_summary(
    db: Session,
    *,
    story_id: int,
) -> ExternalApprovalSummaryRef:
    cycles = list(
        db.execute(
            select(ExternalApprovalCycle)
            .where(ExternalApprovalCycle.story_id == story_id)
            .order_by(ExternalApprovalCycle.cycle_no.desc(), ExternalApprovalCycle.id.desc())
        ).scalars()
    )
    latest = cycles[0] if cycles else None
    pending = next((cycle for cycle in cycles if cycle.result == "pending"), None)
    return ExternalApprovalSummaryRef(
        href=f"/api/v1/stories/{story_id}/external-approval/cycles",
        total_count=len(cycles),
        pending_cycle_no=pending.cycle_no if pending is not None else None,
        last_result=latest.result if latest is not None else None,  # type: ignore[arg-type]
    )
