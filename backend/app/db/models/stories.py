from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


JSON_VALUE = JSON().with_variant(JSONB, "postgresql")


class Story(Base):
    __tablename__ = "stories"
    __table_args__ = (
        CheckConstraint("priority IN ('standard','high')", name="ck_stories_priority"),
        CheckConstraint("archived_at IS NULL OR aired_at IS NOT NULL", name="ck_stories_archive_after_air"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), index=True)
    rubric_id: Mapped[int] = mapped_column(ForeignKey("rubrics.id", ondelete="RESTRICT"), index=True)
    author_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    priority: Mapped[str] = mapped_column(String(16), default="standard", server_default="standard", index=True)
    duration_text: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    aired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    aired_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    archived_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class StoryAssignment(Base):
    __tablename__ = "story_assignments"
    __table_args__ = (
        UniqueConstraint("story_id", "kind", name="uq_story_assignment_kind"),
        CheckConstraint(
            "kind IN ('proofreader','video_editor','designer')",
            name="ck_story_assignments_kind",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    assigned_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoryMaterialLink(Base):
    __tablename__ = "story_material_links"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    location: Mapped[str] = mapped_column(Text)
    added_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StoryEvent(Base):
    __tablename__ = "story_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    event_code: Mapped[str] = mapped_column(String(64), index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    revision_no: Mapped[int | None]
    payload: Mapped[dict] = mapped_column(JSON_VALUE, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


Index(
    "ix_stories_queue",
    Story.archived_at,
    Story.priority,
    Story.created_at.desc(),
    Story.id.desc(),
)
Index(
    "ix_story_events_story_created_desc",
    StoryEvent.story_id,
    StoryEvent.created_at.desc(),
    StoryEvent.id.desc(),
)
