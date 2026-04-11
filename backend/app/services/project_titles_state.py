from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import Project, User
from app.schemas.project import TITLES_STATUS_VALUES
from app.services.project_access import is_archived_project
from app.services.project_events import log_project_event, utcnow


TITLES_STATUS_SET = set(TITLES_STATUS_VALUES)
TITLES_MANAGE_ROLES = {"admin", "editor", "designer"}


def normalize_titles_status(raw_status: str | None) -> str:
    value = (raw_status or "").strip().lower()
    return value if value in TITLES_STATUS_SET else "not_started"


def ensure_titles_manage_role(current_user: User) -> None:
    normalized_role = (current_user.role or "").strip().lower()
    if normalized_role in TITLES_MANAGE_ROLES:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Недостаточно прав для управления титрами.",
    )


def ensure_titles_editable(project: Project) -> None:
    if is_archived_project(project):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архивный проект нельзя менять. Сначала верните его в MAIN.",
        )


def _resolve_titles_sync_seq(project: Project, requested_text_seq: int | None) -> int:
    latest_text_seq = int(project.text_seq or 0)
    current_text_seq = project.current_text_seq
    proofread_text_seq = project.proofread_text_seq
    if latest_text_seq < 1 or current_text_seq is None or proofread_text_seq is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Для титров пока нет текущего вычитанного текста.",
        )
    if current_text_seq != latest_text_seq or proofread_text_seq != latest_text_seq:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Титры можно синхронизировать только по последнему текущему вычитанному тексту.",
        )
    target_seq = requested_text_seq or proofread_text_seq
    if target_seq != proofread_text_seq:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Для титров можно использовать только текущую вычитанную версию текста.",
        )
    return target_seq


def sync_titles_with_proofread_text(
    db: Session,
    project: Project,
    *,
    requested_text_seq: int | None,
    actor_user_id: int | None,
) -> tuple[bool, int]:
    ensure_titles_editable(project)
    target_seq = _resolve_titles_sync_seq(project, requested_text_seq)
    previous_seq = project.titles_text_seq
    previous_status = normalize_titles_status(project.titles_status)
    changed = previous_seq != target_seq or previous_status == "not_started"

    if changed:
        project.titles_text_seq = target_seq
        project.titles_updated_at = utcnow()
        project.titles_updated_by = actor_user_id
        if previous_status == "not_started":
            project.titles_status = "in_progress"
        log_project_event(
            db,
            project_id=project.id,
            event_type="titles_text_synced",
            actor_user_id=actor_user_id,
            old_value=str(previous_seq) if previous_seq else None,
            new_value=str(target_seq),
            meta={
                "titles_status": normalize_titles_status(project.titles_status),
            },
        )
    return changed, target_seq


def set_titles_status(
    db: Session,
    project: Project,
    *,
    requested_status: str,
    actor_user_id: int | None,
) -> tuple[bool, str]:
    ensure_titles_editable(project)
    next_status = normalize_titles_status(requested_status)
    current_status = normalize_titles_status(project.titles_status)
    if next_status != "not_started" and project.titles_text_seq is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сначала нужно привязать вычитанный текст к титрам.",
        )
    changed = next_status != current_status
    if changed:
        project.titles_status = next_status
        project.titles_updated_at = utcnow()
        project.titles_updated_by = actor_user_id
        log_project_event(
            db,
            project_id=project.id,
            event_type="titles_status_changed",
            actor_user_id=actor_user_id,
            old_value=current_status,
            new_value=next_status,
            meta={
                "titles_text_seq": project.titles_text_seq,
            },
        )
    return changed, next_status
