from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import get_current_user
from app.db.models import Project, ScriptElement, User
from app.db.session import get_db
from app.schemas.captionpanels_import import CaptionPanelsImportDocument
from app.schemas.captionpanels_integration import (
    CaptionPanelsProjectChoice,
    CaptionPanelsProjectChoiceListResponse,
)
from app.services.export_service import (
    ExportInputNotFoundError,
    build_captionpanels_import_payload,
    build_story_uid,
)
from app.services.project_access import normalize_project_status


router = APIRouter(prefix="/api/v1/integrations/captionpanels", tags=["captionpanels"])


@router.get("/projects", response_model=CaptionPanelsProjectChoiceListResponse)
def list_captionpanels_projects(
    search: str | None = Query(default=None, max_length=255),
    status_filter: list[str] | None = Query(default=None, alias="status"),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> CaptionPanelsProjectChoiceListResponse:
    author_user = aliased(User)
    row_counts_subquery = (
        select(
            ScriptElement.project_id.label("project_id"),
            func.count(ScriptElement.id).label("segment_count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            ScriptElement.block_type.in_(("snh", "life")),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("sync_segment_count"),
        )
        .group_by(ScriptElement.project_id)
        .subquery()
    )

    stmt = (
        select(
            Project,
            author_user.username,
            func.coalesce(row_counts_subquery.c.segment_count, 0),
            func.coalesce(row_counts_subquery.c.sync_segment_count, 0),
        )
        .outerjoin(author_user, author_user.id == Project.author_user_id)
        .outerjoin(row_counts_subquery, row_counts_subquery.c.project_id == Project.id)
        .order_by(
            func.coalesce(Project.status_changed_at, Project.created_at).desc(),
            Project.id.desc(),
        )
    )

    if not include_archived:
        stmt = stmt.where(or_(Project.status.is_(None), Project.status != "archived"))

    if search:
        token = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Project.title.ilike(token),
                Project.rubric.ilike(token),
            )
        )

    normalized_statuses = [
        normalize_project_status(item)
        for item in (status_filter or [])
        if (item or "").strip()
    ]
    if normalized_statuses:
        stmt = stmt.where(Project.status.in_(sorted(set(normalized_statuses))))

    rows = db.execute(stmt.limit(limit)).all()
    items = [
        CaptionPanelsProjectChoice(
            project_id=project.id,
            story_uid=build_story_uid(project),
            title=project.title,
            rubric=project.rubric,
            planned_duration=project.planned_duration,
            status=project.status,
            author_username=author_username,
            segment_count=int(segment_count or 0),
            sync_segment_count=int(sync_segment_count or 0),
            created_at=project.created_at,
            status_changed_at=project.status_changed_at,
        )
        for project, author_username, segment_count, sync_segment_count in rows
    ]
    return CaptionPanelsProjectChoiceListResponse(items=items, total=len(items))


@router.get(
    "/projects/{project_id}/import-json",
    response_model=CaptionPanelsImportDocument,
    response_model_exclude_none=True,
)
def get_captionpanels_project_import_json(
    project_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> CaptionPanelsImportDocument:
    try:
        payload = build_captionpanels_import_payload(db, project_id)
    except ExportInputNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    return CaptionPanelsImportDocument.model_validate(payload)
