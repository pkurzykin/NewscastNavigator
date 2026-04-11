"""add project text snapshots

Revision ID: 20260410_0010
Revises: 20260410_0009
Create Date: 2026-04-10 20:10:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260410_0010"
down_revision = "20260410_0009"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _index_exists(table_name: str, index_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    if not _table_exists("project_text_snapshots"):
        op.create_table(
            "project_text_snapshots",
            sa.Column("id", sa.String(length=40), primary_key=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("snapshot_kind", sa.String(length=32), nullable=False),
            sa.Column("text_seq", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("project_title", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("project_rubric", sa.String(length=120), nullable=True),
            sa.Column("project_planned_duration", sa.String(length=32), nullable=True),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint(
                "project_id",
                "snapshot_kind",
                name="uq_project_text_snapshots_project_kind",
            ),
        )
    if not _index_exists("project_text_snapshots", "ix_project_text_snapshots_project_id"):
        op.create_index("ix_project_text_snapshots_project_id", "project_text_snapshots", ["project_id"])
    if not _index_exists("project_text_snapshots", "ix_project_text_snapshots_snapshot_kind"):
        op.create_index("ix_project_text_snapshots_snapshot_kind", "project_text_snapshots", ["snapshot_kind"])
    if not _index_exists("project_text_snapshots", "ix_project_text_snapshots_created_by"):
        op.create_index("ix_project_text_snapshots_created_by", "project_text_snapshots", ["created_by"])
    if not _index_exists("project_text_snapshots", "ix_project_text_snapshots_created_at"):
        op.create_index("ix_project_text_snapshots_created_at", "project_text_snapshots", ["created_at"])

    if not _table_exists("project_text_snapshot_elements"):
        op.create_table(
            "project_text_snapshot_elements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "snapshot_id",
                sa.String(length=40),
                sa.ForeignKey("project_text_snapshots.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("segment_uid", sa.String(length=40), nullable=False),
            sa.Column("order_index", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("block_type", sa.String(length=32), nullable=False, server_default="zk"),
            sa.Column("text", sa.Text(), nullable=False, server_default=""),
            sa.Column("content_json", sa.Text(), nullable=True),
            sa.Column("speaker_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("file_name", sa.Text(), nullable=False, server_default=""),
            sa.Column("tc_in", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("tc_out", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("additional_comment", sa.Text(), nullable=False, server_default=""),
            sa.Column("formatting_json", sa.Text(), nullable=True),
            sa.Column("rich_text_json", sa.Text(), nullable=True),
            sa.UniqueConstraint(
                "snapshot_id",
                "segment_uid",
                name="uq_project_text_snapshot_elements_snapshot_segment",
            ),
        )
    if not _index_exists("project_text_snapshot_elements", "ix_project_text_snapshot_elements_snapshot_id"):
        op.create_index(
            "ix_project_text_snapshot_elements_snapshot_id",
            "project_text_snapshot_elements",
            ["snapshot_id"],
        )
    if not _index_exists("project_text_snapshot_elements", "ix_project_text_snapshot_elements_segment_uid"):
        op.create_index(
            "ix_project_text_snapshot_elements_segment_uid",
            "project_text_snapshot_elements",
            ["segment_uid"],
        )
    if not _index_exists("project_text_snapshot_elements", "ix_project_text_snapshot_elements_order_index"):
        op.create_index(
            "ix_project_text_snapshot_elements_order_index",
            "project_text_snapshot_elements",
            ["order_index"],
        )


def downgrade() -> None:
    if _index_exists("project_text_snapshot_elements", "ix_project_text_snapshot_elements_order_index"):
        op.drop_index("ix_project_text_snapshot_elements_order_index", table_name="project_text_snapshot_elements")
    if _index_exists("project_text_snapshot_elements", "ix_project_text_snapshot_elements_segment_uid"):
        op.drop_index("ix_project_text_snapshot_elements_segment_uid", table_name="project_text_snapshot_elements")
    if _index_exists("project_text_snapshot_elements", "ix_project_text_snapshot_elements_snapshot_id"):
        op.drop_index("ix_project_text_snapshot_elements_snapshot_id", table_name="project_text_snapshot_elements")
    if _table_exists("project_text_snapshot_elements"):
        op.drop_table("project_text_snapshot_elements")

    if _index_exists("project_text_snapshots", "ix_project_text_snapshots_created_at"):
        op.drop_index("ix_project_text_snapshots_created_at", table_name="project_text_snapshots")
    if _index_exists("project_text_snapshots", "ix_project_text_snapshots_created_by"):
        op.drop_index("ix_project_text_snapshots_created_by", table_name="project_text_snapshots")
    if _index_exists("project_text_snapshots", "ix_project_text_snapshots_snapshot_kind"):
        op.drop_index("ix_project_text_snapshots_snapshot_kind", table_name="project_text_snapshots")
    if _index_exists("project_text_snapshots", "ix_project_text_snapshots_project_id"):
        op.drop_index("ix_project_text_snapshots_project_id", table_name="project_text_snapshots")
    if _table_exists("project_text_snapshots"):
        op.drop_table("project_text_snapshots")
