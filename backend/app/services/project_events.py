from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ProjectEvent


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def log_project_event(
    db: Session,
    *,
    project_id: int,
    event_type: str,
    actor_user_id: int | None,
    old_value: str | None = None,
    new_value: str | None = None,
    meta: dict[str, Any] | None = None,
) -> ProjectEvent:
    item = ProjectEvent(
        project_id=project_id,
        event_type=event_type,
        actor_user_id=actor_user_id,
        old_value=old_value,
        new_value=new_value,
        meta_json=json.dumps(meta, ensure_ascii=False, sort_keys=True) if meta else None,
    )
    db.add(item)
    db.flush()
    return item


def resolve_restore_status(
    db: Session,
    *,
    project_id: int,
    fallback_status: str = "draft",
    archived_status: str = "archived",
    allowed_statuses: set[str] | None = None,
) -> str:
    previous_status = db.execute(
        select(ProjectEvent.old_value)
        .where(
            ProjectEvent.project_id == project_id,
            ProjectEvent.event_type == "status_changed",
            ProjectEvent.new_value == archived_status,
        )
        .order_by(ProjectEvent.id.desc())
        .limit(1)
    ).scalar_one_or_none()

    normalized = (previous_status or "").strip().lower()
    if not normalized or normalized == archived_status:
        return fallback_status
    if allowed_statuses is not None and normalized not in allowed_statuses:
        return fallback_status
    return normalized
