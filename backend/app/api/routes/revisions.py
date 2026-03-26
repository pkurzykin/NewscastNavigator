from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Project, ProjectRevision, ProjectRevisionElement, User
from app.db.session import get_db
from app.schemas.editor import ScriptElementRow
from app.schemas.revisions import (
    CreateProjectRevisionRequest,
    ProjectRevisionActionResponse,
    ProjectRevisionDetailResponse,
    ProjectRevisionDiffResponse,
    ProjectRevisionElementsResponse,
    ProjectRevisionHeaderDiffItem,
    ProjectRevisionItem,
    ProjectRevisionListResponse,
    ProjectRevisionRowDiffItem,
    ProjectRevisionDiffSummary,
)
from app.services.project_access import ensure_can_edit_project_content, normalize_project_status
from app.services.project_events import log_project_event
from app.services.project_queries import fetch_project_row as _fetch_project_row
from app.services.project_revisions import (
    build_project_revision_diff,
    create_manual_project_revision,
    ensure_project_baseline_revision,
    get_project_revision_or_none,
    list_project_revisions,
    mark_project_revision_current,
    restore_project_revision_to_workspace,
)
from app.services.structured_fields import (
    normalize_row_formatting,
    parse_json_object,
    rich_text_from_storage,
    structured_data_from_storage,
)


router = APIRouter(prefix="/api/v1/projects", tags=["revisions"])

REVISION_MANAGE_ROLES = {"admin", "editor"}


def _ensure_revision_manage_role(current_user: User) -> None:
    if (current_user.role or "").strip().lower() not in REVISION_MANAGE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для управления версиями текста.",
        )


def _ensure_revision_restore_allowed(current_user: User, project: Project) -> None:
    _ensure_revision_manage_role(current_user)
    if normalize_project_status(project.status) == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архивный проект нельзя восстанавливать в workspace. Сначала верните его в MAIN.",
        )


def _revision_to_item(revision: ProjectRevision) -> ProjectRevisionItem:
    return ProjectRevisionItem(
        id=revision.id,
        project_id=revision.project_id,
        revision_no=revision.revision_no,
        parent_revision_id=revision.parent_revision_id,
        branch_key=revision.branch_key,
        revision_kind=revision.revision_kind,
        status=revision.status,
        title=revision.title,
        comment=revision.comment,
        project_title=revision.project_title,
        project_rubric=revision.project_rubric,
        project_planned_duration=revision.project_planned_duration,
        created_by_user_id=revision.created_by,
        created_by_username=revision.created_by_user.username if revision.created_by_user else None,
        created_at=revision.created_at,
        is_current=revision.is_current,
    )


def _revision_element_to_row(element: ProjectRevisionElement) -> ScriptElementRow:
    formatting = normalize_row_formatting(
        parse_json_object(element.formatting_json),
        block_type=element.block_type or "zk",
    )
    return ScriptElementRow(
        id=None,
        segment_uid=element.segment_uid,
        order_index=element.order_index,
        block_type=element.block_type or "zk",
        text=element.text or "",
        speaker_text=element.speaker_text or "",
        file_name=element.file_name or "",
        tc_in=element.tc_in or "",
        tc_out=element.tc_out or "",
        additional_comment=element.additional_comment or "",
        structured_data=structured_data_from_storage(
            block_type=element.block_type or "zk",
            text=element.text or "",
            content_json=element.content_json,
        ),
        formatting=formatting,
        rich_text=rich_text_from_storage(
            block_type=element.block_type or "zk",
            text=element.text or "",
            speaker_text=element.speaker_text or "",
            content_json=element.content_json,
            formatting_json=element.formatting_json,
            rich_text_json=element.rich_text_json,
        ),
    )


def _ensure_project_and_baseline(
    db: Session,
    *,
    project_id: int,
    current_user: User,
) -> Project:
    project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    _baseline, created = ensure_project_baseline_revision(
        db,
        project=project,
        created_by_user_id=current_user.id,
    )
    if created:
        db.commit()
    return project


@router.get("/{project_id}/revisions", response_model=ProjectRevisionListResponse)
def list_revisions(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectRevisionListResponse:
    _ensure_project_and_baseline(db, project_id=project_id, current_user=current_user)
    items = [_revision_to_item(item) for item in list_project_revisions(db, project_id)]
    return ProjectRevisionListResponse(items=items, total=len(items))


@router.post("/{project_id}/revisions", response_model=ProjectRevisionActionResponse)
def create_revision(
    project_id: int,
    payload: CreateProjectRevisionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectRevisionActionResponse:
    project = _ensure_project_and_baseline(db, project_id=project_id, current_user=current_user)
    ensure_can_edit_project_content(current_user, project)

    revision = create_manual_project_revision(
        db,
        project=project,
        created_by_user_id=current_user.id,
        title=payload.title or "",
        comment=payload.comment or "",
    )
    log_project_event(
        db,
        project_id=project.id,
        event_type="revision_created",
        actor_user_id=current_user.id,
        new_value=f"v{revision.revision_no}",
        meta={
            "revision_id": revision.id,
            "revision_no": revision.revision_no,
            "revision_kind": revision.revision_kind,
        },
    )
    db.commit()
    db.refresh(revision)
    return ProjectRevisionActionResponse(
        message=f"Создана версия v{revision.revision_no}",
        revision=_revision_to_item(revision),
    )


@router.get("/{project_id}/revisions/{revision_id}", response_model=ProjectRevisionDetailResponse)
def get_revision(
    project_id: int,
    revision_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectRevisionDetailResponse:
    _ensure_project_and_baseline(db, project_id=project_id, current_user=current_user)
    revision = get_project_revision_or_none(db, project_id, revision_id)
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Версия не найдена")
    return ProjectRevisionDetailResponse(revision=_revision_to_item(revision))


@router.get("/{project_id}/revisions/{revision_id}/elements", response_model=ProjectRevisionElementsResponse)
def get_revision_elements(
    project_id: int,
    revision_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectRevisionElementsResponse:
    _ensure_project_and_baseline(db, project_id=project_id, current_user=current_user)
    revision = get_project_revision_or_none(db, project_id, revision_id)
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Версия не найдена")
    return ProjectRevisionElementsResponse(
        revision=_revision_to_item(revision),
        elements=[_revision_element_to_row(item) for item in revision.elements],
    )


@router.get("/{project_id}/revisions/{revision_id}/diff", response_model=ProjectRevisionDiffResponse)
def get_revision_diff(
    project_id: int,
    revision_id: str,
    against: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectRevisionDiffResponse:
    _ensure_project_and_baseline(db, project_id=project_id, current_user=current_user)
    revision = get_project_revision_or_none(db, project_id, revision_id)
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Версия не найдена")
    against_revision = get_project_revision_or_none(db, project_id, against)
    if against_revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сравниваемая версия не найдена")

    payload = build_project_revision_diff(
        db,
        revision=revision,
        against_revision=against_revision,
    )
    return ProjectRevisionDiffResponse(
        revision=_revision_to_item(revision),
        against_revision=_revision_to_item(against_revision),
        header_changes=[ProjectRevisionHeaderDiffItem(**item) for item in payload["header_changes"]],
        row_changes=[
            ProjectRevisionRowDiffItem(
                segment_uid=item["segment_uid"],
                change_types=item["change_types"],
                changed_fields=item["changed_fields"],
                order_before=item["order_before"],
                order_after=item["order_after"],
                before_row=_revision_element_to_row(item["before_row"]) if item["before_row"] else None,
                after_row=_revision_element_to_row(item["after_row"]) if item["after_row"] else None,
            )
            for item in payload["row_changes"]
        ],
        summary=ProjectRevisionDiffSummary(**payload["summary"]),
    )


@router.post("/{project_id}/revisions/{revision_id}/restore-to-workspace", response_model=ProjectRevisionActionResponse)
def restore_revision_to_workspace(
    project_id: int,
    revision_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectRevisionActionResponse:
    project = _ensure_project_and_baseline(db, project_id=project_id, current_user=current_user)
    _ensure_revision_restore_allowed(current_user, project)
    revision = get_project_revision_or_none(db, project_id, revision_id)
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Версия не найдена")

    restore_project_revision_to_workspace(db, project=project, revision=revision)
    log_project_event(
        db,
        project_id=project.id,
        event_type="revision_restored_to_workspace",
        actor_user_id=current_user.id,
        new_value=f"v{revision.revision_no}",
        meta={
            "revision_id": revision.id,
            "revision_no": revision.revision_no,
        },
    )
    db.commit()
    db.refresh(revision)
    return ProjectRevisionActionResponse(
        message=f"Workspace восстановлен из версии v{revision.revision_no}",
        revision=_revision_to_item(revision),
    )


@router.post("/{project_id}/revisions/{revision_id}/mark-current", response_model=ProjectRevisionActionResponse)
def mark_revision_current(
    project_id: int,
    revision_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectRevisionActionResponse:
    _ensure_project_and_baseline(db, project_id=project_id, current_user=current_user)
    _ensure_revision_manage_role(current_user)
    revision = get_project_revision_or_none(db, project_id, revision_id)
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Версия не найдена")

    previous_current = next((item for item in list_project_revisions(db, project_id) if item.is_current), None)
    revision = mark_project_revision_current(db, project_id=project_id, revision=revision)
    log_project_event(
        db,
        project_id=project_id,
        event_type="revision_marked_current",
        actor_user_id=current_user.id,
        old_value=f"v{previous_current.revision_no}" if previous_current else None,
        new_value=f"v{revision.revision_no}",
        meta={
            "revision_id": revision.id,
            "revision_no": revision.revision_no,
        },
    )
    db.commit()
    db.refresh(revision)
    return ProjectRevisionActionResponse(
        message=f"Версия v{revision.revision_no} отмечена как текущая",
        revision=_revision_to_item(revision),
    )
