from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import get_current_user, require_roles
from app.db.models import Project, ProjectComment, ProjectEvent, ScriptElement, User
from app.db.session import get_db
from app.schemas.project import (
    ProjectActionResponse,
    ProjectCreateRequest,
    ProjectEditStatusRequest,
    ProjectEditTextSyncRequest,
    ProjectFinalReviewStatusRequest,
    ProjectHistoryItem,
    ProjectHistoryResponse,
    ProjectListResponse,
    ProjectTitlesStatusRequest,
    ProjectTitlesTextSyncRequest,
    ProjectTextStateActionRequest,
    ProjectVoiceoverStatusRequest,
    ProjectVoiceoverTextSyncRequest,
    UpdateProjectMetaRequest,
)
from app.schemas.editor import ScriptElementRow
from app.schemas.project_text_state import (
    ProjectTextStateDiffHeaderItem,
    ProjectTextStateDiffResponse,
    ProjectTextStateDiffRowItem,
    ProjectTextStateDiffSummary,
)
from app.services.project_access import ACTIVE_PROJECT_STATUSES, normalize_project_status
from app.services.project_events import log_project_event, resolve_restore_status, utcnow
from app.services.project_queries import (
    build_project_row_stmt as _build_project_row_stmt,
    fetch_project_row as _fetch_project_row,
    project_to_item as _project_to_item,
)
from app.services.project_text_state import (
    ensure_current_text_set_role,
    ensure_project_text_state_editable,
    ensure_text_check_role,
    ensure_text_proofread_role,
    mark_checked_text,
    mark_proofread_text,
    set_current_text_seq,
)
from app.services.project_edit_state import (
    ensure_edit_manage_role,
    ensure_edit_track_editable,
    set_edit_status,
    sync_edit_with_current_text,
)
from app.services.project_final_review_state import (
    ensure_final_review_editable,
    ensure_final_review_manage_role,
    set_final_review_status,
)
from app.services.project_titles_state import (
    ensure_titles_editable,
    ensure_titles_manage_role,
    set_titles_status,
    sync_titles_with_proofread_text,
)
from app.services.project_voiceover_state import (
    ensure_voiceover_manage_role,
    ensure_voiceover_track_editable,
    set_voiceover_status,
    sync_voiceover_with_proofread_text,
)
from app.services.project_text_snapshots import (
    TEXT_SNAPSHOT_KIND_CHECKED,
    TEXT_SNAPSHOT_KIND_CURRENT,
    TEXT_SNAPSHOT_KIND_PROOFREAD,
    build_project_text_snapshot_diff,
)
from app.services.segment_ids import generate_segment_uid
from app.services.structured_fields import (
    dump_int_list_json,
    normalize_row_formatting,
    parse_int_list_json,
    parse_json_object,
    rich_text_from_storage,
    structured_data_from_storage,
)


router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

PROJECT_CREATE_ROLES = {"admin", "editor", "author"}
PROJECT_ARCHIVE_ROLES = {"admin", "editor"}
PROJECT_META_EDIT_ROLES = {"admin", "editor", "author"}
PROJECT_ASSIGN_EDIT_ROLES = {"admin", "editor"}
PROJECT_STATUS_EDIT_ROLES = {"admin", "editor", "proofreader"}
TITLES_ASSIGNEE_ROLES = {"admin", "editor", "designer"}
EDIT_ASSIGNEE_ROLES = {"admin", "editor", "montager"}


def _element_to_row(element: ScriptElement) -> ScriptElementRow:
    formatting = normalize_row_formatting(
        parse_json_object(element.formatting_json),
        block_type=element.block_type or "zk",
    )
    return ScriptElementRow(
        id=element.id,
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


def _build_clone_title(source_title: str) -> str:
    raw_title = f"{source_title} (копия)"
    return raw_title[:255]


def _validate_assignee_id(db: Session, user_id: int | None) -> int | None:
    if user_id is None:
        return None
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Пользователь #{user_id} не найден",
        )
    return user.id


def _validate_assignee_role(
    db: Session,
    user_id: int | None,
    *,
    allowed_roles: set[str],
    field_label: str,
) -> int | None:
    normalized_id = _validate_assignee_id(db, user_id)
    if normalized_id is None:
        return None
    user = db.execute(select(User).where(User.id == normalized_id)).scalar_one()
    normalized_role = (user.role or "").strip().lower()
    if normalized_role not in allowed_roles:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Для поля «{field_label}» подходит роль "
                f"{', '.join(sorted(allowed_roles))}, а у пользователя #{normalized_id} роль {user.role!r}"
            ),
        )
    return normalized_id


def _validate_assignee_ids(db: Session, user_ids: list[int] | None) -> list[int]:
    validated: list[int] = []
    seen: set[int] = set()
    for user_id in user_ids or []:
        normalized_id = _validate_assignee_id(db, user_id)
        if normalized_id is None or normalized_id in seen:
            continue
        seen.add(normalized_id)
        validated.append(normalized_id)
    return validated


def _log_assignment_change(
    db: Session,
    *,
    project_id: int,
    actor_user_id: int,
    field_name: str,
    old_value: int | None,
    new_value: int | None,
) -> None:
    if old_value == new_value:
        return
    log_project_event(
        db,
        project_id=project_id,
        event_type="assignment_changed",
        actor_user_id=actor_user_id,
        old_value=str(old_value) if old_value is not None else None,
        new_value=str(new_value) if new_value is not None else None,
        meta={"field": field_name},
    )


@router.get("", response_model=ProjectListResponse)
def list_projects(
    view: Literal["main", "archive"] = Query(default="main"),
    search: str | None = Query(default=None, max_length=255),
    status_filter: list[str] | None = Query(default=None, alias="status"),
    rubric: str | None = Query(default=None, max_length=120),
    participant: str | None = Query(default=None, max_length=120),
    created_from: date | None = Query(default=None),
    created_to: date | None = Query(default=None),
    archived_by: str | None = Query(default=None, max_length=120),
    archived_from: date | None = Query(default=None),
    archived_to: date | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ProjectListResponse:
    stmt, author_user, executor_user, proofreader_user, archived_by_user = _build_project_row_stmt()
    comment_stats_subquery = (
        select(
            ProjectComment.project_id.label("project_id"),
            func.sum(
                case(
                    (
                        ProjectComment.requires_action.is_(True)
                        & ProjectComment.is_resolved.is_(False),
                        1,
                    ),
                    else_=0,
                )
            ).label("open_action_comment_count"),
            func.sum(
                case(
                    (
                        ProjectComment.requires_action.is_(True)
                        & ProjectComment.is_resolved.is_(False)
                        & (ProjectComment.target_kind == "text"),
                        1,
                    ),
                    else_=0,
                )
            ).label("open_text_action_comment_count"),
            func.sum(
                case(
                    (
                        ProjectComment.requires_action.is_(True)
                        & ProjectComment.is_resolved.is_(False)
                        & (ProjectComment.target_kind == "edit"),
                        1,
                    ),
                    else_=0,
                )
            ).label("open_edit_action_comment_count"),
            func.sum(
                case(
                    (
                        ProjectComment.requires_action.is_(True)
                        & ProjectComment.is_resolved.is_(False)
                        & (ProjectComment.target_kind == "titles"),
                        1,
                    ),
                    else_=0,
                )
            ).label("open_titles_action_comment_count"),
            func.sum(
                case(
                    (
                        ProjectComment.requires_action.is_(True)
                        & ProjectComment.is_resolved.is_(False)
                        & (ProjectComment.target_kind == "voiceover"),
                        1,
                    ),
                    else_=0,
                )
            ).label("open_voiceover_action_comment_count"),
        )
        .group_by(ProjectComment.project_id)
        .subquery()
    )
    stmt = stmt.add_columns(
        comment_stats_subquery.c.open_action_comment_count,
        comment_stats_subquery.c.open_text_action_comment_count,
        comment_stats_subquery.c.open_edit_action_comment_count,
        comment_stats_subquery.c.open_titles_action_comment_count,
        comment_stats_subquery.c.open_voiceover_action_comment_count,
    ).outerjoin(comment_stats_subquery, comment_stats_subquery.c.project_id == Project.id)
    stmt = stmt.order_by(Project.created_at.desc(), Project.id.desc())

    if view == "archive":
        stmt = stmt.where(Project.status == "archived")
    else:
        stmt = stmt.where(or_(Project.status.is_(None), Project.status != "archived"))

    if search:
        token = f"%{search.strip()}%"
        stmt = stmt.where(Project.title.ilike(token))

    normalized_statuses = [
        normalize_project_status(item)
        for item in (status_filter or [])
        if (item or "").strip()
    ]
    if normalized_statuses:
        stmt = stmt.where(Project.status.in_(sorted(set(normalized_statuses))))

    if rubric:
        stmt = stmt.where(Project.rubric.ilike(f"%{rubric.strip()}%"))

    if participant:
        participant_token = f"%{participant.strip()}%"
        stmt = stmt.where(
            or_(
                author_user.username.ilike(participant_token),
                executor_user.username.ilike(participant_token),
                proofreader_user.username.ilike(participant_token),
            )
        )

    if created_from is not None:
        stmt = stmt.where(func.date(Project.created_at) >= created_from)
    if created_to is not None:
        stmt = stmt.where(func.date(Project.created_at) <= created_to)

    if archived_by:
        stmt = stmt.where(archived_by_user.username.ilike(f"%{archived_by.strip()}%"))
    if archived_from is not None:
        stmt = stmt.where(func.date(Project.archived_at) >= archived_from)
    if archived_to is not None:
        stmt = stmt.where(func.date(Project.archived_at) <= archived_to)

    rows = db.execute(stmt.limit(limit)).all()
    items = [
        _project_to_item(
            row[0],
            author_username=row[1],
            executor_username=row[2],
            proofreader_username=row[3],
            archived_by_username=row[4],
            open_action_comment_count=row[5] or 0,
            open_text_action_comment_count=row[6] or 0,
            open_edit_action_comment_count=row[7] or 0,
            open_titles_action_comment_count=row[8] or 0,
            open_voiceover_action_comment_count=row[9] or 0,
        )
        for row in rows
    ]
    return ProjectListResponse(items=items, total=len(items))


@router.post("", response_model=ProjectActionResponse)
def create_project(
    payload: ProjectCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(PROJECT_CREATE_ROLES)),
) -> ProjectActionResponse:
    now = utcnow()
    title = (payload.title or "").strip()
    if not title:
        title = f"Новый сюжет {now.strftime('%d.%m.%Y %H:%M')}"

    project = Project(
        title=title[:255],
        status="draft",
        rubric=(payload.rubric or "").strip()[:120] or None,
        planned_duration=(payload.planned_duration or "").strip()[:32] or None,
        project_note="",
        author_user_id=current_user.id,
        executor_user_ids_json="",
        project_file_roots_json="",
        titles_assignee_user_id=None,
        edit_assignee_user_id=None,
        text_seq=0,
        status_changed_at=now,
        status_changed_by=current_user.id,
    )
    db.add(project)
    db.flush()

    log_project_event(
        db,
        project_id=project.id,
        event_type="project_created",
        actor_user_id=current_user.id,
    )

    db.commit()
    db.refresh(project)

    return ProjectActionResponse(
        message="Создан новый проект",
        project=_project_to_item(project, author_username=current_user.username),
    )


@router.post("/clone-last", response_model=ProjectActionResponse)
def clone_last_project(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(PROJECT_CREATE_ROLES)),
) -> ProjectActionResponse:
    source = db.execute(
        select(Project)
        .where(or_(Project.status.is_(None), Project.status != "archived"))
        .order_by(Project.created_at.desc(), Project.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Не найден проект для копирования",
        )
    source_has_rows = (
        db.execute(
            select(ScriptElement.id)
            .where(ScriptElement.project_id == source.id)
            .limit(1)
        ).first()
        is not None
    )
    clone_now = utcnow()

    cloned = Project(
        title=_build_clone_title(source.title),
        status="draft",
        rubric=source.rubric,
        planned_duration=source.planned_duration,
        source_project_id=source.id,
        project_file_root=source.project_file_root,
        project_note=source.project_note or "",
        author_user_id=current_user.id,
        executor_user_id=source.executor_user_id,
        executor_user_ids_json=source.executor_user_ids_json,
        proofreader_user_id=source.proofreader_user_id,
        titles_assignee_user_id=source.titles_assignee_user_id,
        edit_assignee_user_id=source.edit_assignee_user_id,
        status_changed_at=clone_now,
        status_changed_by=current_user.id,
        project_file_roots_json=source.project_file_roots_json,
        text_seq=1 if source_has_rows else 0,
        current_text_seq=1 if source_has_rows else None,
        current_text_set_at=clone_now if source_has_rows else None,
        current_text_set_by=current_user.id if source_has_rows else None,
    )
    db.add(cloned)
    db.flush()

    source_rows = db.execute(
        select(ScriptElement)
        .where(ScriptElement.project_id == source.id)
        .order_by(ScriptElement.order_index.asc(), ScriptElement.id.asc())
    ).scalars().all()
    for source_row in source_rows:
        db.add(
            ScriptElement(
                project_id=cloned.id,
                segment_uid=generate_segment_uid(),
                order_index=source_row.order_index,
                block_type=source_row.block_type,
                text=source_row.text,
                content_json=source_row.content_json,
                speaker_text=source_row.speaker_text,
                file_name=source_row.file_name,
                tc_in=source_row.tc_in,
                tc_out=source_row.tc_out,
                additional_comment=source_row.additional_comment,
                formatting_json=source_row.formatting_json,
                rich_text_json=source_row.rich_text_json,
            )
        )

    log_project_event(
        db,
        project_id=cloned.id,
        event_type="project_cloned",
        actor_user_id=current_user.id,
        old_value=str(source.id),
        meta={"source_project_id": source.id},
    )

    db.commit()
    cloned, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        cloned.id,
    )

    return ProjectActionResponse(
        message=f"Создан новый проект на основе последнего (#{source.id})",
        project=_project_to_item(
            cloned,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/clone", response_model=ProjectActionResponse)
def clone_selected_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(PROJECT_CREATE_ROLES)),
) -> ProjectActionResponse:
    source, _author_username, executor_username, proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    source_has_rows = (
        db.execute(
            select(ScriptElement.id)
            .where(ScriptElement.project_id == source.id)
            .limit(1)
        ).first()
        is not None
    )
    clone_now = utcnow()

    cloned = Project(
        title=_build_clone_title(source.title),
        status="draft",
        rubric=source.rubric,
        planned_duration=source.planned_duration,
        source_project_id=source.id,
        project_file_root=source.project_file_root,
        project_note=source.project_note or "",
        author_user_id=current_user.id,
        executor_user_id=source.executor_user_id,
        executor_user_ids_json=source.executor_user_ids_json,
        proofreader_user_id=source.proofreader_user_id,
        titles_assignee_user_id=source.titles_assignee_user_id,
        edit_assignee_user_id=source.edit_assignee_user_id,
        status_changed_at=clone_now,
        status_changed_by=current_user.id,
        project_file_roots_json=source.project_file_roots_json,
        text_seq=1 if source_has_rows else 0,
        current_text_seq=1 if source_has_rows else None,
        current_text_set_at=clone_now if source_has_rows else None,
        current_text_set_by=current_user.id if source_has_rows else None,
    )
    db.add(cloned)
    db.flush()

    source_rows = db.execute(
        select(ScriptElement)
        .where(ScriptElement.project_id == source.id)
        .order_by(ScriptElement.order_index.asc(), ScriptElement.id.asc())
    ).scalars().all()
    for source_row in source_rows:
        db.add(
            ScriptElement(
                project_id=cloned.id,
                segment_uid=generate_segment_uid(),
                order_index=source_row.order_index,
                block_type=source_row.block_type,
                text=source_row.text,
                content_json=source_row.content_json,
                speaker_text=source_row.speaker_text,
                file_name=source_row.file_name,
                tc_in=source_row.tc_in,
                tc_out=source_row.tc_out,
                additional_comment=source_row.additional_comment,
                formatting_json=source_row.formatting_json,
                rich_text_json=source_row.rich_text_json,
            )
        )

    log_project_event(
        db,
        project_id=cloned.id,
        event_type="project_cloned",
        actor_user_id=current_user.id,
        old_value=str(source.id),
        meta={"source_project_id": source.id},
    )

    db.commit()
    cloned, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        cloned.id,
    )

    return ProjectActionResponse(
        message=f"Создан новый проект на основе выбранного (#{source.id})",
        project=_project_to_item(
            cloned,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.put("/{project_id}/meta", response_model=ProjectActionResponse)
def update_project_meta(
    project_id: int,
    payload: UpdateProjectMetaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    if normalize_project_status(project.status) == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архивный проект нельзя редактировать. Сначала верните его в MAIN.",
        )

    changes_applied = False

    if current_user.role in PROJECT_META_EDIT_ROLES:
        if "title" in payload.model_fields_set:
            project.title = (payload.title or "").strip()[:255] or "Новый проект"
            changes_applied = True
        if "rubric" in payload.model_fields_set:
            project.rubric = (payload.rubric or "").strip()[:120] or None
            changes_applied = True
        if "planned_duration" in payload.model_fields_set:
            project.planned_duration = (payload.planned_duration or "").strip()[:32] or None
            changes_applied = True

    if current_user.role in PROJECT_ASSIGN_EDIT_ROLES:
        if "author_user_id" in payload.model_fields_set:
            next_author_user_id = _validate_assignee_id(db, payload.author_user_id)
            _log_assignment_change(
                db,
                project_id=project.id,
                actor_user_id=current_user.id,
                field_name="author_user_id",
                old_value=project.author_user_id,
                new_value=next_author_user_id,
            )
            project.author_user_id = next_author_user_id
            changes_applied = True
        if "executor_user_ids" in payload.model_fields_set:
            executor_user_ids = _validate_assignee_ids(db, payload.executor_user_ids)
            previous_executor_ids_json = project.executor_user_ids_json
            project.executor_user_id = executor_user_ids[0] if executor_user_ids else None
            project.executor_user_ids_json = dump_int_list_json(executor_user_ids) or None
            if previous_executor_ids_json != project.executor_user_ids_json:
                log_project_event(
                    db,
                    project_id=project.id,
                    event_type="assignment_changed",
                    actor_user_id=current_user.id,
                    old_value=previous_executor_ids_json,
                    new_value=project.executor_user_ids_json,
                    meta={"field": "executor_user_ids"},
                )
            changes_applied = True
        elif "executor_user_id" in payload.model_fields_set:
            executor_user_id = _validate_assignee_id(db, payload.executor_user_id)
            previous_executor_ids_json = project.executor_user_ids_json
            project.executor_user_id = executor_user_id
            project.executor_user_ids_json = (
                dump_int_list_json([executor_user_id]) if executor_user_id else None
            )
            if previous_executor_ids_json != project.executor_user_ids_json:
                log_project_event(
                    db,
                    project_id=project.id,
                    event_type="assignment_changed",
                    actor_user_id=current_user.id,
                    old_value=previous_executor_ids_json,
                    new_value=project.executor_user_ids_json,
                    meta={"field": "executor_user_ids"},
                )
            changes_applied = True
        if "proofreader_user_id" in payload.model_fields_set:
            next_proofreader_user_id = _validate_assignee_id(db, payload.proofreader_user_id)
            _log_assignment_change(
                db,
                project_id=project.id,
                actor_user_id=current_user.id,
                field_name="proofreader_user_id",
                old_value=project.proofreader_user_id,
                new_value=next_proofreader_user_id,
            )
            project.proofreader_user_id = next_proofreader_user_id
            changes_applied = True
        if "titles_assignee_user_id" in payload.model_fields_set:
            next_titles_assignee_user_id = _validate_assignee_role(
                db,
                payload.titles_assignee_user_id,
                allowed_roles=TITLES_ASSIGNEE_ROLES,
                field_label="Ответственный за титры",
            )
            _log_assignment_change(
                db,
                project_id=project.id,
                actor_user_id=current_user.id,
                field_name="titles_assignee_user_id",
                old_value=project.titles_assignee_user_id,
                new_value=next_titles_assignee_user_id,
            )
            project.titles_assignee_user_id = next_titles_assignee_user_id
            changes_applied = True
        if "edit_assignee_user_id" in payload.model_fields_set:
            next_edit_assignee_user_id = _validate_assignee_role(
                db,
                payload.edit_assignee_user_id,
                allowed_roles=EDIT_ASSIGNEE_ROLES,
                field_label="Ответственный за монтаж",
            )
            _log_assignment_change(
                db,
                project_id=project.id,
                actor_user_id=current_user.id,
                field_name="edit_assignee_user_id",
                old_value=project.edit_assignee_user_id,
                new_value=next_edit_assignee_user_id,
            )
            project.edit_assignee_user_id = next_edit_assignee_user_id
            changes_applied = True

    if "status" in payload.model_fields_set:
        if current_user.role not in PROJECT_STATUS_EDIT_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Недостаточно прав для изменения статуса",
            )
        next_status = normalize_project_status(payload.status)
        if next_status == "archived":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Для отправки проекта в архив используйте отдельное действие archive",
            )
        if next_status != normalize_project_status(project.status):
            old_status = normalize_project_status(project.status)
            project.status = next_status
            project.status_changed_at = utcnow()
            project.status_changed_by = current_user.id
            log_project_event(
                db,
                project_id=project.id,
                event_type="status_changed",
                actor_user_id=current_user.id,
                old_value=old_status,
                new_value=next_status,
            )
            changes_applied = True

    if not changes_applied:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нет изменений для сохранения или недостаточно прав",
        )

    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )

    return ProjectActionResponse(
        message="Метаданные проекта обновлены",
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/text/current", response_model=ProjectActionResponse)
def set_project_current_text(
    project_id: int,
    payload: ProjectTextStateActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_project_text_state_editable(project)
    ensure_current_text_set_role(current_user)

    changed, target_seq = set_current_text_seq(
        db,
        project,
        requested_text_seq=payload.text_seq,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Текущей назначена версия текста #{target_seq}"
        if changed
        else f"Версия текста #{target_seq} уже назначена текущей"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/text/check", response_model=ProjectActionResponse)
def check_project_current_text(
    project_id: int,
    payload: ProjectTextStateActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_project_text_state_editable(project)
    ensure_text_check_role(current_user)

    changed, target_seq = mark_checked_text(
        db,
        project,
        requested_text_seq=payload.text_seq,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Версия текста #{target_seq} отмечена как проверенная"
        if changed
        else f"Версия текста #{target_seq} уже отмечена как проверенная"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/text/proofread", response_model=ProjectActionResponse)
def proofread_project_current_text(
    project_id: int,
    payload: ProjectTextStateActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_project_text_state_editable(project)
    ensure_text_proofread_role(current_user)

    changed, target_seq = mark_proofread_text(
        db,
        project,
        requested_text_seq=payload.text_seq,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Версия текста #{target_seq} отмечена как вычитанная"
        if changed
        else f"Версия текста #{target_seq} уже отмечена как вычитанная"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.get("/{project_id}/text/{snapshot_kind}/diff", response_model=ProjectTextStateDiffResponse)
def get_project_text_state_diff(
    project_id: int,
    snapshot_kind: str,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ProjectTextStateDiffResponse:
    if snapshot_kind not in {
        TEXT_SNAPSHOT_KIND_CURRENT,
        TEXT_SNAPSHOT_KIND_CHECKED,
        TEXT_SNAPSHOT_KIND_PROOFREAD,
    }:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Неизвестный тип снимка текста",
        )

    project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    payload = build_project_text_snapshot_diff(
        db,
        project=project,
        snapshot_kind=snapshot_kind,
    )
    snapshot = payload["snapshot"]
    return ProjectTextStateDiffResponse(
        snapshot_kind=snapshot.snapshot_kind,
        snapshot_text_seq=snapshot.text_seq,
        workspace_text_seq=int(project.text_seq or 0),
        snapshot_created_at=snapshot.created_at,
        snapshot_created_by_user_id=snapshot.created_by,
        is_outdated=payload["is_outdated"],
        header_changes=[
            ProjectTextStateDiffHeaderItem(**item) for item in payload["header_changes"]
        ],
        row_changes=[
            ProjectTextStateDiffRowItem(
                segment_uid=item["segment_uid"],
                change_types=item["change_types"],
                changed_fields=item["changed_fields"],
                order_before=item["order_before"],
                order_after=item["order_after"],
                before_row=_element_to_row(item["before_row"]) if item["before_row"] else None,
                after_row=_element_to_row(item["after_row"]) if item["after_row"] else None,
            )
            for item in payload["row_changes"]
        ],
        summary=ProjectTextStateDiffSummary(**payload["summary"]),
    )


@router.post("/{project_id}/titles/sync-text", response_model=ProjectActionResponse)
def sync_project_titles_text(
    project_id: int,
    payload: ProjectTitlesTextSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_titles_editable(project)
    ensure_titles_manage_role(current_user)

    changed, target_seq = sync_titles_with_proofread_text(
        db,
        project,
        requested_text_seq=payload.text_seq,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Титры синхронизированы с вычитанным текстом #{target_seq}"
        if changed
        else f"Титры уже привязаны к вычитанному тексту #{target_seq}"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/titles/status", response_model=ProjectActionResponse)
def update_project_titles_status(
    project_id: int,
    payload: ProjectTitlesStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_titles_editable(project)
    ensure_titles_manage_role(current_user)

    changed, next_status = set_titles_status(
        db,
        project,
        requested_status=payload.status,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Статус титров обновлен: {next_status}"
        if changed
        else f"Статус титров уже установлен: {next_status}"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/edit/sync-text", response_model=ProjectActionResponse)
def sync_project_edit_text(
    project_id: int,
    payload: ProjectEditTextSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_edit_track_editable(project)
    ensure_edit_manage_role(current_user)

    changed, target_seq = sync_edit_with_current_text(
        db,
        project,
        requested_text_seq=payload.text_seq,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Монтаж синхронизирован с текущим текстом #{target_seq}"
        if changed
        else f"Монтаж уже привязан к текущему тексту #{target_seq}"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/edit/status", response_model=ProjectActionResponse)
def update_project_edit_status(
    project_id: int,
    payload: ProjectEditStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_edit_track_editable(project)
    ensure_edit_manage_role(current_user)

    changed, next_status = set_edit_status(
        db,
        project,
        requested_status=payload.status,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Статус монтажа обновлен: {next_status}"
        if changed
        else f"Статус монтажа уже установлен: {next_status}"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/voiceover/sync-text", response_model=ProjectActionResponse)
def sync_project_voiceover_text(
    project_id: int,
    payload: ProjectVoiceoverTextSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_voiceover_track_editable(project)
    ensure_voiceover_manage_role(current_user)

    changed, target_seq = sync_voiceover_with_proofread_text(
        db,
        project,
        requested_text_seq=payload.text_seq,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Озвучка синхронизирована с вычитанным текстом #{target_seq}"
        if changed
        else f"Озвучка уже привязана к вычитанному тексту #{target_seq}"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/voiceover/status", response_model=ProjectActionResponse)
def update_project_voiceover_status(
    project_id: int,
    payload: ProjectVoiceoverStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_voiceover_track_editable(project)
    ensure_voiceover_manage_role(current_user)

    changed, next_status = set_voiceover_status(
        db,
        project,
        requested_status=payload.status,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Статус озвучки обновлен: {next_status}"
        if changed
        else f"Статус озвучки уже установлен: {next_status}"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/final-review/status", response_model=ProjectActionResponse)
def update_project_final_review_status(
    project_id: int,
    payload: ProjectFinalReviewStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_final_review_editable(project)
    ensure_final_review_manage_role(current_user)

    changed, next_status = set_final_review_status(
        db,
        project,
        requested_status=payload.status,
        actor_user_id=current_user.id,
    )
    db.add(project)
    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    message = (
        f"Статус внешней сдачи обновлен: {next_status}"
        if changed
        else f"Статус внешней сдачи уже установлен: {next_status}"
    )
    return ProjectActionResponse(
        message=message,
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.get("/{project_id}/history", response_model=ProjectHistoryResponse)
def get_project_history(
    project_id: int,
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ProjectHistoryResponse:
    _project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    actor_user = aliased(User)
    rows = db.execute(
        select(ProjectEvent, actor_user.username)
        .outerjoin(actor_user, actor_user.id == ProjectEvent.actor_user_id)
        .where(ProjectEvent.project_id == project_id)
        .order_by(ProjectEvent.created_at.desc(), ProjectEvent.id.desc())
        .limit(limit)
    ).all()

    items = [
        ProjectHistoryItem(
            id=row[0].id,
            event_type=row[0].event_type,
            old_value=row[0].old_value,
            new_value=row[0].new_value,
            actor_user_id=row[0].actor_user_id,
            actor_username=row[1] or "-",
            created_at=row[0].created_at,
            meta_json=row[0].meta_json,
        )
        for row in rows
    ]
    return ProjectHistoryResponse(items=items, total=len(items))


@router.post("/{project_id}/archive", response_model=ProjectActionResponse)
def archive_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(PROJECT_ARCHIVE_ROLES)),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    old_status = normalize_project_status(project.status)
    if old_status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Проект уже находится в архиве",
        )

    now = utcnow()
    project.status = "archived"
    project.archived_at = now
    project.archived_by = current_user.id
    project.status_changed_at = now
    project.status_changed_by = current_user.id
    db.add(project)

    log_project_event(
        db,
        project_id=project.id,
        event_type="status_changed",
        actor_user_id=current_user.id,
        old_value=old_status,
        new_value="archived",
    )
    log_project_event(
        db,
        project_id=project.id,
        event_type="project_archived",
        actor_user_id=current_user.id,
    )

    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )

    return ProjectActionResponse(
        message="Проект отправлен в архив",
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )


@router.post("/{project_id}/restore", response_model=ProjectActionResponse)
def restore_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(PROJECT_ARCHIVE_ROLES)),
) -> ProjectActionResponse:
    project, author_username, executor_username, proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    if normalize_project_status(project.status) != "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Проект уже находится в рабочем списке",
        )

    restore_status = resolve_restore_status(
        db,
        project_id=project.id,
        fallback_status="draft",
        allowed_statuses=ACTIVE_PROJECT_STATUSES,
    )
    now = utcnow()
    project.status = restore_status
    project.archived_at = None
    project.archived_by = None
    project.status_changed_at = now
    project.status_changed_by = current_user.id
    db.add(project)

    log_project_event(
        db,
        project_id=project.id,
        event_type="status_changed",
        actor_user_id=current_user.id,
        old_value="archived",
        new_value=restore_status,
    )
    log_project_event(
        db,
        project_id=project.id,
        event_type="project_restored",
        actor_user_id=current_user.id,
    )

    db.commit()
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )

    return ProjectActionResponse(
        message="Проект возвращен в MAIN",
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
    )
