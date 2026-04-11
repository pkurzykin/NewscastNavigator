from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import Project, User
from app.schemas.project import EDIT_STATUS_VALUES
from app.services.project_access import is_archived_project
from app.services.project_events import log_project_event, utcnow


EDIT_STATUS_SET = set(EDIT_STATUS_VALUES)
EDIT_MANAGE_ROLES = {"admin", "editor", "montager"}


def normalize_edit_status(raw_status: str | None) -> str:
    value = (raw_status or "").strip().lower()
    return value if value in EDIT_STATUS_SET else "not_started"


def ensure_edit_manage_role(current_user: User) -> None:
    normalized_role = (current_user.role or "").strip().lower()
    if normalized_role in EDIT_MANAGE_ROLES:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Недостаточно прав для управления монтажом.",
    )


def ensure_edit_track_editable(project: Project) -> None:
    if is_archived_project(project):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архивный проект нельзя менять. Сначала верните его в MAIN.",
        )


def _resolve_edit_sync_seq(project: Project, requested_text_seq: int | None) -> int:
    current_text_seq = project.current_text_seq
    if current_text_seq is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Для монтажа пока нет текущего handoff текста.",
        )
    target_seq = requested_text_seq or current_text_seq
    if target_seq != current_text_seq:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Монтаж можно синхронизировать только с текущей handoff-версией текста.",
        )
    return target_seq


def sync_edit_with_current_text(
    db: Session,
    project: Project,
    *,
    requested_text_seq: int | None,
    actor_user_id: int | None,
) -> tuple[bool, int]:
    ensure_edit_track_editable(project)
    target_seq = _resolve_edit_sync_seq(project, requested_text_seq)
    previous_seq = project.edit_text_seq
    previous_status = normalize_edit_status(project.edit_status)
    changed = previous_seq != target_seq or previous_status == "not_started"

    if changed:
        project.edit_text_seq = target_seq
        project.edit_updated_at = utcnow()
        project.edit_updated_by = actor_user_id
        if previous_status == "not_started":
            project.edit_status = "in_progress"
        log_project_event(
            db,
            project_id=project.id,
            event_type="edit_text_synced",
            actor_user_id=actor_user_id,
            old_value=str(previous_seq) if previous_seq else None,
            new_value=str(target_seq),
            meta={
                "edit_status": normalize_edit_status(project.edit_status),
            },
        )
    return changed, target_seq


def set_edit_status(
    db: Session,
    project: Project,
    *,
    requested_status: str,
    actor_user_id: int | None,
) -> tuple[bool, str]:
    ensure_edit_track_editable(project)
    next_status = normalize_edit_status(requested_status)
    current_status = normalize_edit_status(project.edit_status)
    if next_status != "not_started" and project.edit_text_seq is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сначала нужно привязать текущий текст к монтажу.",
        )
    changed = next_status != current_status
    if changed:
        project.edit_status = next_status
        project.edit_updated_at = utcnow()
        project.edit_updated_by = actor_user_id
        log_project_event(
            db,
            project_id=project.id,
            event_type="edit_status_changed",
            actor_user_id=actor_user_id,
            old_value=current_status,
            new_value=next_status,
            meta={
                "edit_text_seq": project.edit_text_seq,
            },
        )
    return changed, next_status
