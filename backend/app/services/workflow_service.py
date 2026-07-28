from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Scenario,
    ScenarioEditSession,
    Story,
    StoryAssignment,
    StoryEvent,
    StoryWorkflowState,
    User,
)
from app.schemas.common import CommandAck, ResourceRef
from app.schemas.stories import UserRef
from app.schemas.workflow import MarkRef, WorkflowReadResponse
from app.services.action_policy import editorial_workflow_actions
from app.services.permissions import (
    can_confirm_editorial,
    can_mark_proofread,
    can_submit_review,
    is_leadership,
)
from app.services.scenario_history import finalize_edit_session
from app.services.notification_service import notify_workflow_event
from app.services.story_service import lock_story_aggregate
from app.services.story_activity import touch_story_activity


def _error(code: str, message: str, http_status: int = status.HTTP_409_CONFLICT) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def _user_ref(user: User) -> UserRef:
    return UserRef(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        position=user.position,
        function_codes=user.function_codes,
    )


def _story_and_scenario(
    db: Session,
    *,
    story_id: int,
) -> tuple[Story, Scenario]:
    story = db.get(Story, story_id)
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)
    statement = select(Scenario).where(Scenario.story_id == story_id)
    scenario = db.scalar(statement)
    if scenario is None:
        raise _error("SCENARIO_NOT_FOUND", "У сюжета нет сценария", status.HTTP_404_NOT_FOUND)
    return story, scenario


def _state(db: Session, *, story_id: int, for_update: bool) -> StoryWorkflowState:
    statement = select(StoryWorkflowState).where(StoryWorkflowState.story_id == story_id)
    if for_update:
        statement = statement.with_for_update()
    state = db.scalar(statement)
    if state is None:
        raise _error("INVALID_TRANSITION", "Состояние редакционного процесса не создано")
    return state


def _assigned_proofreader_id(db: Session, story_id: int) -> int | None:
    return db.scalar(
        select(StoryAssignment.user_id).where(
            StoryAssignment.story_id == story_id,
            StoryAssignment.kind == "proofreader",
        )
    )


def _mark(
    db: Session,
    *,
    revision: int | None,
    actor_user_id: int | None,
    at: datetime | None,
    users: dict[int, User],
) -> MarkRef | None:
    if revision is None or actor_user_id is None or at is None:
        return None
    actor = users.get(actor_user_id)
    if actor is None:
        actor = db.get(User, actor_user_id)
        if actor is None:
            return None
        users[actor.id] = actor
    return MarkRef(revision=revision, actor=_user_ref(actor), at=at)


def get_workflow_read_model(
    db: Session,
    *,
    story_id: int,
    actor: User,
) -> WorkflowReadResponse:
    story, _scenario = _story_and_scenario(db, story_id=story_id)
    state = _state(db, story_id=story_id, for_update=False)
    proofreader_id = _assigned_proofreader_id(db, story_id)
    primary, additional = editorial_workflow_actions(
        user=actor,
        story=story,
        state=state,
        assigned_proofreader_user_id=proofreader_id,
    )
    actor_ids = {
        value
        for value in (
            state.review_requested_by_user_id,
            state.editorial_by_user_id,
            state.proofread_by_user_id,
            state.reproofread_requested_by_user_id,
        )
        if value is not None
    }
    users = {
        user.id: user
        for user in db.execute(select(User).where(User.id.in_(actor_ids))).scalars().all()
    } if actor_ids else {}
    return WorkflowReadResponse(
        story_id=story.id,
        review_request=_mark(
            db,
            revision=state.review_requested_revision,
            actor_user_id=state.review_requested_by_user_id,
            at=state.review_requested_at,
            users=users,
        ),
        editorial_check=_mark(
            db,
            revision=state.editorial_revision,
            actor_user_id=state.editorial_by_user_id,
            at=state.editorial_at,
            users=users,
        ),
        proofread=_mark(
            db,
            revision=state.proofread_revision,
            actor_user_id=state.proofread_by_user_id,
            at=state.proofread_at,
            users=users,
        ),
        changed_after_proofread=state.changed_after_proofread,
        reproofread_request=_mark(
            db,
            revision=state.reproofread_requested_revision,
            actor_user_id=state.reproofread_requested_by_user_id,
            at=state.reproofread_requested_at,
            users=users,
        ),
        primary_action=primary,
        additional_actions=additional,
    )


def apply_workflow_revision_change(
    db: Session,
    *,
    story_id: int,
    actor: User,
    revision: int,
    changed_at: datetime,
    workflow_state: StoryWorkflowState | None = None,
) -> None:
    state = (
        workflow_state
        if workflow_state is not None
        else _state(db, story_id=story_id, for_update=True)
    )
    if state.proofread_revision is None:
        return
    proofreader_id = _assigned_proofreader_id(db, story_id)
    if proofreader_id == actor.id:
        state.proofread_revision = revision
        state.proofread_by_user_id = actor.id
        state.proofread_at = changed_at
        state.changed_after_proofread = False
        state.reproofread_requested_revision = None
        state.reproofread_requested_by_user_id = None
        state.reproofread_requested_at = None
    else:
        state.changed_after_proofread = True
    db.flush()


def _finalize_actors_active_session(
    db: Session, *, scenario: Scenario, actor: User, now: datetime
) -> None:
    active = db.scalar(
        select(ScenarioEditSession)
        .where(
            ScenarioEditSession.scenario_id == scenario.id,
            ScenarioEditSession.actor_user_id == actor.id,
            ScenarioEditSession.ended_at.is_(None),
        )
        .with_for_update()
    )
    if active is not None:
        finalize_edit_session(db, session=active, ended_at=now)


def _record_event(
    db: Session,
    *,
    story_id: int,
    actor: User,
    revision: int,
    event_code: str,
    at: datetime,
) -> StoryEvent:
    touch_story_activity(db, story_id=story_id, changed_at=at)
    event = StoryEvent(
        story_id=story_id,
        event_code=event_code,
        actor_user_id=actor.id,
        revision_no=revision,
        payload={},
        created_at=at,
    )
    db.add(event)
    db.flush()
    return event


def run_workflow_command(
    db: Session,
    *,
    story_id: int,
    actor: User,
    revision: int,
    command: str,
) -> CommandAck:
    story, scenario, state, _production = lock_story_aggregate(
        db,
        story_id=story_id,
    )
    if story.archived_at is not None:
        raise _error("STORY_ARCHIVED", "Архивный сюжет нельзя изменять")
    if revision != scenario.revision_no:
        raise _error("REVISION_NOT_CURRENT", "Редакция сценария уже изменилась")
    proofreader_id = _assigned_proofreader_id(db, story_id)
    if command == "submit-review" and not can_submit_review(
        actor, author_user_id=story.author_user_id
    ):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    if command in {"confirm-editorial", "request-reproofread"} and not is_leadership(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    if command == "mark-proofread" and not can_mark_proofread(
        actor, assigned_proofreader_user_id=proofreader_id
    ):
        raise _error(
            "PROOFREADER_NOT_ASSIGNED",
            "Корректор не назначен на сюжет",
            status.HTTP_403_FORBIDDEN,
        )

    now = datetime.now(UTC)
    _finalize_actors_active_session(db, scenario=scenario, actor=actor, now=now)
    event_code: str
    if command == "submit-review":
        if state.review_requested_revision is not None:
            raise _error("REVIEW_ALREADY_REQUESTED", "Проверка уже запрошена")
        state.review_requested_revision = revision
        state.review_requested_by_user_id = actor.id
        state.review_requested_at = now
        event_code = "review_requested"
    elif command == "confirm-editorial":
        if not can_confirm_editorial(actor):
            raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
        if state.editorial_revision is not None:
            raise _error("EDITORIAL_ALREADY_CONFIRMED", "Редакционная готовность уже подтверждена")
        state.editorial_revision = revision
        state.editorial_by_user_id = actor.id
        state.editorial_at = now
        event_code = "editorial_confirmed"
    elif command == "mark-proofread":
        if state.changed_after_proofread and state.reproofread_requested_revision is None:
            raise _error(
                "INVALID_TRANSITION",
                "Повторная корректура требует решения руководства",
            )
        if state.proofread_revision == revision and state.reproofread_requested_revision is None:
            raise _error("INVALID_TRANSITION", "Текущая редакция уже вычитана")
        state.proofread_revision = revision
        state.proofread_by_user_id = actor.id
        state.proofread_at = now
        state.changed_after_proofread = False
        state.reproofread_requested_revision = None
        state.reproofread_requested_by_user_id = None
        state.reproofread_requested_at = None
        event_code = "proofread_marked"
    elif command == "request-reproofread":
        if state.proofread_revision is None:
            raise _error("PROOFREAD_NOT_PRESENT", "Корректура ещё не выполнена")
        if not state.changed_after_proofread:
            raise _error("INVALID_TRANSITION", "После корректуры нет новых изменений")
        if state.reproofread_requested_revision is not None:
            raise _error("REPROOFREAD_ALREADY_REQUESTED", "Повторная корректура уже запрошена")
        state.reproofread_requested_revision = revision
        state.reproofread_requested_by_user_id = actor.id
        state.reproofread_requested_at = now
        event_code = "reproofread_requested"
    else:
        raise _error("INVALID_TRANSITION", "Команда редакционного процесса не поддерживается")

    event = _record_event(
        db,
        story_id=story_id,
        actor=actor,
        revision=revision,
        event_code=event_code,
        at=now,
    )
    if event_code != "editorial_confirmed" or state.proofread_revision is None:
        notify_workflow_event(
            db,
            story=story,
            actor=actor,
            event_code=event_code,
            assigned_proofreader_user_id=proofreader_id,
            now=now,
        )
    db.commit()
    return CommandAck(
        event_id=str(event.id),
        changed_at=now,
        resource=ResourceRef(type="story_workflow", id=story_id),
    )
