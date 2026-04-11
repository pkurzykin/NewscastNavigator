from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db.models import Project, ScriptElement, User
from app.services.project_events import log_project_event, utcnow
from app.services.project_queries import project_text_flags
from app.services.project_text_snapshots import (
    TEXT_SNAPSHOT_KIND_CHECKED,
    TEXT_SNAPSHOT_KIND_CURRENT,
    TEXT_SNAPSHOT_KIND_PROOFREAD,
    upsert_project_text_snapshot,
)


CURRENT_TEXT_SET_ROLES = {"admin", "editor", "author", "proofreader"}
TEXT_CHECK_ROLES = {"admin", "editor", "proofreader"}
TEXT_PROOFREAD_ROLES = {"admin", "proofreader"}
TEXT_STATE_ARCHIVE_ERROR = "Архивный проект нельзя изменять. Сначала верните его в MAIN."


def ensure_project_text_state_editable(project: Project) -> None:
    if (project.status or "").strip().lower() == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=TEXT_STATE_ARCHIVE_ERROR,
        )


def ensure_current_text_set_role(current_user: User) -> None:
    if current_user.role not in CURRENT_TEXT_SET_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для назначения текущего текста.",
        )


def ensure_text_check_role(current_user: User) -> None:
    if current_user.role not in TEXT_CHECK_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для отметки проверки текста.",
        )


def ensure_text_proofread_role(current_user: User) -> None:
    if current_user.role not in TEXT_PROOFREAD_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для отметки корректуры.",
        )


def _current_latest_flags(project: Project) -> dict[str, bool]:
    return project_text_flags(project)


def compare_editor_snapshot(
    existing_rows: list[ScriptElement],
    normalized_rows: list[dict[str, Any]],
) -> bool:
    current_snapshot = [
        {
            "id": row.id,
            "order_index": row.order_index,
            "block_type": row.block_type or "zk",
            "text": row.text or "",
            "content_json": row.content_json or "",
            "speaker_text": row.speaker_text or "",
            "file_name": row.file_name or "",
            "tc_in": row.tc_in or "",
            "tc_out": row.tc_out or "",
            "additional_comment": row.additional_comment or "",
            "formatting_json": row.formatting_json or "",
            "rich_text_json": row.rich_text_json or "",
        }
        for row in existing_rows
    ]
    requested_snapshot = [
        {
            "id": int(row["id"]) if row.get("id") is not None else None,
            "order_index": int(row["order_index"]),
            "block_type": str(row["block_type"]),
            "text": str(row["text"]),
            "content_json": str(row["content_json"]),
            "speaker_text": str(row["speaker_text"]),
            "file_name": str(row["file_name"]),
            "tc_in": str(row["tc_in"]),
            "tc_out": str(row["tc_out"]),
            "additional_comment": str(row["additional_comment"]),
            "formatting_json": str(row["formatting_json"]),
            "rich_text_json": str(row["rich_text_json"]),
        }
        for row in normalized_rows
    ]
    return current_snapshot != requested_snapshot


def advance_project_text_seq(
    db: Session,
    project: Project,
    *,
    actor_user_id: int,
    auto_set_current_on_first_text: bool = True,
) -> tuple[int, bool]:
    previous_seq = int(project.text_seq or 0)
    next_seq = previous_seq + 1
    project.text_seq = next_seq

    auto_current_initialized = False
    if auto_set_current_on_first_text and project.current_text_seq is None:
        project.current_text_seq = next_seq
        project.current_text_set_at = utcnow()
        project.current_text_set_by = actor_user_id
        auto_current_initialized = True

    log_project_event(
        db,
        project_id=project.id,
        event_type="text_updated",
        actor_user_id=actor_user_id,
        old_value=str(previous_seq) if previous_seq > 0 else None,
        new_value=str(next_seq),
        meta={"auto_current_initialized": auto_current_initialized},
    )
    return next_seq, auto_current_initialized


def require_existing_text(project: Project) -> None:
    if int(project.text_seq or 0) <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="В проекте еще нет сохраненного текста.",
        )


def resolve_requested_text_seq(project: Project, requested_text_seq: int | None) -> int:
    require_existing_text(project)
    latest_seq = int(project.text_seq or 0)
    if requested_text_seq is None:
        return latest_seq
    if requested_text_seq < 1 or requested_text_seq > latest_seq:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Версия текста #{requested_text_seq} недоступна для проекта.",
        )
    return requested_text_seq


def set_current_text_seq(
    db: Session,
    project: Project,
    *,
    requested_text_seq: int | None,
    actor_user_id: int,
) -> tuple[bool, int]:
    target_seq = resolve_requested_text_seq(project, requested_text_seq)
    if int(project.current_text_seq or 0) == target_seq:
        return False, target_seq

    previous_seq = project.current_text_seq
    project.current_text_seq = target_seq
    project.current_text_set_at = utcnow()
    project.current_text_set_by = actor_user_id
    log_project_event(
        db,
        project_id=project.id,
        event_type="text_current_set",
        actor_user_id=actor_user_id,
        old_value=str(previous_seq) if previous_seq is not None else None,
        new_value=str(target_seq),
    )
    upsert_project_text_snapshot(
        db,
        project=project,
        snapshot_kind=TEXT_SNAPSHOT_KIND_CURRENT,
        text_seq=target_seq,
        created_by_user_id=actor_user_id,
    )
    return True, target_seq


def mark_checked_text(
    db: Session,
    project: Project,
    *,
    requested_text_seq: int | None,
    actor_user_id: int,
) -> tuple[bool, int]:
    current_seq = project.current_text_seq
    if current_seq is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сначала назначьте текущую версию текста.",
        )

    target_seq = resolve_requested_text_seq(project, requested_text_seq)
    if target_seq != current_seq:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Проверка доступна только для текущей версии текста.",
        )
    if project.checked_text_seq == target_seq and _current_latest_flags(project)["checked_text_is_current"]:
        return False, target_seq

    previous_seq = project.checked_text_seq
    project.checked_text_seq = target_seq
    project.checked_at = utcnow()
    project.checked_by = actor_user_id
    log_project_event(
        db,
        project_id=project.id,
        event_type="text_checked",
        actor_user_id=actor_user_id,
        old_value=str(previous_seq) if previous_seq is not None else None,
        new_value=str(target_seq),
    )
    upsert_project_text_snapshot(
        db,
        project=project,
        snapshot_kind=TEXT_SNAPSHOT_KIND_CHECKED,
        text_seq=target_seq,
        created_by_user_id=actor_user_id,
    )
    return True, target_seq


def mark_proofread_text(
    db: Session,
    project: Project,
    *,
    requested_text_seq: int | None,
    actor_user_id: int,
) -> tuple[bool, int]:
    current_seq = project.current_text_seq
    if current_seq is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сначала назначьте текущую версию текста.",
        )

    target_seq = resolve_requested_text_seq(project, requested_text_seq)
    if target_seq != current_seq:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Корректура доступна только для текущей версии текста.",
        )
    if project.proofread_text_seq == target_seq and _current_latest_flags(project)["proofread_text_is_current"]:
        return False, target_seq

    previous_seq = project.proofread_text_seq
    project.proofread_text_seq = target_seq
    project.proofread_at = utcnow()
    project.proofread_by = actor_user_id
    log_project_event(
        db,
        project_id=project.id,
        event_type="text_proofread",
        actor_user_id=actor_user_id,
        old_value=str(previous_seq) if previous_seq is not None else None,
        new_value=str(target_seq),
    )
    upsert_project_text_snapshot(
        db,
        project=project,
        snapshot_kind=TEXT_SNAPSHOT_KIND_PROOFREAD,
        text_seq=target_seq,
        created_by_user_id=actor_user_id,
    )
    return True, target_seq
