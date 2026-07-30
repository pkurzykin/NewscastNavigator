from __future__ import annotations

import base64
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Notification, Scenario, ScenarioEditSession, Story, StoryEvent, User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.history import (
    EditSessionHistoryItem,
    ScenarioSessionDiffResponse,
    StoryHistoryResponse,
    WorkflowEventHistoryItem,
)
from app.schemas.notifications import NotificationDiffRef
from app.schemas.stories import StoryListItem, UserRef
from app.services.permissions import is_leadership
from app.services.scenario_history import (
    MEANINGFUL_STORY_EVENT_LABELS,
    restore_edit_session,
    story_event_diff_href,
    story_event_summary,
)
from app.services.scenario_sessions import expire_current_lease
from app.services.story_queries import get_story_read_model


router = APIRouter(prefix="/api/v1/stories", tags=["history"])


TimelineKey = tuple[int, int, int]


def _timeline_timestamp(value: datetime) -> int:
    normalized = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return int(normalized.timestamp() * 1_000_000)


def _cursor_after(cursor: str | None) -> TimelineKey | None:
    if cursor is None:
        return None
    from fastapi import HTTPException, status

    try:
        decoded = base64.urlsafe_b64decode(cursor.encode("ascii") + b"=" * (-len(cursor) % 4))
        prefix, timestamp, rank, item_id = decoded.decode("ascii").split(":")
        key = int(timestamp), int(rank), int(item_id)
        if prefix != "timeline" or key[0] < 0 or key[1] not in {0, 1} or key[2] < 1:
            raise ValueError
        return key
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "HISTORY_CURSOR_INVALID", "message": "Некорректный cursor истории"},
        ) from exc


def _encode_cursor(key: TimelineKey) -> str:
    timestamp, rank, item_id = key
    raw = f"timeline:{timestamp}:{rank}:{item_id}"
    return base64.urlsafe_b64encode(raw.encode("ascii")).decode("ascii").rstrip("=")


def _story_and_scenario(db: Session, story_id: int) -> tuple[StoryListItem, Scenario]:
    from fastapi import HTTPException, status

    story = db.get(Story, story_id)
    if story is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "STORY_NOT_FOUND", "message": "Сюжет не найден"},
        )
    scenario = db.scalar(select(Scenario).where(Scenario.story_id == story_id))
    if scenario is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SCENARIO_NOT_FOUND", "message": "У сюжета нет сценария"},
        )
    read_model = get_story_read_model(db, story_id)
    assert read_model is not None
    return StoryListItem.model_validate(read_model), scenario


def _user_ref(user: User) -> UserRef:
    return UserRef(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        position=user.position,
        function_codes=user.function_codes,
    )


def _item(story_id: int, session: ScenarioEditSession, actor: User, can_restore: bool) -> EditSessionHistoryItem:
    assert session.ended_at is not None
    assert session.diff_summary is not None
    return EditSessionHistoryItem(
        id=session.id,
        actor=_user_ref(actor),
        started_at=session.started_at,
        ended_at=session.ended_at,
        from_revision=session.base_revision_no,
        to_revision=session.latest_revision_no,
        diff_summary=session.diff_summary,
        diff_href=f"/api/v1/stories/{story_id}/history/edit-sessions/{session.id}",
        available_actions=[{
            "code": "restore_scenario_session",
            "label": "Восстановить",
            "method": "POST",
            "href": f"/api/v1/stories/{story_id}/history/edit-sessions/{session.id}/restore",
            "emphasis": "danger",
            "confirmation": (
                "Выбранное состояние станет актуальным. "
                "Последующая история сохранится."
            ),
            "form": None,
        }] if can_restore else [],
    )


def _event_item(
    story_id: int,
    event: StoryEvent,
    actor: User | None,
) -> WorkflowEventHistoryItem:
    return WorkflowEventHistoryItem(
        id=event.id,
        event_code=event.event_code,
        label=MEANINGFUL_STORY_EVENT_LABELS[event.event_code],
        summary=story_event_summary(event),
        actor=_user_ref(actor) if actor is not None else None,
        at=event.created_at,
        diff_href=story_event_diff_href(story_id, event),
        available_actions=[],
    )


@router.get("/{story_id}/history", response_model=StoryHistoryResponse)
def get_story_history(
    story_id: int,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StoryHistoryResponse:
    story, scenario = _story_and_scenario(db, story_id)
    if expire_current_lease(db, scenario_id=scenario.id):
        db.commit()
    after_key = _cursor_after(cursor)
    sessions = db.execute(
        select(ScenarioEditSession).where(
            ScenarioEditSession.scenario_id == scenario.id,
            ScenarioEditSession.ended_at.is_not(None),
            ScenarioEditSession.diff_summary.is_not(None),
        )
    ).scalars().all()
    events = db.execute(
        select(StoryEvent).where(
            StoryEvent.story_id == story_id,
            StoryEvent.event_code.in_(MEANINGFUL_STORY_EVENT_LABELS),
        )
    ).scalars().all()
    candidates: list[tuple[TimelineKey, ScenarioEditSession | StoryEvent]] = []
    candidates.extend(
        (
            (_timeline_timestamp(session.ended_at), 0, session.id),
            session,
        )
        for session in sessions
        if session.ended_at is not None
        and int((session.diff_summary or {}).get("total", 0)) > 0
    )
    candidates.extend(
        (
            (_timeline_timestamp(event.created_at), 1, event.id),
            event,
        )
        for event in events
    )
    candidates.sort(key=lambda candidate: candidate[0], reverse=True)
    if after_key is not None:
        candidates = [candidate for candidate in candidates if candidate[0] < after_key]
    page = candidates[:limit]
    actor_ids = {
        item.actor_user_id
        for _, item in page
        if item.actor_user_id is not None
    }
    actors = {
        user.id: user
        for user in db.execute(select(User).where(User.id.in_(actor_ids))).scalars().all()
    } if actor_ids else {}
    has_more = len(candidates) > limit
    return StoryHistoryResponse(
        story=story,
        items=[
            (
                _item(
                    story_id,
                    item,
                    actors[item.actor_user_id],
                    is_leadership(current_user) and story.archived_at is None,
                )
                if isinstance(item, ScenarioEditSession)
                else _event_item(
                    story_id,
                    item,
                    actors.get(item.actor_user_id),
                )
            )
            for _, item in page
        ],
        next_cursor=_encode_cursor(page[-1][0]) if has_more and page else None,
    )


@router.get(
    "/{story_id}/history/edit-sessions/{edit_session_id}",
    response_model=ScenarioSessionDiffResponse,
)
def get_edit_session_diff(
    story_id: int,
    edit_session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ScenarioSessionDiffResponse:
    from fastapi import HTTPException, status

    story, scenario = _story_and_scenario(db, story_id)
    session = db.get(ScenarioEditSession, edit_session_id)
    if session is None or session.scenario_id != scenario.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "EDIT_SESSION_NOT_FOUND", "message": "Сеанс редактирования не найден"},
        )
    if session.ended_at is None or session.diff_payload is None or session.diff_summary is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SESSION_HAS_NO_SNAPSHOT", "message": "У сеанса нет доступного снимка"},
        )
    actor = db.get(User, session.actor_user_id)
    assert actor is not None
    return ScenarioSessionDiffResponse(
        story=story,
        session=_item(
            story_id,
            session,
            actor,
            is_leadership(current_user) and story.archived_at is None,
        ),
        changes=session.diff_payload.get("changes", []),
    )


@router.get(
    "/{story_id}/history/notifications/{notification_id}",
    response_model=ScenarioSessionDiffResponse,
)
def get_notification_comparison(
    story_id: int,
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ScenarioSessionDiffResponse:
    from fastapi import HTTPException, status

    story, scenario = _story_and_scenario(db, story_id)
    notification = db.get(Notification, notification_id)
    if notification is None or notification.story_id != story_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOTIFICATION_NOT_FOUND", "message": "Уведомление не найдено"},
        )
    if notification.recipient_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "NOTIFICATION_NOT_RECIPIENT",
                "message": "Уведомление адресовано другому пользователю",
            },
        )
    raw_diff = (notification.payload or {}).get("diff")
    session = (
        db.get(ScenarioEditSession, notification.edit_session_id)
        if notification.edit_session_id is not None
        else None
    )
    if (
        not isinstance(raw_diff, dict)
        or session is None
        or session.scenario_id != scenario.id
        or session.ended_at is None
        or session.diff_summary is None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "NOTIFICATION_COMPARISON_UNAVAILABLE",
                "message": "Сохранённое сравнение уведомления недоступно",
            },
        )
    diff = NotificationDiffRef.model_validate(raw_diff)
    actor = db.get(User, session.actor_user_id)
    assert actor is not None
    comparison_item = EditSessionHistoryItem.model_validate({
        **_item(
            story_id,
            session,
            actor,
            is_leadership(current_user) and story.archived_at is None,
        ).model_dump(),
        "from_revision": diff.from_revision,
        "to_revision": diff.to_revision,
        "diff_summary": diff.summary.model_dump(),
        "diff_href": (
            f"/api/v1/stories/{story_id}/history/notifications/{notification_id}"
        ),
    })
    return ScenarioSessionDiffResponse(
        story=story,
        session=comparison_item,
        changes=diff.changes,
    )


@router.post(
    "/{story_id}/history/edit-sessions/{edit_session_id}/restore",
    response_model=CommandAck,
)
def restore_story_edit_session(
    story_id: int,
    edit_session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    scenario, event = restore_edit_session(
        db,
        story_id=story_id,
        edit_session_id=edit_session_id,
        actor=current_user,
    )
    return CommandAck(
        event_id=str(event.id),
        changed_at=event.created_at,
        resource={"type": "scenario", "id": scenario.id},
    )
