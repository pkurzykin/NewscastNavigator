from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import get_current_user, require_roles
from app.db.models import Project, ProjectEvent, ScriptElement, User
from app.db.session import get_db
from app.schemas.project import (
    PROJECT_STATUS_VALUES,
    ProjectActionResponse,
    ProjectCreateRequest,
    ProjectHistoryItem,
    ProjectHistoryResponse,
    ProjectListItem,
    ProjectListResponse,
    UpdateProjectMetaRequest,
)
from app.services.project_events import log_project_event, resolve_restore_status, utcnow


router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

PROJECT_CREATE_ROLES = {"admin", "editor", "author"}
PROJECT_ARCHIVE_ROLES = {"admin", "editor"}
PROJECT_META_EDIT_ROLES = {"admin", "editor", "author"}
PROJECT_ASSIGN_EDIT_ROLES = {"admin", "editor"}
PROJECT_STATUS_EDIT_ROLES = {"admin", "editor", "proofreader"}
PROJECT_STATUS_SET = set(PROJECT_STATUS_VALUES)
ACTIVE_PROJECT_STATUSES = PROJECT_STATUS_SET - {"archived"}


def _normalize_status(raw_status: str | None) -> str:
    value = (raw_status or "").strip().lower()
    return value if value in PROJECT_STATUS_SET else "draft"


def _project_to_item(
    project: Project,
    *,
    author_username: str | None = None,
    executor_username: str | None = None,
    proofreader_username: str | None = None,
    archived_by_username: str | None = None,
) -> ProjectListItem:
    return ProjectListItem(
        id=project.id,
        title=project.title,
        status=project.status,
        rubric=project.rubric,
        planned_duration=project.planned_duration,
        source_project_id=project.source_project_id,
        author_user_id=project.author_user_id,
        author_username=author_username,
        executor_user_id=project.executor_user_id,
        executor_username=executor_username,
        proofreader_user_id=project.proofreader_user_id,
        proofreader_username=proofreader_username,
        archived_at=project.archived_at,
        archived_by_user_id=project.archived_by,
        archived_by_username=archived_by_username,
        status_changed_at=project.status_changed_at,
        status_changed_by_user_id=project.status_changed_by,
        created_at=project.created_at,
    )


def _build_project_row_stmt() -> tuple:
    author_user = aliased(User)
    executor_user = aliased(User)
    proofreader_user = aliased(User)
    archived_by_user = aliased(User)
    stmt = (
        select(
            Project,
            author_user.username,
            executor_user.username,
            proofreader_user.username,
            archived_by_user.username,
        )
        .outerjoin(author_user, author_user.id == Project.author_user_id)
        .outerjoin(executor_user, executor_user.id == Project.executor_user_id)
        .outerjoin(proofreader_user, proofreader_user.id == Project.proofreader_user_id)
        .outerjoin(archived_by_user, archived_by_user.id == Project.archived_by)
    )
    return stmt, author_user, executor_user, proofreader_user, archived_by_user


def _fetch_project_row(
    db: Session,
    project_id: int,
) -> tuple[Project, str | None, str | None, str | None, str | None]:
    stmt, _author_user, _executor_user, _proofreader_user, _archived_by_user = _build_project_row_stmt()
    row = db.execute(stmt.where(Project.id == project_id)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Проект не найден",
        )
    return row[0], row[1], row[2], row[3], row[4]


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
    stmt = stmt.order_by(Project.created_at.desc(), Project.id.desc())

    if view == "archive":
        stmt = stmt.where(Project.status == "archived")
    else:
        stmt = stmt.where(or_(Project.status.is_(None), Project.status != "archived"))

    if search:
        token = f"%{search.strip()}%"
        stmt = stmt.where(Project.title.ilike(token))

    normalized_statuses = [
        _normalize_status(item)
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
        proofreader_user_id=source.proofreader_user_id,
        status_changed_at=utcnow(),
        status_changed_by=current_user.id,
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
                order_index=source_row.order_index,
                block_type=source_row.block_type,
                text=source_row.text,
                speaker_text=source_row.speaker_text,
                file_name=source_row.file_name,
                tc_in=source_row.tc_in,
                tc_out=source_row.tc_out,
                additional_comment=source_row.additional_comment,
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
        proofreader_user_id=source.proofreader_user_id,
        status_changed_at=utcnow(),
        status_changed_by=current_user.id,
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
                order_index=source_row.order_index,
                block_type=source_row.block_type,
                text=source_row.text,
                speaker_text=source_row.speaker_text,
                file_name=source_row.file_name,
                tc_in=source_row.tc_in,
                tc_out=source_row.tc_out,
                additional_comment=source_row.additional_comment,
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
    if _normalize_status(project.status) == "archived":
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
            project.author_user_id = _validate_assignee_id(db, payload.author_user_id)
            changes_applied = True
        if "executor_user_id" in payload.model_fields_set:
            project.executor_user_id = _validate_assignee_id(db, payload.executor_user_id)
            changes_applied = True
        if "proofreader_user_id" in payload.model_fields_set:
            project.proofreader_user_id = _validate_assignee_id(db, payload.proofreader_user_id)
            changes_applied = True

    if "status" in payload.model_fields_set:
        if current_user.role not in PROJECT_STATUS_EDIT_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Недостаточно прав для изменения статуса",
            )
        next_status = _normalize_status(payload.status)
        if next_status == "archived":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Для отправки проекта в архив используйте отдельное действие archive",
            )
        if next_status != _normalize_status(project.status):
            old_status = _normalize_status(project.status)
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
    old_status = _normalize_status(project.status)
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
    if _normalize_status(project.status) != "archived":
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
