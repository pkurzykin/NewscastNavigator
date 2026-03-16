from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.models import ProjectComment, ProjectFile, User
from app.db.session import get_db
from app.schemas.workspace import (
    AddProjectCommentRequest,
    ProjectCommentItem,
    ProjectFileItem,
    ProjectWorkspaceMeta,
    ProjectWorkspacePayload,
    UpdateWorkspaceRequest,
    WorkspaceActionResponse,
)
from app.services.project_access import ensure_can_edit_project_content
from app.services.project_events import log_project_event
from app.services.project_queries import (
    fetch_project_row as _fetch_project_row,
    project_to_item as _project_to_item,
)


router = APIRouter(prefix="/api/v1/projects", tags=["workspace"])


def _normalize_storage_root() -> Path:
    root_value = (get_settings().storage_root or "").strip()
    root = Path(root_value or "/app/storage").expanduser()
    if not root.is_absolute():
        root = (Path.cwd() / root).resolve()
    return root


def _resolve_project_storage_dir(project_id: int, project_file_root: str) -> Path:
    value = (project_file_root or "").strip()
    storage_root = _normalize_storage_root()

    if value:
        base = Path(value).expanduser()
        if not base.is_absolute():
            base = (storage_root / base).resolve()
        project_dir = base / f"project_{project_id}"
    else:
        project_dir = storage_root / "projects" / str(project_id)

    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir


def _sanitize_file_name(file_name: str) -> str:
    base_name = os.path.basename(file_name or "").strip()
    if not base_name:
        return "upload.bin"
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", base_name)
    sanitized = sanitized.strip("._")
    return sanitized or "upload.bin"


def _comment_to_item(comment: ProjectComment, username: str | None) -> ProjectCommentItem:
    return ProjectCommentItem(
        id=comment.id,
        text=comment.text or "",
        created_at=comment.created_at,
        author_user_id=comment.user_id,
        author_username=username or "-",
    )


def _file_to_item(item: ProjectFile, username: str | None) -> ProjectFileItem:
    file_path = Path(item.storage_path or "")
    return ProjectFileItem(
        id=item.id,
        original_name=item.original_name or "",
        mime_type=item.mime_type or "",
        file_size=int(item.file_size or 0),
        uploaded_at=item.uploaded_at,
        uploaded_by_user_id=item.uploaded_by,
        uploaded_by_username=username or "-",
        exists_on_disk=file_path.exists(),
    )


@router.get("/{project_id}/workspace", response_model=ProjectWorkspacePayload)
def get_project_workspace(
    project_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ProjectWorkspacePayload:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )

    comments_rows = db.execute(
        select(ProjectComment, User.username)
        .outerjoin(User, User.id == ProjectComment.user_id)
        .where(ProjectComment.project_id == project_id)
        .order_by(ProjectComment.created_at.desc(), ProjectComment.id.desc())
    ).all()

    files_rows = db.execute(
        select(ProjectFile, User.username)
        .outerjoin(User, User.id == ProjectFile.uploaded_by)
        .where(ProjectFile.project_id == project_id)
        .order_by(ProjectFile.uploaded_at.desc(), ProjectFile.id.desc())
    ).all()

    return ProjectWorkspacePayload(
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
        workspace=ProjectWorkspaceMeta(
            file_root=(project.project_file_root or ""),
            project_note=(project.project_note or ""),
        ),
        comments=[_comment_to_item(row[0], row[1]) for row in comments_rows],
        files=[_file_to_item(row[0], row[1]) for row in files_rows],
    )


@router.put("/{project_id}/workspace", response_model=WorkspaceActionResponse)
def update_project_workspace(
    project_id: int,
    payload: UpdateWorkspaceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceActionResponse:
    project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_can_edit_project_content(current_user, project)

    project.project_file_root = (payload.file_root or "").strip() or None
    project.project_note = (payload.project_note or "").strip()
    db.add(project)
    db.commit()

    return WorkspaceActionResponse(message="Путь к файлам проекта сохранен")


@router.post("/{project_id}/comments", response_model=ProjectCommentItem)
def add_project_comment(
    project_id: int,
    payload: AddProjectCommentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectCommentItem:
    project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_can_edit_project_content(current_user, project)

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Комментарий не может быть пустым",
        )

    item = ProjectComment(
        project_id=project_id,
        user_id=current_user.id,
        text=text,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _comment_to_item(item, current_user.username)


@router.delete("/{project_id}/comments/{comment_id}", response_model=WorkspaceActionResponse)
def delete_project_comment(
    project_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceActionResponse:
    project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_can_edit_project_content(current_user, project)

    comment = db.execute(
        select(ProjectComment)
        .where(ProjectComment.id == comment_id, ProjectComment.project_id == project_id)
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Комментарий не найден",
        )

    if current_user.role not in {"admin", "editor"} and comment.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Можно удалить только свой комментарий",
        )

    db.delete(comment)
    db.commit()
    return WorkspaceActionResponse(message="Комментарий удален")


@router.post("/{project_id}/files/upload", response_model=ProjectFileItem)
async def upload_project_file(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectFileItem:
    project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_can_edit_project_content(current_user, project)

    extension = Path(file.filename or "").suffix.lower()
    allowed_extensions = get_settings().allowed_upload_extensions_set
    if extension not in allowed_extensions:
        allowed_text = ", ".join(sorted(allowed_extensions))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Недопустимый тип файла: {extension or '(без расширения)'}; разрешены: {allowed_text}",
        )

    content = await file.read()
    size_bytes = len(content)
    max_size_bytes = int(get_settings().max_upload_size_mb) * 1024 * 1024
    if size_bytes <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Файл пустой",
        )
    if size_bytes > max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Слишком большой файл. Лимит: {get_settings().max_upload_size_mb} MB",
        )

    destination_dir = _resolve_project_storage_dir(project_id, project.project_file_root or "") / "project_files"
    destination_dir.mkdir(parents=True, exist_ok=True)
    original_name = _sanitize_file_name(file.filename or "upload.bin")
    time_prefix = datetime.now().strftime("%Y%m%d_%H%M%S")
    final_name = f"{time_prefix}_{original_name}"
    destination_path = destination_dir / final_name

    counter = 1
    while destination_path.exists():
        final_name = f"{time_prefix}_{counter}_{original_name}"
        destination_path = destination_dir / final_name
        counter += 1

    destination_path.write_bytes(content)

    item = ProjectFile(
        project_id=project_id,
        original_name=original_name,
        storage_path=str(destination_path),
        mime_type=file.content_type or "",
        file_size=size_bytes,
        uploaded_by=current_user.id,
    )
    db.add(item)
    db.flush()
    log_project_event(
        db,
        project_id=project_id,
        event_type="file_uploaded",
        actor_user_id=current_user.id,
        new_value=original_name,
        meta={"file_id": item.id, "storage_path": str(destination_path)},
    )
    db.commit()
    db.refresh(item)

    return _file_to_item(item, current_user.username)


@router.delete("/{project_id}/files/{file_id}", response_model=WorkspaceActionResponse)
def delete_project_file(
    project_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkspaceActionResponse:
    project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_can_edit_project_content(current_user, project)

    file_row = db.execute(
        select(ProjectFile)
        .where(ProjectFile.id == file_id, ProjectFile.project_id == project_id)
    ).scalar_one_or_none()
    if file_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл не найден",
        )

    if current_user.role not in {"admin", "editor"} and file_row.uploaded_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Можно удалить только свой файл",
        )

    file_path = Path(file_row.storage_path or "")
    if file_path.exists():
        try:
            file_path.unlink()
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Не удалось удалить файл с диска: {exc}",
            ) from exc

    db.delete(file_row)
    db.commit()
    return WorkspaceActionResponse(message="Файл удален")


@router.get("/{project_id}/files/{file_id}/download")
def download_project_file(
    project_id: int,
    file_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> FileResponse:
    _project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    file_row = db.execute(
        select(ProjectFile)
        .where(ProjectFile.id == file_id, ProjectFile.project_id == project_id)
    ).scalar_one_or_none()
    if file_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл не найден",
        )

    file_path = Path(file_row.storage_path or "")
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Файл отсутствует на диске",
        )

    return FileResponse(
        path=file_path,
        media_type=file_row.mime_type or "application/octet-stream",
        filename=file_row.original_name or file_path.name,
    )
