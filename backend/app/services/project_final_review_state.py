from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import Project, User
from app.schemas.project import FINAL_REVIEW_STATUS_VALUES
from app.services.project_access import is_archived_project
from app.services.project_events import log_project_event, utcnow


FINAL_REVIEW_STATUS_SET = set(FINAL_REVIEW_STATUS_VALUES)
FINAL_REVIEW_MANAGE_ROLES = {"admin", "editor", "proofreader"}


def normalize_final_review_status(raw_status: str | None) -> str:
    value = (raw_status or "").strip().lower()
    return value if value in FINAL_REVIEW_STATUS_SET else "not_started"


def ensure_final_review_manage_role(current_user: User) -> None:
    normalized_role = (current_user.role or "").strip().lower()
    if normalized_role in FINAL_REVIEW_MANAGE_ROLES:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Недостаточно прав для управления внешней сдачей.",
    )


def ensure_final_review_editable(project: Project) -> None:
    if is_archived_project(project):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архивный проект нельзя менять. Сначала верните его в MAIN.",
        )


def set_final_review_status(
    db: Session,
    project: Project,
    *,
    requested_status: str,
    actor_user_id: int | None,
) -> tuple[bool, str]:
    ensure_final_review_editable(project)
    next_status = normalize_final_review_status(requested_status)
    current_status = normalize_final_review_status(project.final_review_status)
    changed = next_status != current_status
    if changed:
        project.final_review_status = next_status
        project.final_review_updated_at = utcnow()
        project.final_review_updated_by = actor_user_id
        log_project_event(
            db,
            project_id=project.id,
            event_type="final_review_status_changed",
            actor_user_id=actor_user_id,
            old_value=current_status,
            new_value=next_status,
        )
    return changed, next_status
