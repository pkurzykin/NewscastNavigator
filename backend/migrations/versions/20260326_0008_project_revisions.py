"""add project revisions tables

Revision ID: 20260326_0008
Revises: 20260325_0007
Create Date: 2026-03-26 00:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260326_0008"
down_revision = "20260325_0007"
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
    if not _table_exists("project_revisions"):
        op.create_table(
            "project_revisions",
            sa.Column("id", sa.String(length=40), primary_key=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column(
                "parent_revision_id",
                sa.String(length=40),
                sa.ForeignKey("project_revisions.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("revision_no", sa.Integer(), nullable=False),
            sa.Column("branch_key", sa.String(length=64), nullable=False, server_default="main"),
            sa.Column("revision_kind", sa.String(length=32), nullable=False, server_default="manual"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
            sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("comment", sa.Text(), nullable=False, server_default=""),
            sa.Column("project_title", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("project_rubric", sa.String(length=120), nullable=True),
            sa.Column("project_planned_duration", sa.String(length=32), nullable=True),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.UniqueConstraint(
                "project_id",
                "revision_no",
                name="uq_project_revisions_project_revision_no",
            ),
        )

    if not _index_exists("project_revisions", "ix_project_revisions_project_id"):
        op.create_index("ix_project_revisions_project_id", "project_revisions", ["project_id"])
    if not _index_exists("project_revisions", "ix_project_revisions_parent_revision_id"):
        op.create_index(
            "ix_project_revisions_parent_revision_id",
            "project_revisions",
            ["parent_revision_id"],
        )
    if not _index_exists("project_revisions", "ix_project_revisions_revision_no"):
        op.create_index("ix_project_revisions_revision_no", "project_revisions", ["revision_no"])
    if not _index_exists("project_revisions", "ix_project_revisions_status"):
        op.create_index("ix_project_revisions_status", "project_revisions", ["status"])
    if not _index_exists("project_revisions", "ix_project_revisions_created_by"):
        op.create_index("ix_project_revisions_created_by", "project_revisions", ["created_by"])
    if not _index_exists("project_revisions", "ix_project_revisions_created_at"):
        op.create_index("ix_project_revisions_created_at", "project_revisions", ["created_at"])
    if not _index_exists("project_revisions", "ix_project_revisions_is_current"):
        op.create_index("ix_project_revisions_is_current", "project_revisions", ["is_current"])

    if not _table_exists("project_revision_elements"):
        op.create_table(
            "project_revision_elements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "revision_id",
                sa.String(length=40),
                sa.ForeignKey("project_revisions.id", ondelete="CASCADE"),
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
                "revision_id",
                "segment_uid",
                name="uq_project_revision_elements_revision_segment",
            ),
        )

    if not _index_exists("project_revision_elements", "ix_project_revision_elements_revision_id"):
        op.create_index(
            "ix_project_revision_elements_revision_id",
            "project_revision_elements",
            ["revision_id"],
        )
    if not _index_exists("project_revision_elements", "ix_project_revision_elements_segment_uid"):
        op.create_index(
            "ix_project_revision_elements_segment_uid",
            "project_revision_elements",
            ["segment_uid"],
        )
    if not _index_exists("project_revision_elements", "ix_project_revision_elements_order_index"):
        op.create_index(
            "ix_project_revision_elements_order_index",
            "project_revision_elements",
            ["order_index"],
        )


def downgrade() -> None:
    if _index_exists("project_revision_elements", "ix_project_revision_elements_order_index"):
        op.drop_index("ix_project_revision_elements_order_index", table_name="project_revision_elements")
    if _index_exists("project_revision_elements", "ix_project_revision_elements_segment_uid"):
        op.drop_index("ix_project_revision_elements_segment_uid", table_name="project_revision_elements")
    if _index_exists("project_revision_elements", "ix_project_revision_elements_revision_id"):
        op.drop_index("ix_project_revision_elements_revision_id", table_name="project_revision_elements")
    if _table_exists("project_revision_elements"):
        op.drop_table("project_revision_elements")

    if _index_exists("project_revisions", "ix_project_revisions_is_current"):
        op.drop_index("ix_project_revisions_is_current", table_name="project_revisions")
    if _index_exists("project_revisions", "ix_project_revisions_created_at"):
        op.drop_index("ix_project_revisions_created_at", table_name="project_revisions")
    if _index_exists("project_revisions", "ix_project_revisions_created_by"):
        op.drop_index("ix_project_revisions_created_by", table_name="project_revisions")
    if _index_exists("project_revisions", "ix_project_revisions_status"):
        op.drop_index("ix_project_revisions_status", table_name="project_revisions")
    if _index_exists("project_revisions", "ix_project_revisions_revision_no"):
        op.drop_index("ix_project_revisions_revision_no", table_name="project_revisions")
    if _index_exists("project_revisions", "ix_project_revisions_parent_revision_id"):
        op.drop_index("ix_project_revisions_parent_revision_id", table_name="project_revisions")
    if _index_exists("project_revisions", "ix_project_revisions_project_id"):
        op.drop_index("ix_project_revisions_project_id", table_name="project_revisions")
    if _table_exists("project_revisions"):
        op.drop_table("project_revisions")
