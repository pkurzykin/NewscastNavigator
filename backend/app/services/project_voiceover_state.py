from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import Project, User
from app.schemas.project import VOICEOVER_STATUS_VALUES
from app.services.project_access import is_archived_project
from app.services.project_events import log_project_event, utcnow


VOICEOVER_STATUS_SET = set(VOICEOVER_STATUS_VALUES)
VOICEOVER_MANAGE_ROLES = {"admin", "editor", "proofreader"}


def normalize_voiceover_status(raw_status: str | None) -> str:
    value = (raw_status or "").strip().lower()
    return value if value in VOICEOVER_STATUS_SET else "not_started"


def ensure_voiceover_manage_role(current_user: User) -> None:
    normalized_role = (current_user.role or "").strip().lower()
    if normalized_role in VOICEOVER_MANAGE_ROLES:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Недостаточно прав для управления озвучкой.",
    )


def ensure_voiceover_track_editable(project: Project) -> None:
    if is_archived_project(project):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архивный проект нельзя менять. Сначала верните его в MAIN.",
        )


def _resolve_voiceover_sync_seq(project: Project, requested_text_seq: int | None) -> int:
    latest_text_seq = int(project.text_seq or 0)
    current_text_seq = project.current_text_seq
    proofread_text_seq = project.proofread_text_seq
    if latest_text_seq < 1 or current_text_seq is None or proofread_text_seq is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Для озвучки пока нет текущего вычитанного текста.",
        )
    if current_text_seq != latest_text_seq or proofread_text_seq != latest_text_seq:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Озвучку можно синхронизировать только по последнему текущему вычитанному тексту.",
        )
    target_seq = requested_text_seq or proofread_text_seq
    if target_seq != proofread_text_seq:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Для озвучки можно использовать только текущую вычитанную версию текста.",
        )
    return target_seq


def sync_voiceover_with_proofread_text(
    db: Session,
    project: Project,
    *,
    requested_text_seq: int | None,
    actor_user_id: int | None,
) -> tuple[bool, int]:
    ensure_voiceover_track_editable(project)
    target_seq = _resolve_voiceover_sync_seq(project, requested_text_seq)
    previous_seq = project.voiceover_text_seq
    previous_status = normalize_voiceover_status(project.voiceover_status)
    changed = previous_seq != target_seq or previous_status == "not_started"

    if changed:
        project.voiceover_text_seq = target_seq
        project.voiceover_updated_at = utcnow()
        project.voiceover_updated_by = actor_user_id
        if previous_status == "not_started":
            project.voiceover_status = "in_progress"
        log_project_event(
            db,
            project_id=project.id,
            event_type="voiceover_text_synced",
            actor_user_id=actor_user_id,
            old_value=str(previous_seq) if previous_seq else None,
            new_value=str(target_seq),
            meta={
                "voiceover_status": normalize_voiceover_status(project.voiceover_status),
            },
        )
    return changed, target_seq


def set_voiceover_status(
    db: Session,
    project: Project,
    *,
    requested_status: str,
    actor_user_id: int | None,
) -> tuple[bool, str]:
    ensure_voiceover_track_editable(project)
    next_status = normalize_voiceover_status(requested_status)
    current_status = normalize_voiceover_status(project.voiceover_status)
    if next_status != "not_started" and project.voiceover_text_seq is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сначала нужно привязать вычитанный текст к озвучке.",
        )
    changed = next_status != current_status
    if changed:
        project.voiceover_status = next_status
        project.voiceover_updated_at = utcnow()
        project.voiceover_updated_by = actor_user_id
        log_project_event(
            db,
            project_id=project.id,
            event_type="voiceover_status_changed",
            actor_user_id=actor_user_id,
            old_value=current_status,
            new_value=next_status,
            meta={
                "voiceover_text_seq": project.voiceover_text_seq,
            },
        )
    return changed, next_status
