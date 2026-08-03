from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_captionpanels_current_user
from app.db.models import Rubric, Scenario, ScenarioRow, Story, User
from app.db.session import get_db
from app.schemas.captionpanels_import import CaptionPanelsImportDocument
from app.schemas.captionpanels_integration import (
    CaptionPanelsProjectChoice,
    CaptionPanelsProjectChoiceListResponse,
    CaptionPanelsStoryChoice,
    CaptionPanelsStoryChoiceListResponse,
)
from app.services.captionpanels_export import (
    CaptionPanelsStoryNotFoundError,
    build_captionpanels_current_export,
    build_story_uid,
)
from app.services.scenario_service import mark_locked_scenario_opened


router = APIRouter(prefix="/api/v1/integrations/captionpanels", tags=["captionpanels"])


def _list_captionpanels_story_choices(
    *,
    search: str | None,
    include_archived: bool,
    limit: int,
    db: Session,
) -> list[CaptionPanelsStoryChoice]:
    """Return the single current-story read model used by both integration aliases."""
    row_counts = (
        select(
            Scenario.story_id.label("story_id"),
            func.count(ScenarioRow.id).label("segment_count"),
            func.coalesce(
                func.sum(case((ScenarioRow.block_type.in_(("snh", "life")), 1), else_=0)), 0
            ).label("sync_segment_count"),
        )
        .join(ScenarioRow, ScenarioRow.scenario_id == Scenario.id, isouter=True)
        .group_by(Scenario.story_id)
        .subquery()
    )
    statement = (
        select(Story, Rubric.name, User.username, row_counts.c.segment_count, row_counts.c.sync_segment_count)
        .join(Rubric, Rubric.id == Story.rubric_id)
        .join(User, User.id == Story.author_user_id)
        .outerjoin(row_counts, row_counts.c.story_id == Story.id)
        .where(Story.archived_at.is_(None) if not include_archived else True)
        .order_by(Story.created_at.desc(), Story.id.desc())
    )
    if search and search.strip():
        needle = f"%{search.strip()}%"
        statement = statement.where(Story.title.ilike(needle) | Rubric.name.ilike(needle))
    records = db.execute(statement.limit(limit)).all()
    items = [
        CaptionPanelsStoryChoice(
            story_id=story.id,
            story_uid=build_story_uid(story.id),
            title=story.title,
            rubric=rubric_name,
            author_username=author_username,
            segment_count=int(segment_count or 0),
            sync_segment_count=int(sync_segment_count or 0),
            created_at=story.created_at,
            archived_at=story.archived_at,
        )
        for story, rubric_name, author_username, segment_count, sync_segment_count in records
    ]
    return items


@router.get("/stories", response_model=CaptionPanelsStoryChoiceListResponse)
def list_captionpanels_stories(
    search: str | None = Query(default=None, max_length=255),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_captionpanels_current_user),
) -> CaptionPanelsStoryChoiceListResponse:
    items = _list_captionpanels_story_choices(
        search=search,
        include_archived=include_archived,
        limit=limit,
        db=db,
    )
    return CaptionPanelsStoryChoiceListResponse(items=items, total=len(items))


@router.get("/projects", response_model=CaptionPanelsProjectChoiceListResponse)
def list_captionpanels_projects(
    search: str | None = Query(default=None, max_length=255),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_captionpanels_current_user),
) -> CaptionPanelsProjectChoiceListResponse:
    story_choices = _list_captionpanels_story_choices(
        search=search,
        include_archived=include_archived,
        limit=limit,
        db=db,
    )
    items = [
        CaptionPanelsProjectChoice(
            project_id=choice.story_id,
            story_uid=choice.story_uid,
            title=choice.title,
            rubric=choice.rubric,
            author_username=choice.author_username,
            segment_count=choice.segment_count,
            sync_segment_count=choice.sync_segment_count,
            created_at=choice.created_at,
            archived_at=choice.archived_at,
        )
        for choice in story_choices
    ]
    return CaptionPanelsProjectChoiceListResponse(items=items, total=len(items))


def _get_captionpanels_import_json(
    *,
    story_id: int,
    db: Session,
    current_user: User,
) -> CaptionPanelsImportDocument:
    try:
        current_export = build_captionpanels_current_export(db, story_id)
    except CaptionPanelsStoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    document = CaptionPanelsImportDocument.model_validate(current_export.payload)
    mark_locked_scenario_opened(
        db,
        story=current_export.story,
        scenario=current_export.scenario,
        actor=current_user,
        context="captionpanels",
        revision_no=current_export.revision,
    )
    return document


@router.get("/stories/{story_id}/import-json", response_model=CaptionPanelsImportDocument, response_model_exclude_none=True)
def get_captionpanels_story_import_json(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_captionpanels_current_user),
) -> CaptionPanelsImportDocument:
    return _get_captionpanels_import_json(
        story_id=story_id,
        db=db,
        current_user=current_user,
    )


@router.get("/projects/{project_id}/import-json", response_model=CaptionPanelsImportDocument, response_model_exclude_none=True)
def get_captionpanels_project_import_json(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_captionpanels_current_user),
) -> CaptionPanelsImportDocument:
    return _get_captionpanels_import_json(
        story_id=project_id,
        db=db,
        current_user=current_user,
    )
