from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CorrectionPackage(Base):
    __tablename__ = "correction_packages"
    __table_args__ = (
        CheckConstraint("source IN ('internal','external')", name="ck_correction_packages_source"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(16), index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class CorrectionPart(Base):
    __tablename__ = "correction_parts"
    __table_args__ = (
        CheckConstraint(
            "scope IN ('text','video','titles','voiceover')",
            name="ck_correction_parts_scope",
        ),
        CheckConstraint("state IN ('pending','done')", name="ck_correction_parts_state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    package_id: Mapped[int] = mapped_column(
        ForeignKey("correction_packages.id", ondelete="CASCADE"), index=True
    )
    scope: Mapped[str] = mapped_column(String(16), index=True)
    description: Mapped[str] = mapped_column(Text)
    assignee_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    state: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending", index=True)
    completed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


Index(
    "ix_correction_parts_assignee_state",
    CorrectionPart.assignee_user_id,
    CorrectionPart.state,
)
Index(
    "ix_correction_packages_open_story",
    CorrectionPackage.story_id,
    postgresql_where=text("closed_at IS NULL"),
    sqlite_where=text("closed_at IS NULL"),
)
