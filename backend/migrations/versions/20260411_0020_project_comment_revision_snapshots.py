"""project comment revision snapshots

Revision ID: 20260411_0020
Revises: 20260411_0019
Create Date: 2026-04-11 16:55:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260411_0020"
down_revision = "20260411_0019"
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
    if "created_revision_id" not in columns:
        op.add_column("project_comments", sa.Column("created_revision_id", sa.String(length=40), nullable=True))
    if "created_revision_no" not in columns:
        op.add_column("project_comments", sa.Column("created_revision_no", sa.Integer(), nullable=True))
    if "resolved_revision_id" not in columns:
        op.add_column("project_comments", sa.Column("resolved_revision_id", sa.String(length=40), nullable=True))
    if "resolved_revision_no" not in columns:
        op.add_column("project_comments", sa.Column("resolved_revision_no", sa.Integer(), nullable=True))


def downgrade() -> None:
    columns = _table_columns("project_comments")
    if "resolved_revision_no" in columns:
        op.drop_column("project_comments", "resolved_revision_no")
    if "resolved_revision_id" in columns:
        op.drop_column("project_comments", "resolved_revision_id")
    if "created_revision_no" in columns:
        op.drop_column("project_comments", "created_revision_no")
    if "created_revision_id" in columns:
        op.drop_column("project_comments", "created_revision_id")
