from __future__ import annotations

import base64
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Scenario, ScenarioEditSession, Story, User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.history import (
    EditSessionHistoryItem,
    ScenarioSessionDiffResponse,
    StoryHistoryResponse,
)
from app.schemas.stories import StoryListItem, UserRef
from app.services.permissions import is_leadership
from app.services.scenario_history import restore_edit_session
from app.services.scenario_sessions import expire_current_lease
from app.services.story_queries import get_story_read_model


router = APIRouter(prefix="/api/v1/stories", tags=["history"])


def _cursor_after(cursor: str | None) -> int | None:
    if cursor is None:
        return None
    from fastapi import HTTPException, status

    try:
        decoded = base64.urlsafe_b64decode(cursor.encode("ascii") + b"=" * (-len(cursor) % 4))
        prefix, value = decoded.decode("ascii").split(":", 1)
        if prefix != "session":
            raise ValueError
        return int(value)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "HISTORY_CURSOR_INVALID", "message": "Некорректный cursor истории"},
        ) from exc


def _encode_cursor(session_id: int) -> str:
    return base64.urlsafe_b64encode(f"session:{session_id}".encode("ascii")).decode("ascii").rstrip("=")


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
    after_id = _cursor_after(cursor)
    statement = select(ScenarioEditSession).where(
        ScenarioEditSession.scenario_id == scenario.id,
        ScenarioEditSession.ended_at.is_not(None),
        ScenarioEditSession.diff_summary.is_not(None),
    )
    if after_id is not None:
        statement = statement.where(ScenarioEditSession.id < after_id)
    candidates = db.execute(
        statement.order_by(ScenarioEditSession.id.desc())
    ).scalars().all()
    visible = [session for session in candidates if int((session.diff_summary or {}).get("total", 0)) > 0]
    page = visible[:limit]
    actor_ids = {session.actor_user_id for session in page}
    actors = {
        user.id: user
        for user in db.execute(select(User).where(User.id.in_(actor_ids))).scalars().all()
    } if actor_ids else {}
    has_more = len(visible) > limit
    return StoryHistoryResponse(
        story=story,
        items=[
            _item(
                story_id,
                session,
                actors[session.actor_user_id],
                is_leadership(current_user) and story.archived_at is None,
            )
            for session in page
        ],
        next_cursor=_encode_cursor(page[-1].id) if has_more and page else None,
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
    scenario = restore_edit_session(
        db,
        story_id=story_id,
        edit_session_id=edit_session_id,
        actor=current_user,
    )
    return CommandAck(changed_at=datetime.now(UTC), resource={"type": "scenario", "id": scenario.id})
