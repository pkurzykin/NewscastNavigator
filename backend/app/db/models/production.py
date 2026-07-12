from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StoryProductionState(Base):
    __tablename__ = "story_production_states"

    story_id: Mapped[int] = mapped_column(
        ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True
    )
    voiceover_ready: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    voiceover_ready_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    voiceover_ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    video_started_revision: Mapped[int | None] = mapped_column(Integer)
    video_started_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    video_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    video_ready_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    video_ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    video_approved_for_titles_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    video_approved_for_titles_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    titles_started_revision: Mapped[int | None] = mapped_column(Integer)
    titles_started_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    titles_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    titles_ready_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    titles_ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    titles_accepted_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    titles_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
