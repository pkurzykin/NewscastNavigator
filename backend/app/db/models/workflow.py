from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StoryWorkflowState(Base):
    __tablename__ = "story_workflow_states"

    story_id: Mapped[int] = mapped_column(
        ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True
    )
    review_requested_revision: Mapped[int | None] = mapped_column(Integer)
    review_requested_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    review_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    editorial_revision: Mapped[int | None] = mapped_column(Integer)
    editorial_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    editorial_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    proofread_revision: Mapped[int | None] = mapped_column(Integer)
    proofread_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    proofread_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    changed_after_proofread: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    reproofread_requested_revision: Mapped[int | None] = mapped_column(Integer)
    reproofread_requested_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reproofread_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
