"""project comment text snapshots

Revision ID: 20260411_0019
Revises: 20260411_0018
Create Date: 2026-04-11 16:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260411_0019"
down_revision = "20260411_0018"
branch_labels = None
depends_on = None


def _table_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    try:
        return {item["name"] for item in inspector.get_columns(table_name)}
    except sa.exc.NoSuchTableError:
        return set()


def upgrade() -> None:
    columns = _table_columns("project_comments")
    if "created_text_snapshot_kind" not in columns:
        op.add_column(
            "project_comments",
            sa.Column("created_text_snapshot_kind", sa.String(length=32), nullable=True),
        )
    if "created_text_seq" not in columns:
        op.add_column("project_comments", sa.Column("created_text_seq", sa.Integer(), nullable=True))
    if "resolved_text_snapshot_kind" not in columns:
        op.add_column(
            "project_comments",
            sa.Column("resolved_text_snapshot_kind", sa.String(length=32), nullable=True),
        )
    if "resolved_text_seq" not in columns:
        op.add_column("project_comments", sa.Column("resolved_text_seq", sa.Integer(), nullable=True))


def downgrade() -> None:
    columns = _table_columns("project_comments")
    if "resolved_text_seq" in columns:
        op.drop_column("project_comments", "resolved_text_seq")
    if "resolved_text_snapshot_kind" in columns:
        op.drop_column("project_comments", "resolved_text_snapshot_kind")
    if "created_text_seq" in columns:
        op.drop_column("project_comments", "created_text_seq")
    if "created_text_snapshot_kind" in columns:
        op.drop_column("project_comments", "created_text_snapshot_kind")
