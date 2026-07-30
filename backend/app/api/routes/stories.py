from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Rubric, User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.stories import (
    CodeLabel,
    RubricRef,
    StoryCreateOptionsResponse,
    StoryCreateRequest,
    StoryListItem,
    StoryListQuery,
    StoryListResponse,
    StoryManagementPatch,
    StoryMetadataPatch,
    UserRef,
)
from app.services.action_policy import story_create_action
from app.services.permissions import can_create_story, has_function, is_leadership
from app.services.story_queries import get_story_read_model, list_story_read_models
from app.services.story_service import (
    archive_story,
    create_story,
    restore_story,
    update_story_metadata,
    update_story_priority,
)


router = APIRouter(prefix="/api/v1/stories", tags=["stories"])


@router.get("", response_model=StoryListResponse)
def list_stories(
    query: StoryListQuery = Depends(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StoryListResponse:
    items, total = list_story_read_models(db, query, current_user)
    return StoryListResponse(items=items, total=total)


@router.get("/create-options", response_model=StoryCreateOptionsResponse)
def get_story_create_options(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StoryCreateOptionsResponse:
    action = story_create_action(current_user)
    if action is None:
        return StoryCreateOptionsResponse(
            rubrics=[],
            authors=[],
            priority_options=[],
            create_action=None,
        )
    rubrics = list(
        db.execute(
            select(Rubric)
            .where(Rubric.is_active.is_(True))
            .order_by(Rubric.name.asc(), Rubric.id.asc())
        ).scalars()
    )
    if has_function(current_user, "chief"):
        authors = list(
            db.execute(
                select(User)
                .where(User.is_active.is_(True))
                .order_by(User.display_name.asc(), User.id.asc())
            ).scalars()
        )
        authors = [user for user in authors if has_function(user, "author")]
    else:
        authors = [current_user] if can_create_story(current_user) and has_function(current_user, "author") else []
    return StoryCreateOptionsResponse(
        rubrics=[RubricRef(id=item.id, name=item.name) for item in rubrics],
        authors=[
            UserRef(
                id=user.id,
                username=user.username,
                display_name=user.display_name,
                position=user.position,
                function_codes=user.function_codes,
            )
            for user in authors
        ],
        priority_options=[
            CodeLabel(code="standard", label="Стандарт"),
            *(
                [CodeLabel(code="high", label="Высокий")]
                if is_leadership(current_user)
                else []
            ),
        ],
        create_action=action,
    )


@router.post("", response_model=CommandAck)
def post_story(
    payload: StoryCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return create_story(
        db,
        actor=current_user,
        title=payload.title,
        rubric_id=payload.rubric_id,
        author_user_id=payload.author_user_id,
        priority=payload.priority,
    )


@router.get("/{story_id}", response_model=StoryListItem)
def get_story(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StoryListItem:
    item = get_story_read_model(db, story_id, current_user)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "STORY_NOT_FOUND", "message": "Сюжет не найден"},
        )
    return StoryListItem.model_validate(item)


@router.post("/{story_id}/archive", response_model=CommandAck)
def post_archive_story(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return archive_story(db, story_id=story_id, actor=current_user)


@router.post("/{story_id}/restore", response_model=CommandAck)
def post_restore_story(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return restore_story(db, story_id=story_id, actor=current_user)


@router.patch("/{story_id}/metadata", response_model=CommandAck)
def patch_story_metadata(
    story_id: int,
    payload: StoryMetadataPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return update_story_metadata(
        db,
        story_id=story_id,
        actor=current_user,
        title=payload.title,
        rubric_id=payload.rubric_id,
    )


@router.patch("/{story_id}/management", response_model=CommandAck)
def patch_story_management(
    story_id: int,
    payload: StoryManagementPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return update_story_priority(
        db,
        story_id=story_id,
        actor=current_user,
        priority=payload.priority,
    )
