from __future__ import annotations

from datetime import datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.models import Story


def touch_story_activity(
    db: Session,
    *,
    story_id: int,
    changed_at: datetime,
) -> None:
    db.execute(
        update(Story)
        .where(Story.id == story_id)
        .values(updated_at=changed_at)
    )
