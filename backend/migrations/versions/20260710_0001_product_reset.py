"""Product Reset baseline schema.

Revision ID: 20260710_0001
Revises: none
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260710_0001"
down_revision = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


JSON_TYPE = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("username", sa.String(120), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("position", sa.String(120), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("must_change_password", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_display_name", "users", ["display_name"])
    op.create_index("ix_users_position", "users", ["position"])
    op.create_index("ix_users_is_active", "users", ["is_active"])

    op.create_table(
        "user_functions",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("function_code", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "function_code IN ('chief','chief_editor','author','proofreader','video_editor','designer','operator')",
            name="ck_user_functions_code",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "function_code"),
    )
    op.create_index(
        "ix_user_functions_function_code_user_id",
        "user_functions",
        ["function_code", "user_id"],
    )

    op.create_table(
        "rubrics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rubrics_name", "rubrics", ["name"], unique=True)
    op.create_index("ix_rubrics_is_active", "rubrics", ["is_active"])

    op.create_table(
        "stories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("rubric_id", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Integer(), nullable=False),
        sa.Column("priority", sa.String(16), server_default="standard", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("aired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("aired_by_user_id", sa.Integer(), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_by_user_id", sa.Integer(), nullable=True),
        sa.CheckConstraint("priority IN ('standard','high')", name="ck_stories_priority"),
        sa.CheckConstraint("archived_at IS NULL OR aired_at IS NOT NULL", name="ck_stories_archive_after_air"),
        sa.ForeignKeyConstraint(["rubric_id"], ["rubrics.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["aired_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["archived_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("title", "rubric_id", "author_user_id", "priority", "created_at", "aired_at", "archived_at"):
        op.create_index(f"ix_stories_{column}", "stories", [column])
    op.create_index(
        "ix_stories_queue",
        "stories",
        ["archived_at", "priority", sa.text("created_at DESC"), sa.text("id DESC")],
    )

    op.create_table(
        "story_assignments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by_user_id", sa.Integer(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('proofreader','video_editor','designer')", name="ck_story_assignments_kind"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["assigned_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("story_id", "kind", name="uq_story_assignment_kind"),
    )
    op.create_index("ix_story_assignments_story_id", "story_assignments", ["story_id"])
    op.create_index("ix_story_assignments_kind", "story_assignments", ["kind"])
    op.create_index("ix_story_assignments_user_id", "story_assignments", ["user_id"])

    op.create_table(
        "story_material_links",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("location", sa.Text(), nullable=False),
        sa.Column("added_by_user_id", sa.Integer(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["added_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_story_material_links_story_id", "story_material_links", ["story_id"])

    op.create_table(
        "story_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("event_code", sa.String(64), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("revision_no", sa.Integer(), nullable=True),
        sa.Column("payload", JSON_TYPE, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_story_events_story_id", "story_events", ["story_id"])
    op.create_index("ix_story_events_event_code", "story_events", ["event_code"])
    op.create_index("ix_story_events_created_at", "story_events", ["created_at"])
    op.create_index(
        "ix_story_events_story_created_desc",
        "story_events",
        ["story_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )

    op.create_table(
        "scenarios",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("revision_no", sa.Integer(), server_default="0", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scenarios_story_id", "scenarios", ["story_id"], unique=True)

    row_columns = (
        sa.Column("segment_uid", sa.String(64), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("block_type", sa.String(32), nullable=False),
        sa.Column("text", sa.Text(), server_default="", nullable=False),
        sa.Column("speaker_text", sa.Text(), server_default="", nullable=False),
        sa.Column("file_name", sa.String(255), server_default="", nullable=False),
        sa.Column("tc_in", sa.String(32), server_default="", nullable=False),
        sa.Column("tc_out", sa.String(32), server_default="", nullable=False),
        sa.Column("additional_comment", sa.Text(), server_default="", nullable=False),
        sa.Column("structured_data", JSON_TYPE, nullable=False),
        sa.Column("formatting", JSON_TYPE, nullable=False),
        sa.Column("rich_text", JSON_TYPE, nullable=False),
    )
    op.create_table(
        "scenario_rows",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("scenario_id", sa.Integer(), nullable=False),
        *row_columns,
        sa.CheckConstraint(
            "block_type IN ('podvodka','zk','snh','standup','geo')",
            name="ck_scenario_rows_block_type",
        ),
        sa.ForeignKeyConstraint(["scenario_id"], ["scenarios.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scenario_id", "segment_uid", name="uq_scenario_row_segment"),
        sa.UniqueConstraint("scenario_id", "order_index", name="uq_scenario_row_order"),
    )
    op.create_index("ix_scenario_rows_scenario_id", "scenario_rows", ["scenario_id"])

    op.create_table(
        "scenario_edit_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("scenario_id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("lease_token_hash", sa.String(64), nullable=False),
        sa.Column("base_revision_no", sa.Integer(), nullable=False),
        sa.Column("latest_revision_no", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("diff_summary", JSON_TYPE, nullable=True),
        sa.Column("diff_payload", JSON_TYPE, nullable=True),
        sa.ForeignKeyConstraint(["scenario_id"], ["scenarios.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lease_token_hash", name="uq_scenario_edit_sessions_lease_token_hash"),
    )
    op.create_index("ix_scenario_edit_sessions_scenario_id", "scenario_edit_sessions", ["scenario_id"])
    op.create_index("ix_scenario_edit_sessions_actor_user_id", "scenario_edit_sessions", ["actor_user_id"])
    op.create_index("ix_scenario_edit_sessions_expires_at", "scenario_edit_sessions", ["expires_at"])
    op.create_index("ix_scenario_edit_sessions_ended_at", "scenario_edit_sessions", ["ended_at"])
    op.create_index(
        "uq_scenario_active_edit_session",
        "scenario_edit_sessions",
        ["scenario_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
        sqlite_where=sa.text("ended_at IS NULL"),
    )
    op.create_index(
        "ix_scenario_edit_sessions_story_started_desc",
        "scenario_edit_sessions",
        ["scenario_id", sa.text("started_at DESC"), sa.text("id DESC")],
    )

    op.create_table(
        "scenario_revisions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("scenario_id", sa.Integer(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("client_save_id", sa.String(64), nullable=False),
        sa.Column("edit_session_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["scenario_id"], ["scenarios.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["edit_session_id"], ["scenario_edit_sessions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scenario_id", "revision_no", name="uq_scenario_revision_no"),
        sa.UniqueConstraint("scenario_id", "client_save_id", name="uq_scenario_client_save"),
    )
    op.create_index("ix_scenario_revisions_scenario_id", "scenario_revisions", ["scenario_id"])
    op.create_index("ix_scenario_revisions_edit_session_id", "scenario_revisions", ["edit_session_id"])
    op.create_index("ix_scenario_revisions_created_at", "scenario_revisions", ["created_at"])

    revision_row_columns = (
        sa.Column("segment_uid", sa.String(64), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("block_type", sa.String(32), nullable=False),
        sa.Column("text", sa.Text(), server_default="", nullable=False),
        sa.Column("speaker_text", sa.Text(), server_default="", nullable=False),
        sa.Column("file_name", sa.String(255), server_default="", nullable=False),
        sa.Column("tc_in", sa.String(32), server_default="", nullable=False),
        sa.Column("tc_out", sa.String(32), server_default="", nullable=False),
        sa.Column("additional_comment", sa.Text(), server_default="", nullable=False),
        sa.Column("structured_data", JSON_TYPE, nullable=False),
        sa.Column("formatting", JSON_TYPE, nullable=False),
        sa.Column("rich_text", JSON_TYPE, nullable=False),
    )
    op.create_table(
        "scenario_revision_rows",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("revision_id", sa.Integer(), nullable=False),
        *revision_row_columns,
        sa.CheckConstraint(
            "block_type IN ('podvodka','zk','snh','standup','geo')",
            name="ck_scenario_revision_rows_block_type",
        ),
        sa.ForeignKeyConstraint(["revision_id"], ["scenario_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("revision_id", "segment_uid", name="uq_revision_row_segment"),
        sa.UniqueConstraint("revision_id", "order_index", name="uq_revision_row_order"),
    )
    op.create_index("ix_scenario_revision_rows_revision_id", "scenario_revision_rows", ["revision_id"])

    op.create_table(
        "story_workflow_states",
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("review_requested_revision", sa.Integer(), nullable=True),
        sa.Column("review_requested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("review_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("editorial_revision", sa.Integer(), nullable=True),
        sa.Column("editorial_by_user_id", sa.Integer(), nullable=True),
        sa.Column("editorial_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proofread_revision", sa.Integer(), nullable=True),
        sa.Column("proofread_by_user_id", sa.Integer(), nullable=True),
        sa.Column("proofread_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("changed_after_proofread", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("reproofread_requested_revision", sa.Integer(), nullable=True),
        sa.Column("reproofread_requested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reproofread_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["review_requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["editorial_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["proofread_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reproofread_requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("story_id"),
    )

    op.create_table(
        "story_production_states",
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("voiceover_ready", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("voiceover_ready_by_user_id", sa.Integer(), nullable=True),
        sa.Column("voiceover_ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("video_started_revision", sa.Integer(), nullable=True),
        sa.Column("video_started_by_user_id", sa.Integer(), nullable=True),
        sa.Column("video_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("video_ready_by_user_id", sa.Integer(), nullable=True),
        sa.Column("video_ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("video_approved_for_titles_by_user_id", sa.Integer(), nullable=True),
        sa.Column("video_approved_for_titles_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("titles_started_revision", sa.Integer(), nullable=True),
        sa.Column("titles_started_by_user_id", sa.Integer(), nullable=True),
        sa.Column("titles_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("titles_ready_by_user_id", sa.Integer(), nullable=True),
        sa.Column("titles_ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("titles_accepted_by_user_id", sa.Integer(), nullable=True),
        sa.Column("titles_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["voiceover_ready_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["video_started_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["video_ready_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["video_approved_for_titles_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["titles_started_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["titles_ready_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["titles_accepted_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("story_id"),
    )

    op.create_table(
        "scenario_read_markers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("context", sa.String(32), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("context IN ('scenario','video','titles','captionpanels')", name="ck_scenario_read_markers_context"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("story_id", "user_id", "context", name="uq_scenario_read_marker"),
    )
    op.create_index("ix_scenario_read_markers_story_id", "scenario_read_markers", ["story_id"])
    op.create_index("ix_scenario_read_markers_user_id", "scenario_read_markers", ["user_id"])

    op.create_table(
        "correction_packages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("closed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("source IN ('internal','external')", name="ck_correction_packages_source"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["closed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_correction_packages_story_id", "correction_packages", ["story_id"])
    op.create_index("ix_correction_packages_source", "correction_packages", ["source"])
    op.create_index("ix_correction_packages_closed_at", "correction_packages", ["closed_at"])
    op.create_index(
        "ix_correction_packages_open_story",
        "correction_packages",
        ["story_id"],
        postgresql_where=sa.text("closed_at IS NULL"),
        sqlite_where=sa.text("closed_at IS NULL"),
    )

    op.create_table(
        "correction_parts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("package_id", sa.Integer(), nullable=False),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("assignee_user_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(16), server_default="pending", nullable=False),
        sa.Column("completed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("scope IN ('text','video','titles','voiceover')", name="ck_correction_parts_scope"),
        sa.CheckConstraint("state IN ('pending','done')", name="ck_correction_parts_state"),
        sa.ForeignKeyConstraint(["package_id"], ["correction_packages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignee_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["completed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_correction_parts_package_id", "correction_parts", ["package_id"])
    op.create_index("ix_correction_parts_scope", "correction_parts", ["scope"])
    op.create_index("ix_correction_parts_assignee_user_id", "correction_parts", ["assignee_user_id"])
    op.create_index("ix_correction_parts_state", "correction_parts", ["state"])
    op.create_index(
        "ix_correction_parts_assignee_state",
        "correction_parts",
        ["assignee_user_id", "state"],
    )

    op.create_table(
        "external_approval_cycles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("cycle_no", sa.Integer(), nullable=False),
        sa.Column("sent_by_user_id", sa.Integer(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("result", sa.String(32), server_default="pending", nullable=False),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("correction_package_id", sa.Integer(), nullable=True),
        sa.CheckConstraint("result IN ('pending','approved','changes_requested')", name="ck_external_approval_result"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sent_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["correction_package_id"], ["correction_packages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("story_id", "cycle_no", name="uq_external_cycle_no"),
    )
    op.create_index("ix_external_approval_cycles_story_id", "external_approval_cycles", ["story_id"])
    op.create_index("ix_external_approval_cycles_result", "external_approval_cycles", ["result"])
    op.create_index(
        "uq_external_approval_pending_story",
        "external_approval_cycles",
        ["story_id"],
        unique=True,
        postgresql_where=sa.text("result = 'pending'"),
        sqlite_where=sa.text("result = 'pending'"),
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("recipient_user_id", sa.Integer(), nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(64), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("edit_session_id", sa.Integer(), nullable=True),
        sa.Column("payload", JSON_TYPE, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["recipient_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["edit_session_id"], ["scenario_edit_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "recipient_user_id", "story_id", "kind", "edit_session_id",
            name="uq_notification_edit_session_dedupe",
        ),
    )
    op.create_index("ix_notifications_recipient_user_id", "notifications", ["recipient_user_id"])
    op.create_index("ix_notifications_story_id", "notifications", ["story_id"])
    op.create_index("ix_notifications_kind", "notifications", ["kind"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])
    op.create_index("ix_notifications_read_at", "notifications", ["read_at"])
    op.create_index(
        "ix_notifications_unread_recipient",
        "notifications",
        ["recipient_user_id", "created_at"],
        postgresql_where=sa.text("read_at IS NULL"),
        sqlite_where=sa.text("read_at IS NULL"),
    )


def downgrade() -> None:
    for table_name in (
        "notifications",
        "external_approval_cycles",
        "correction_parts",
        "correction_packages",
        "scenario_read_markers",
        "story_production_states",
        "story_workflow_states",
        "scenario_revision_rows",
        "scenario_revisions",
        "scenario_edit_sessions",
        "scenario_rows",
        "scenarios",
        "story_events",
        "story_material_links",
        "story_assignments",
        "stories",
        "rubrics",
        "user_functions",
        "users",
    ):
        op.drop_table(table_name)
