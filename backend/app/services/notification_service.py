from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CorrectionPackage,
    CorrectionPart,
    ExternalApprovalCycle,
    Notification,
    Scenario,
    ScenarioEditSession,
    ScenarioReadMarker,
    ScenarioRevision,
    ScenarioRevisionRow,
    Story,
    StoryAssignment,
    StoryProductionState,
    StoryWorkflowState,
    User,
    UserFunction,
)
from app.schemas.common import ActionRef, CommandAck, ResourceRef
from app.schemas.corrections import CorrectionActionRef
from app.schemas.notifications import (
    NotificationDiffRef,
    NotificationListResponse,
    NotificationRef,
    NotificationStoryRef,
    PersonalActionListResponse,
    PersonalActionRef,
)
from app.schemas.stories import CodeLabel, UserRef
from app.services.permissions import is_leadership
from app.services.scenario_diff import build_scenario_diff


PRIORITY_LABELS = {"standard": "Стандарт", "high": "Высокий"}
ASSIGNMENT_LABELS = {
    "proofreader": "корректуру",
    "video_editor": "монтаж",
    "designer": "титры",
}
ACTION_RANK = {
    "confirm_editorial": 10,
    "submit_review": 20,
    "mark_proofread": 30,
    "request_reproofread": 40,
    "video_start": 50,
    "video_ready": 60,
    "video_approve_for_titles": 70,
    "titles_start": 80,
    "titles_ready": 90,
    "titles_accept": 100,
    "correction_part_complete": 110,
    "correction_package_close": 120,
    "external_approval_result": 130,
    "external_approval_send": 140,
}


def _error(code: str, message: str, http_status: int) -> HTTPException:
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


def _story_ref(story: Story) -> NotificationStoryRef:
    return NotificationStoryRef(
        id=story.id,
        title=story.title,
        priority=CodeLabel(
            code=story.priority,
            label=PRIORITY_LABELS[story.priority],
        ),
    )


def _active_users_with_functions(db: Session, function_codes: set[str]) -> list[User]:
    if not function_codes:
        return []
    return list(
        db.execute(
            select(User)
            .join(UserFunction, UserFunction.user_id == User.id)
            .where(
                User.is_active.is_(True),
                UserFunction.function_code.in_(function_codes),
            )
            .distinct()
            .order_by(User.id.asc())
        ).scalars()
    )


def _notification_payload(
    *,
    title: str,
    summary: str,
    target_href: str,
    diff: dict | None = None,
) -> dict:
    payload = {
        "title": title,
        "summary": summary,
        "target_href": target_href,
    }
    if diff is not None:
        payload["diff"] = diff
    return payload


def _deliver(
    db: Session,
    *,
    recipient: User,
    story: Story,
    kind: str,
    actor: User,
    payload: dict,
    now: datetime,
    edit_session_id: int | None = None,
) -> Notification | None:
    if not recipient.is_active or recipient.id == actor.id:
        return None
    existing: Notification | None = None
    if edit_session_id is not None:
        existing = db.scalar(
            select(Notification).where(
                Notification.recipient_user_id == recipient.id,
                Notification.story_id == story.id,
                Notification.kind == kind,
                Notification.edit_session_id == edit_session_id,
            )
        )
    if existing is not None:
        existing.actor_user_id = actor.id
        existing.payload = payload
        existing.updated_at = now
        existing.read_at = None
        db.flush()
        return existing
    item = Notification(
        recipient_user_id=recipient.id,
        story_id=story.id,
        kind=kind,
        actor_user_id=actor.id,
        edit_session_id=edit_session_id,
        payload=payload,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.flush()
    return item


def notify_assignment(
    db: Session,
    *,
    story: Story,
    actor: User,
    assignee: User,
    assignment_kind: str,
    now: datetime,
) -> None:
    target = "scenario" if assignment_kind == "proofreader" else "production"
    label = ASSIGNMENT_LABELS[assignment_kind]
    _deliver(
        db,
        recipient=assignee,
        story=story,
        kind="assignment",
        actor=actor,
        payload=_notification_payload(
            title="Новое назначение",
            summary=f"Вы назначены отвечать за {label}",
            target_href=f"/stories/{story.id}/{target}",
        ),
        now=now,
    )


def notify_workflow_event(
    db: Session,
    *,
    story: Story,
    actor: User,
    event_code: str,
    assigned_proofreader_user_id: int | None,
    now: datetime,
) -> None:
    recipients: Iterable[User]
    kind: str
    title: str
    summary: str
    if event_code == "review_requested":
        recipients = _active_users_with_functions(db, {"chief", "chief_editor"})
        kind = "review_requested"
        title = "Текст ждёт редакционной проверки"
        summary = f"{actor.display_name} отправил сценарий на проверку"
    elif event_code in {"editorial_confirmed", "reproofread_requested"}:
        proofreader = db.get(User, assigned_proofreader_user_id) if assigned_proofreader_user_id else None
        recipients = [proofreader] if proofreader is not None else []
        if event_code == "editorial_confirmed":
            kind = "proofread_requested"
            title = "Сценарий готов к корректуре"
            summary = f"{actor.display_name} подтвердил редакционную готовность"
        else:
            kind = "reproofread_requested"
            title = "Назначена повторная вычитка"
            summary = f"{actor.display_name} запросил повторную корректуру"
    else:
        return
    for recipient in recipients:
        _deliver(
            db,
            recipient=recipient,
            story=story,
            kind=kind,
            actor=actor,
            payload=_notification_payload(
                title=title,
                summary=summary,
                target_href=f"/stories/{story.id}/scenario",
            ),
            now=now,
        )


def notify_production_event(
    db: Session,
    *,
    story: Story,
    actor: User,
    event_code: str,
    now: datetime,
) -> None:
    details = {
        "video_ready": ("video_ready", "Ролик готов", f"{actor.display_name} передал ролик на просмотр"),
        "titles_ready": ("titles_ready", "Титры готовы", f"{actor.display_name} передал титры на приёмку"),
    }.get(event_code)
    if details is None:
        return
    kind, title, summary = details
    for recipient in _active_users_with_functions(db, {"chief", "chief_editor"}):
        _deliver(
            db,
            recipient=recipient,
            story=story,
            kind=kind,
            actor=actor,
            payload=_notification_payload(
                title=title,
                summary=summary,
                target_href=f"/stories/{story.id}/production",
            ),
            now=now,
        )


def notify_correction_package_created(
    db: Session,
    *,
    story: Story,
    actor: User,
    package: CorrectionPackage,
    parts: list[CorrectionPart],
    now: datetime,
) -> None:
    users = {
        user.id: user
        for user in db.execute(
            select(User).where(User.id.in_({part.assignee_user_id for part in parts}))
        ).scalars()
    }
    for part in parts:
        recipient = users.get(part.assignee_user_id)
        if recipient is None:
            continue
        _deliver(
            db,
            recipient=recipient,
            story=story,
            kind="correction_part_assigned",
            actor=actor,
            payload=_notification_payload(
                title="Назначена часть пакета правок",
                summary=part.description,
                target_href=f"/stories/{story.id}/production",
            ) | {"package_id": package.id, "part_id": part.id, "scope": part.scope},
            now=now,
        )


def notify_correction_part_completed(
    db: Session,
    *,
    story: Story,
    actor: User,
    package: CorrectionPackage,
    part: CorrectionPart,
    parts: list[CorrectionPart],
    now: datetime,
) -> None:
    recipient_ids = {package.created_by_user_id}
    recipient_ids.update(
        user.id for user in _active_users_with_functions(db, {"chief", "chief_editor"})
    )
    recipients = {
        user.id: user
        for user in db.execute(select(User).where(User.id.in_(recipient_ids))).scalars()
        if user.is_active
    }
    for recipient in recipients.values():
        _deliver(
            db,
            recipient=recipient,
            story=story,
            kind="correction_part_completed",
            actor=actor,
            payload=_notification_payload(
                title="Часть пакета правок выполнена",
                summary=part.description,
                target_href=f"/stories/{story.id}/production",
            ) | {"package_id": package.id, "part_id": part.id, "scope": part.scope},
            now=now,
        )
    if not parts or any(candidate.state != "done" for candidate in parts):
        return
    for recipient in recipients.values():
        _deliver(
            db,
            recipient=recipient,
            story=story,
            kind="correction_package_ready",
            actor=actor,
            payload=_notification_payload(
                title="Пакет правок готов к просмотру",
                summary="Все исполнители завершили свои части",
                target_href=f"/stories/{story.id}/production",
            ) | {"package_id": package.id},
            now=now,
        )


def notify_external_approval_result(
    db: Session,
    *,
    story: Story,
    actor: User,
    cycle: ExternalApprovalCycle,
    now: datetime,
) -> None:
    approved = cycle.result == "approved"
    for recipient in _active_users_with_functions(db, {"chief", "chief_editor"}):
        _deliver(
            db,
            recipient=recipient,
            story=story,
            kind="external_approval_result",
            actor=actor,
            payload=_notification_payload(
                title="Получен результат внешнего согласования",
                summary=(
                    f"Цикл №{cycle.cycle_no}: согласовано"
                    if approved
                    else f"Цикл №{cycle.cycle_no}: есть правки"
                ),
                target_href=f"/stories/{story.id}/production?action=external-approval",
            )
            | {
                "cycle_id": cycle.id,
                "cycle_no": cycle.cycle_no,
                "result": cycle.result,
            },
            now=now,
        )


def _revision(db: Session, scenario_id: int, revision_no: int) -> ScenarioRevision | None:
    return db.scalar(
        select(ScenarioRevision).where(
            ScenarioRevision.scenario_id == scenario_id,
            ScenarioRevision.revision_no == revision_no,
        )
    )


def _revision_rows(db: Session, revision: ScenarioRevision) -> list[ScenarioRevisionRow]:
    return list(
        db.execute(
            select(ScenarioRevisionRow)
            .where(ScenarioRevisionRow.revision_id == revision.id)
            .order_by(ScenarioRevisionRow.order_index.asc(), ScenarioRevisionRow.id.asc())
        ).scalars()
    )


def _marker_revision(
    db: Session,
    *,
    story_id: int,
    user_id: int,
    contexts: set[str],
) -> int | None:
    return db.scalar(
        select(func.max(ScenarioReadMarker.revision_no)).where(
            ScenarioReadMarker.story_id == story_id,
            ScenarioReadMarker.user_id == user_id,
            ScenarioReadMarker.context.in_(contexts),
        )
    )


def _late_diff(
    db: Session,
    *,
    scenario: Scenario,
    session: ScenarioEditSession,
    from_revision: int,
) -> dict | None:
    if from_revision >= session.latest_revision_no:
        return None
    before = _revision(db, scenario.id, from_revision)
    after = _revision(db, scenario.id, session.latest_revision_no)
    if before is None or after is None:
        return None
    summary, changes = build_scenario_diff(
        _revision_rows(db, before),
        _revision_rows(db, after),
    )
    if summary["total"] == 0:
        return None
    return {
        "from_revision": from_revision,
        "to_revision": session.latest_revision_no,
        "summary": summary,
        "changes": changes,
        "href": f"/stories/{scenario.story_id}/history?session={session.id}",
    }


def finalize_late_edit_notifications(
    db: Session,
    *,
    session: ScenarioEditSession,
    now: datetime,
) -> None:
    if int((session.diff_summary or {}).get("total", 0)) == 0:
        return
    scenario = db.get(Scenario, session.scenario_id)
    actor = db.get(User, session.actor_user_id)
    if scenario is None or actor is None:
        return
    story = db.get(Story, scenario.story_id)
    workflow = db.get(StoryWorkflowState, scenario.story_id)
    production = db.get(StoryProductionState, scenario.story_id)
    if story is None or workflow is None or production is None:
        return
    assignments = {
        assignment.kind: assignment.user_id
        for assignment in db.execute(
            select(StoryAssignment).where(StoryAssignment.story_id == story.id)
        ).scalars()
    }

    proofread_baseline: int | None = None
    if workflow.proofread_revision is not None:
        if workflow.proofread_revision < session.latest_revision_no:
            proofread_baseline = workflow.proofread_revision
        elif (
            assignments.get("proofreader") == actor.id
            and workflow.proofread_revision == session.latest_revision_no
            and session.base_revision_no < session.latest_revision_no
        ):
            proofread_baseline = session.base_revision_no
    if proofread_baseline is not None:
        diff = _late_diff(
            db,
            scenario=scenario,
            session=session,
            from_revision=proofread_baseline,
        )
        if diff is not None:
            for recipient in _active_users_with_functions(db, {"chief_editor"}):
                _deliver(
                    db,
                    recipient=recipient,
                    story=story,
                    kind="scenario_changed_after_proofread",
                    actor=actor,
                    payload=_notification_payload(
                        title="Сценарий изменён после вычитки",
                        summary="Откройте сохранённые изменения сценария",
                        target_href=f"/stories/{story.id}/scenario",
                        diff=diff,
                    ),
                    now=now,
                    edit_session_id=session.id,
                )

    downstream = (
        (
            "video_editor",
            "scenario_changed_video",
            "video",
            production.video_started_revision,
            {"video"},
            "Сценарий изменён после начала монтажа",
        ),
        (
            "designer",
            "scenario_changed_titles",
            "titles",
            production.titles_started_revision,
            {"titles", "captionpanels"},
            "Сценарий изменён после начала титров",
        ),
    )
    for assignment_kind, kind, context, started_revision, marker_contexts, title in downstream:
        recipient_id = assignments.get(assignment_kind)
        if recipient_id is None or started_revision is None:
            continue
        recipient = db.get(User, recipient_id)
        if recipient is None:
            continue
        marker = _marker_revision(
            db,
            story_id=story.id,
            user_id=recipient.id,
            contexts=marker_contexts,
        )
        baseline = max(
            revision
            for revision in (started_revision, marker)
            if revision is not None
        )
        diff = _late_diff(db, scenario=scenario, session=session, from_revision=baseline)
        if diff is None:
            continue
        _deliver(
            db,
            recipient=recipient,
            story=story,
            kind=kind,
            actor=actor,
            payload=_notification_payload(
                title=title,
                summary="Откройте актуальный сценарий и сохранённый diff",
                target_href=f"/stories/{story.id}/scenario?production_context={context}",
                diff=diff,
            ),
            now=now,
            edit_session_id=session.id,
        )


def mark_downstream_notifications_read(
    db: Session,
    *,
    story_id: int,
    user_id: int,
    context: str,
    revision_no: int,
    now: datetime,
) -> None:
    kind = {
        "video": "scenario_changed_video",
        "titles": "scenario_changed_titles",
        "captionpanels": "scenario_changed_titles",
    }.get(context)
    if kind is None:
        return
    items = db.execute(
        select(Notification).where(
            Notification.recipient_user_id == user_id,
            Notification.story_id == story_id,
            Notification.kind == kind,
            Notification.read_at.is_(None),
        )
    ).scalars()
    for item in items:
        to_revision = ((item.payload or {}).get("diff") or {}).get("to_revision")
        if isinstance(to_revision, int) and to_revision <= revision_no:
            item.read_at = now
    db.flush()


def list_notifications(
    db: Session,
    *,
    recipient: User,
    unread_only: bool,
    limit: int,
) -> NotificationListResponse:
    base = select(Notification).where(Notification.recipient_user_id == recipient.id)
    if unread_only:
        base = base.where(Notification.read_at.is_(None))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    unread_count = db.scalar(
        select(func.count(Notification.id)).where(
            Notification.recipient_user_id == recipient.id,
            Notification.read_at.is_(None),
        )
    ) or 0
    rows = list(
        db.execute(
            base.order_by(Notification.updated_at.desc(), Notification.id.desc()).limit(limit)
        ).scalars()
    )
    story_ids = {row.story_id for row in rows}
    actor_ids = {row.actor_user_id for row in rows if row.actor_user_id is not None}
    stories = {
        story.id: story
        for story in db.execute(select(Story).where(Story.id.in_(story_ids or {-1}))).scalars()
    }
    actors = {
        user.id: user
        for user in db.execute(select(User).where(User.id.in_(actor_ids or {-1}))).scalars()
    }
    items = []
    for row in rows:
        payload = row.payload or {}
        items.append(
            NotificationRef(
                id=row.id,
                kind=row.kind,
                story=_story_ref(stories[row.story_id]),
                actor=_user_ref(actors.get(row.actor_user_id or -1)),
                title=str(payload.get("title", "Уведомление")),
                summary=str(payload.get("summary", "")),
                target_href=str(payload.get("target_href", f"/stories/{row.story_id}/scenario")),
                diff=(
                    NotificationDiffRef.model_validate(payload["diff"])
                    if isinstance(payload.get("diff"), dict)
                    else None
                ),
                created_at=row.created_at,
                updated_at=row.updated_at,
                read_at=row.read_at,
            )
        )
    return NotificationListResponse(items=items, total=total, unread_count=unread_count)


def mark_notification_read(
    db: Session,
    *,
    notification_id: int,
    recipient: User,
) -> CommandAck:
    item = db.get(Notification, notification_id)
    if item is None:
        raise _error(
            "NOTIFICATION_NOT_FOUND",
            "Уведомление не найдено",
            status.HTTP_404_NOT_FOUND,
        )
    if item.recipient_user_id != recipient.id:
        raise _error(
            "NOTIFICATION_NOT_RECIPIENT",
            "Уведомление адресовано другому пользователю",
            status.HTTP_403_FORBIDDEN,
        )
    now = datetime.now(UTC)
    if item.read_at is None:
        item.read_at = now
        db.commit()
    return CommandAck(
        event_id=None,
        changed_at=item.read_at or now,
        resource=ResourceRef(type="notification", id=item.id),
    )


def _action(
    story_id: int,
    code: str,
    label: str,
    path: str,
) -> ActionRef:
    return ActionRef(
        code=code,
        label=label,
        method="POST",
        href=f"/api/v1/stories/{story_id}/{path}",
    )


def _pending_scope(parts: list[CorrectionPart], scope: str) -> bool:
    return any(part.scope == scope and part.state == "pending" for part in parts)


def get_personal_actions(
    db: Session,
    *,
    actor: User,
    limit: int,
) -> PersonalActionListResponse:
    stories = list(
        db.execute(select(Story).where(Story.archived_at.is_(None))).scalars()
    )
    story_ids = {story.id for story in stories}
    workflows = {
        state.story_id: state
        for state in db.execute(
            select(StoryWorkflowState).where(StoryWorkflowState.story_id.in_(story_ids or {-1}))
        ).scalars()
    }
    productions = {
        state.story_id: state
        for state in db.execute(
            select(StoryProductionState).where(StoryProductionState.story_id.in_(story_ids or {-1}))
        ).scalars()
    }
    assignments = list(
        db.execute(
            select(StoryAssignment).where(StoryAssignment.story_id.in_(story_ids or {-1}))
        ).scalars()
    )
    assignments_by_story: dict[int, dict[str, int]] = {story_id: {} for story_id in story_ids}
    for assignment in assignments:
        assignments_by_story[assignment.story_id][assignment.kind] = assignment.user_id
    packages = list(
        db.execute(
            select(CorrectionPackage).where(
                CorrectionPackage.story_id.in_(story_ids or {-1}),
                CorrectionPackage.closed_at.is_(None),
            )
        ).scalars()
    )
    open_package_story_ids = {package.story_id for package in packages}
    package_ids = {package.id for package in packages}
    parts = list(
        db.execute(
            select(CorrectionPart).where(CorrectionPart.package_id.in_(package_ids or {-1}))
        ).scalars()
    )
    parts_by_package: dict[int, list[CorrectionPart]] = {package_id: [] for package_id in package_ids}
    parts_by_story: dict[int, list[CorrectionPart]] = {story_id: [] for story_id in story_ids}
    package_by_id = {package.id: package for package in packages}
    for part in parts:
        parts_by_package[part.package_id].append(part)
        package = package_by_id[part.package_id]
        parts_by_story[package.story_id].append(part)
    external_cycles = list(
        db.execute(
            select(ExternalApprovalCycle)
            .where(ExternalApprovalCycle.story_id.in_(story_ids or {-1}))
            .order_by(
                ExternalApprovalCycle.story_id.asc(),
                ExternalApprovalCycle.cycle_no.desc(),
                ExternalApprovalCycle.id.desc(),
            )
        ).scalars()
    )
    external_by_story: dict[int, list[ExternalApprovalCycle]] = {
        story_id: [] for story_id in story_ids
    }
    for cycle in external_cycles:
        external_by_story[cycle.story_id].append(cycle)
    linked_package_ids = {
        cycle.correction_package_id
        for cycle in external_cycles
        if cycle.correction_package_id is not None
    }
    linked_packages = {
        package.id: package
        for package in db.execute(
            select(CorrectionPackage).where(
                CorrectionPackage.id.in_(linked_package_ids or {-1})
            )
        ).scalars()
    }

    ranked: list[tuple[tuple, PersonalActionRef]] = []

    def add(
        story: Story,
        *,
        stable_id: str,
        summary: str,
        target_href: str,
        action: ActionRef | CorrectionActionRef,
    ) -> None:
        rank = ACTION_RANK[action.code]
        created_at = story.created_at.replace(tzinfo=UTC) if story.created_at.tzinfo is None else story.created_at
        key = (
            0 if story.priority == "high" else 1,
            -created_at.timestamp(),
            -story.id,
            rank,
            stable_id,
        )
        ranked.append(
            (
                key,
                PersonalActionRef(
                    id=stable_id,
                    story=_story_ref(story),
                    summary=summary,
                    target_href=target_href,
                    action=action,
                ),
            )
        )

    leadership = is_leadership(actor)
    for story in stories:
        workflow = workflows.get(story.id)
        production = productions.get(story.id)
        if workflow is None or production is None:
            continue
        assigned = assignments_by_story[story.id]
        story_parts = parts_by_story[story.id]
        is_author = story.author_user_id == actor.id
        scenario_target = f"/stories/{story.id}/scenario"
        production_target = f"/stories/{story.id}/production"

        if workflow.editorial_revision is None:
            if is_author and leadership:
                action = _action(story.id, "confirm_editorial", "Текст готов", "workflow/confirm-editorial")
                add(
                    story,
                    stable_id=f"story:{story.id}:action:confirm_editorial",
                    summary="Завершить редакционную проверку своего сценария",
                    target_href=scenario_target,
                    action=action,
                )
            elif is_author and workflow.review_requested_revision is None:
                action = _action(story.id, "submit_review", "Отправить на проверку", "workflow/submit-review")
                add(
                    story,
                    stable_id=f"story:{story.id}:action:submit_review",
                    summary="Передать актуальный текст руководству",
                    target_href=scenario_target,
                    action=action,
                )
            elif leadership and workflow.review_requested_revision is not None:
                action = _action(
                    story.id,
                    "confirm_editorial",
                    "Подтвердить редакционную готовность",
                    "workflow/confirm-editorial",
                )
                add(
                    story,
                    stable_id=f"story:{story.id}:action:confirm_editorial",
                    summary="Проверить актуальный сценарий",
                    target_href=scenario_target,
                    action=action,
                )

        proofread_needed = (
            workflow.proofread_revision is None
            or workflow.reproofread_requested_revision is not None
        )
        if assigned.get("proofreader") == actor.id and proofread_needed:
            action = _action(story.id, "mark_proofread", "Вычитано", "workflow/mark-proofread")
            add(
                story,
                stable_id=f"story:{story.id}:action:mark_proofread",
                summary="Вычитать актуальный сценарий",
                target_href=scenario_target,
                action=action,
            )
        if (
            leadership
            and workflow.proofread_revision is not None
            and workflow.changed_after_proofread
            and workflow.reproofread_requested_revision is None
        ):
            action = _action(
                story.id,
                "request_reproofread",
                "Назначить повторную вычитку",
                "workflow/request-reproofread",
            )
            add(
                story,
                stable_id=f"story:{story.id}:action:request_reproofread",
                summary="Решить, нужна ли повторная корректура",
                target_href=scenario_target,
                action=action,
            )

        pending_video = _pending_scope(story_parts, "video")
        pending_titles = _pending_scope(story_parts, "titles")
        if assigned.get("video_editor") == actor.id:
            if production.video_started_at is None:
                action = _action(story.id, "video_start", "Начать монтаж", "production/video/start")
                add(
                    story,
                    stable_id=f"story:{story.id}:action:video_start",
                    summary="Начать работу по актуальному сценарию",
                    target_href=production_target,
                    action=action,
                )
            elif production.video_ready_at is None and not pending_video:
                action = _action(story.id, "video_ready", "Ролик готов", "production/video/ready")
                add(
                    story,
                    stable_id=f"story:{story.id}:action:video_ready",
                    summary="Передать ролик руководству",
                    target_href=production_target,
                    action=action,
                )

        titles_gate = (
            workflow.editorial_revision is not None
            and workflow.proofread_revision is not None
            and production.video_approved_for_titles_at is not None
        )
        if assigned.get("designer") == actor.id:
            if titles_gate and production.titles_started_at is None:
                action = _action(story.id, "titles_start", "Начать титры", "production/titles/start")
                add(
                    story,
                    stable_id=f"story:{story.id}:action:titles_start",
                    summary="Открыть актуальный сценарий для титров",
                    target_href=production_target,
                    action=action,
                )
            elif production.titles_started_at is not None and production.titles_ready_at is None and not pending_titles:
                action = _action(story.id, "titles_ready", "Титры готовы", "production/titles/ready")
                add(
                    story,
                    stable_id=f"story:{story.id}:action:titles_ready",
                    summary="Передать титры руководству",
                    target_href=production_target,
                    action=action,
                )

        if (
            leadership
            and production.video_ready_at is not None
            and production.video_approved_for_titles_at is None
            and workflow.editorial_revision is not None
            and workflow.proofread_revision is not None
            and not pending_video
        ):
            action = _action(
                story.id,
                "video_approve_for_titles",
                "Ролик готов к титрам",
                "production/video/approve-for-titles",
            )
            add(
                story,
                stable_id=f"story:{story.id}:action:video_approve_for_titles",
                summary="Просмотреть готовый ролик",
                target_href=production_target,
                action=action,
            )
        if (
            leadership
            and production.titles_ready_at is not None
            and production.titles_accepted_at is None
            and not pending_titles
        ):
            action = _action(story.id, "titles_accept", "Принять титры", "production/titles/accept")
            add(
                story,
                stable_id=f"story:{story.id}:action:titles_accept",
                summary="Просмотреть готовые титры",
                target_href=production_target,
                action=action,
            )

        for package in (item for item in packages if item.story_id == story.id):
            package_parts = parts_by_package[package.id]
            for part in package_parts:
                if part.state != "pending" or part.assignee_user_id != actor.id:
                    continue
                completion_action = "video_ready" if part.scope == "video" else "titles_ready" if part.scope == "titles" else "none"
                if completion_action == "video_ready" and production.video_started_at is None:
                    continue
                if completion_action == "titles_ready" and (production.titles_started_at is None or not titles_gate):
                    continue
                label = {
                    "video": "Правки выполнены — ролик готов",
                    "titles": "Правки выполнены — титры готовы",
                    "voiceover": "Правка озвучки выполнена",
                    "text": "Правка текста выполнена",
                }[part.scope]
                action = CorrectionActionRef(
                    code="correction_part_complete",
                    label=label,
                    method="POST",
                    href=f"/api/v1/stories/{story.id}/correction-packages/{package.id}/parts/{part.id}/complete",
                    part_id=part.id,
                    part_scope=part.scope,
                )
                add(
                    story,
                    stable_id=f"story:{story.id}:correction:{package.id}:part:{part.id}:complete",
                    summary=part.description,
                    target_href=production_target,
                    action=action,
                )
            if leadership and package_parts and all(part.state == "done" for part in package_parts):
                action = CorrectionActionRef(
                    code="correction_package_close",
                    label="Закрыть пакет правок",
                    method="POST",
                    href=f"/api/v1/stories/{story.id}/correction-packages/{package.id}/close",
                )
                add(
                    story,
                    stable_id=f"story:{story.id}:correction:{package.id}:close",
                    summary="Все части выполнены — нужен просмотр руководства",
                    target_href=production_target,
                    action=action,
                )

        if leadership:
            story_cycles = external_by_story[story.id]
            pending_cycle = next(
                (cycle for cycle in story_cycles if cycle.result == "pending"),
                None,
            )
            if pending_cycle is not None:
                action = ActionRef(
                    code="external_approval_result",
                    label="Зафиксировать внешний результат",
                    method="GET",
                    href=f"/api/v1/stories/{story.id}/external-approval/cycles",
                )
                add(
                    story,
                    stable_id=(
                        f"story:{story.id}:external:cycle:{pending_cycle.id}:result"
                    ),
                    summary=f"Зафиксировать результат цикла №{pending_cycle.cycle_no}",
                    target_href=(
                        f"/stories/{story.id}/production?action=external-approval"
                    ),
                    action=action,
                )
            elif story_cycles:
                latest_cycle = story_cycles[0]
                linked_package = linked_packages.get(
                    latest_cycle.correction_package_id or -1
                )
                if (
                    latest_cycle.result == "changes_requested"
                    and linked_package is not None
                    and linked_package.closed_at is not None
                    and story.id not in open_package_story_ids
                ):
                    action = ActionRef(
                        code="external_approval_send",
                        label="Повторно отправить на согласование",
                        method="POST",
                        href=(
                            f"/api/v1/stories/{story.id}/"
                            "external-approval/cycles/send"
                        ),
                    )
                    add(
                        story,
                        stable_id=f"story:{story.id}:external:resend",
                        summary="Правки приняты — повторно отправить на согласование",
                        target_href=(
                            f"/stories/{story.id}/production?action=external-approval"
                        ),
                        action=action,
                    )
    ranked.sort(key=lambda item: item[0])
    unique: list[PersonalActionRef] = []
    seen: set[str] = set()
    for _key, item in ranked:
        if item.id in seen:
            continue
        seen.add(item.id)
        unique.append(item)
    return PersonalActionListResponse(items=unique[:limit], total=len(unique))
