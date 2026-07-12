from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Rubric, Story, User
from app.services.action_policy import can_update_story_metadata


def _error(code: str, message: str, http_status: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def update_story_metadata(db: Session, *, story_id: int, actor: User, title: str | None, rubric_id: int | None) -> Story:
    if title is None and rubric_id is None:
        raise _error("EMPTY_PATCH", "Нужно указать хотя бы одно изменение")
    story = db.get(Story, story_id)
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)
    if story.archived_at is not None:
        raise _error("STORY_ARCHIVED", "Архивный сюжет нельзя изменять")
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
    db.add(story)
    db.commit()
    return story
