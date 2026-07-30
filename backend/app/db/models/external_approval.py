from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ExternalApprovalCycle(Base):
    __tablename__ = "external_approval_cycles"
    __table_args__ = (
        UniqueConstraint("story_id", "cycle_no", name="uq_external_cycle_no"),
        CheckConstraint(
            "result IN ('pending','approved','changes_requested')",
            name="ck_external_approval_result",
        ),
        Index(
            "uq_external_approval_pending_story",
            "story_id",
            unique=True,
            postgresql_where=text("result = 'pending'"),
            sqlite_where=text("result = 'pending'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    cycle_no: Mapped[int] = mapped_column(Integer)
    sent_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    result: Mapped[str] = mapped_column(String(32), default="pending", server_default="pending", index=True)
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    correction_package_id: Mapped[int | None] = mapped_column(
        ForeignKey("correction_packages.id", ondelete="SET NULL")
    )
