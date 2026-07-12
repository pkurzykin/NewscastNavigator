from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.common import CommandAck, ResourceRef
from app.schemas.stories import StoryListItem, StoryListQuery, StoryListResponse, StoryMetadataPatch
from app.services.story_queries import get_story_read_model, list_story_read_models
from app.services.story_service import update_story_metadata


router = APIRouter(prefix="/api/v1/stories", tags=["stories"])


@router.get("", response_model=StoryListResponse)
def list_stories(
    query: StoryListQuery = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StoryListResponse:
    items, total = list_story_read_models(db, query, current_user)
    return StoryListResponse(items=items, total=total)


@router.get("/{story_id}", response_model=StoryListItem)
def get_story(
    story_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> StoryListItem:
    item = get_story_read_model(db, story_id)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "STORY_NOT_FOUND", "message": "Сюжет не найден"},
        )
    return StoryListItem.model_validate(item)


@router.patch("/{story_id}/metadata", response_model=CommandAck)
def patch_story_metadata(
    story_id: int,
    payload: StoryMetadataPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    story = update_story_metadata(
        db,
        story_id=story_id,
        actor=current_user,
        title=payload.title,
        rubric_id=payload.rubric_id,
    )
    return CommandAck(changed_at=datetime.now(UTC), resource=ResourceRef(type="story", id=story.id))
