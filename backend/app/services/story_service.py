from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    CorrectionPackage,
    ExternalApprovalCycle,
    Rubric,
    Scenario,
    ScenarioEditSession,
    Story,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.schemas.common import CommandAck, ResourceRef
from app.services.action_policy import can_update_story_metadata
from app.services.permissions import can_create_story, has_function, is_leadership
from app.services.story_activity import touch_story_activity


def _error(code: str, message: str, http_status: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def story_for_update_statement(story_id: int):
    return (
        select(Story)
        .where(Story.id == story_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )


def lock_story(db: Session, *, story_id: int) -> Story:
    story = db.scalar(story_for_update_statement(story_id))
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)
    return story


def lock_story_aggregate(
    db: Session,
    *,
    story_id: int,
) -> tuple[Story, Scenario, StoryWorkflowState, StoryProductionState]:
    story = lock_story(db, story_id=story_id)
    scenario = db.scalar(
        select(Scenario)
        .where(Scenario.story_id == story_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    workflow = db.scalar(
        select(StoryWorkflowState)
        .where(StoryWorkflowState.story_id == story_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    production = db.scalar(
        select(StoryProductionState)
        .where(StoryProductionState.story_id == story_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if scenario is None or workflow is None or production is None:
        raise _error("INVALID_TRANSITION", "Состояние сюжета не создано", status.HTTP_409_CONFLICT)
    return story, scenario, workflow, production


def _event(
    db: Session,
    *,
    story: Story,
    scenario: Scenario,
    actor: User,
    code: str,
    now: datetime,
    payload: dict[str, object] | None = None,
) -> StoryEvent:
    touch_story_activity(db, story_id=story.id, changed_at=now)
    event = StoryEvent(
        story_id=story.id,
        event_code=code,
        actor_user_id=actor.id,
        revision_no=scenario.revision_no,
        payload=payload or {},
        created_at=now,
    )
    db.add(event)
    db.flush()
    return event


def _ack(db: Session, *, story: Story, event: StoryEvent, now: datetime) -> CommandAck:
    db.commit()
    return CommandAck(
        event_id=str(event.id),
        changed_at=now,
        resource=ResourceRef(type="story", id=story.id),
    )


def create_story(
    db: Session,
    *,
    actor: User,
    title: str,
    rubric_id: int,
    author_user_id: int | None,
    priority: str,
) -> CommandAck:
    if not can_create_story(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    normalized_title = title.strip()
    if not normalized_title:
        raise _error(
            "VALIDATION_ERROR",
            "Название сюжета не может быть пустым",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    if priority == "high" and not is_leadership(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    rubric = db.scalar(
        select(Rubric).where(Rubric.id == rubric_id, Rubric.is_active.is_(True))
    )
    if rubric is None:
        raise _error("RUBRIC_INACTIVE", "Рубрика недоступна", status.HTTP_409_CONFLICT)

    target_author_id = author_user_id if author_user_id is not None else actor.id
    if target_author_id != actor.id and not has_function(actor, "chief"):
        raise _error("FORBIDDEN", "Нельзя выбрать другого автора", status.HTTP_403_FORBIDDEN)
    author = db.scalar(select(User).where(User.id == target_author_id))
    if author is None or not author.is_active or not has_function(author, "author"):
        raise _error(
            "AUTHOR_FUNCTION_REQUIRED",
            "Нужен активный пользователь с функцией автора",
            status.HTTP_409_CONFLICT,
        )

    now = datetime.now(UTC)
    story = Story(
        title=normalized_title,
        rubric_id=rubric.id,
        author_user_id=author.id,
        priority=priority,
        created_at=now,
        updated_at=now,
    )
    db.add(story)
    db.flush()
    scenario = Scenario(story_id=story.id, revision_no=0)
    db.add_all(
        [
            scenario,
            StoryWorkflowState(story_id=story.id),
            StoryProductionState(story_id=story.id),
        ]
    )
    db.flush()
    event = _event(
        db,
        story=story,
        scenario=scenario,
        actor=actor,
        code="story_created",
        now=now,
        payload={
            "title": story.title,
            "rubric_id": story.rubric_id,
            "author_user_id": story.author_user_id,
            "priority": story.priority,
        },
    )
    return _ack(db, story=story, event=event, now=now)


def update_story_priority(
    db: Session,
    *,
    story_id: int,
    actor: User,
    priority: str,
) -> CommandAck:
    if not actor.is_active or not is_leadership(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    story = lock_story(db, story_id=story_id)
    if story.archived_at is not None:
        raise _error(
            "STORY_ARCHIVED",
            "Архивный сюжет нельзя изменять",
            status.HTTP_409_CONFLICT,
        )
    scenario = db.scalar(select(Scenario).where(Scenario.story_id == story_id))
    if scenario is None:
        raise _error("INVALID_TRANSITION", "Состояние сюжета не создано", status.HTTP_409_CONFLICT)
    previous = story.priority
    now = datetime.now(UTC)
    story.priority = priority
    event = _event(
        db,
        story=story,
        scenario=scenario,
        actor=actor,
        code="story_priority_changed",
        now=now,
        payload={"from": previous, "to": priority},
    )
    return _ack(db, story=story, event=event, now=now)


def archive_story(db: Session, *, story_id: int, actor: User) -> CommandAck:
    if not actor.is_active or not is_leadership(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    story, scenario, _workflow, _production = lock_story_aggregate(db, story_id=story_id)
    if story.archived_at is not None:
        raise _error("STORY_ALREADY_ARCHIVED", "Сюжет уже находится в архиве", status.HTTP_409_CONFLICT)
    if story.aired_at is None:
        raise _error("STORY_NOT_AIRED", "Сначала отметьте выход сюжета в эфир", status.HTTP_409_CONFLICT)

    # Keep one global lock order: Story -> Scenario -> Workflow -> Production
    # -> cycles/packages -> active session.
    list(
        db.execute(
            select(ExternalApprovalCycle)
            .where(ExternalApprovalCycle.story_id == story_id)
            .order_by(ExternalApprovalCycle.id.asc())
            .with_for_update()
        ).scalars()
    )
    list(
        db.execute(
            select(CorrectionPackage)
            .where(CorrectionPackage.story_id == story_id)
            .order_by(CorrectionPackage.id.asc())
            .with_for_update()
        ).scalars()
    )
    active_sessions = list(
        db.execute(
            select(ScenarioEditSession)
            .where(
                ScenarioEditSession.scenario_id == scenario.id,
                ScenarioEditSession.ended_at.is_(None),
            )
            .order_by(ScenarioEditSession.id.asc())
            .with_for_update()
        ).scalars()
    )
    now = datetime.now(UTC)
    if active_sessions:
        from app.services.scenario_history import finalize_edit_session

        for session in active_sessions:
            finalize_edit_session(db, session=session, ended_at=now)
    story.archived_at = now
    story.archived_by_user_id = actor.id
    event = _event(
        db,
        story=story,
        scenario=scenario,
        actor=actor,
        code="story_archived",
        now=now,
    )
    return _ack(db, story=story, event=event, now=now)


def restore_story(db: Session, *, story_id: int, actor: User) -> CommandAck:
    if not actor.is_active or not is_leadership(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    story, scenario, _workflow, _production = lock_story_aggregate(db, story_id=story_id)
    if story.archived_at is None:
        raise _error("STORY_NOT_ARCHIVED", "Сюжет не находится в архиве", status.HTTP_409_CONFLICT)
    now = datetime.now(UTC)
    story.archived_at = None
    story.archived_by_user_id = None
    event = _event(
        db,
        story=story,
        scenario=scenario,
        actor=actor,
        code="story_restored",
        now=now,
    )
    return _ack(db, story=story, event=event, now=now)


def update_story_metadata(db: Session, *, story_id: int, actor: User, title: str | None, rubric_id: int | None) -> Story:
    if title is None and rubric_id is None:
        raise _error("EMPTY_PATCH", "Нужно указать хотя бы одно изменение")
    story = lock_story(db, story_id=story_id)
    if story.archived_at is not None:
        raise _error(
            "STORY_ARCHIVED",
            "Архивный сюжет нельзя изменять",
            status.HTTP_409_CONFLICT,
        )
    if not can_update_story_metadata(actor, story):
        raise _error("FORBIDDEN", "Недостаточно прав для изменения сюжета", status.HTTP_403_FORBIDDEN)
    if rubric_id is not None:
        rubric = db.get(Rubric, rubric_id)
        if rubric is None or not rubric.is_active:
            raise _error("RUBRIC_INACTIVE", "Рубрика недоступна")
        story.rubric_id = rubric.id
    if title is not None:
        normalized_title = title.strip()
        if not normalized_title:
            raise _error("VALIDATION_ERROR", "Название сюжета не может быть пустым")
        story.title = normalized_title
    touch_story_activity(
        db,
        story_id=story.id,
        changed_at=datetime.now(UTC),
    )
    db.add(story)
    db.commit()
    return story
