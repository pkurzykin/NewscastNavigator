from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


JSON_VALUE = JSON().with_variant(JSONB, "postgresql")


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(
        ForeignKey("stories.id", ondelete="CASCADE"), unique=True, index=True
    )
    revision_no: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ScenarioRow(Base):
    __tablename__ = "scenario_rows"
    __table_args__ = (
        UniqueConstraint("scenario_id", "segment_uid", name="uq_scenario_row_segment"),
        UniqueConstraint("scenario_id", "order_index", name="uq_scenario_row_order"),
        CheckConstraint(
            "block_type IN ('podvodka','zk','zk_geo','life','snh')",
            name="ck_scenario_rows_block_type",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"), index=True)
    segment_uid: Mapped[str] = mapped_column(String(64))
    order_index: Mapped[int] = mapped_column(Integer)
    block_type: Mapped[str] = mapped_column(String(32))
    text: Mapped[str] = mapped_column(Text, default="", server_default="")
    speaker_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    file_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    tc_in: Mapped[str] = mapped_column(String(32), default="", server_default="")
    tc_out: Mapped[str] = mapped_column(String(32), default="", server_default="")
    additional_comment: Mapped[str] = mapped_column(Text, default="", server_default="")
    structured_data: Mapped[dict] = mapped_column(JSON_VALUE, default=dict)
    formatting: Mapped[dict] = mapped_column(JSON_VALUE, default=dict)
    rich_text: Mapped[dict] = mapped_column(JSON_VALUE, default=dict)


class ScenarioEditSession(Base):
    __tablename__ = "scenario_edit_sessions"
    __table_args__ = (
        Index(
            "uq_scenario_active_edit_session",
            "scenario_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
            sqlite_where=text("ended_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"), index=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    lease_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    base_revision_no: Mapped[int] = mapped_column(Integer)
    latest_revision_no: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    diff_summary: Mapped[dict | None] = mapped_column(JSON_VALUE)
    diff_payload: Mapped[dict | None] = mapped_column(JSON_VALUE)


class ScenarioRevision(Base):
    __tablename__ = "scenario_revisions"
    __table_args__ = (
        UniqueConstraint("scenario_id", "revision_no", name="uq_scenario_revision_no"),
        UniqueConstraint("scenario_id", "client_save_id", name="uq_scenario_client_save"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"), index=True)
    revision_no: Mapped[int] = mapped_column(Integer)
    client_save_id: Mapped[str] = mapped_column(String(64))
    edit_session_id: Mapped[int | None] = mapped_column(
        ForeignKey("scenario_edit_sessions.id", ondelete="SET NULL"), index=True
    )
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class ScenarioRevisionRow(Base):
    __tablename__ = "scenario_revision_rows"
    __table_args__ = (
        UniqueConstraint("revision_id", "segment_uid", name="uq_revision_row_segment"),
        UniqueConstraint("revision_id", "order_index", name="uq_revision_row_order"),
        CheckConstraint(
            "block_type IN ('podvodka','zk','zk_geo','life','snh')",
            name="ck_scenario_revision_rows_block_type",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    revision_id: Mapped[int] = mapped_column(
        ForeignKey("scenario_revisions.id", ondelete="CASCADE"), index=True
    )
    segment_uid: Mapped[str] = mapped_column(String(64))
    order_index: Mapped[int] = mapped_column(Integer)
    block_type: Mapped[str] = mapped_column(String(32))
    text: Mapped[str] = mapped_column(Text, default="", server_default="")
    speaker_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    file_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    tc_in: Mapped[str] = mapped_column(String(32), default="", server_default="")
    tc_out: Mapped[str] = mapped_column(String(32), default="", server_default="")
    additional_comment: Mapped[str] = mapped_column(Text, default="", server_default="")
    structured_data: Mapped[dict] = mapped_column(JSON_VALUE, default=dict)
    formatting: Mapped[dict] = mapped_column(JSON_VALUE, default=dict)
    rich_text: Mapped[dict] = mapped_column(JSON_VALUE, default=dict)


class ScenarioReadMarker(Base):
    __tablename__ = "scenario_read_markers"
    __table_args__ = (
        UniqueConstraint("story_id", "user_id", "context", name="uq_scenario_read_marker"),
        CheckConstraint(
            "context IN ('scenario','video','titles','captionpanels')",
            name="ck_scenario_read_markers_context",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    story_id: Mapped[int] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    context: Mapped[str] = mapped_column(String(32))
    revision_no: Mapped[int] = mapped_column(Integer)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index(
    "ix_scenario_edit_sessions_story_started_desc",
    ScenarioEditSession.scenario_id,
    ScenarioEditSession.started_at.desc(),
    ScenarioEditSession.id.desc(),
)
