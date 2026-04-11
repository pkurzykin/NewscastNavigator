"""project comment actions

Revision ID: 20260411_0018
Revises: 20260411_0017
Create Date: 2026-04-11 12:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260411_0018"
down_revision = "20260411_0017"
branch_labels = None
depends_on = None


def _table_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    try:
        return {item["name"] for item in inspector.get_columns(table_name)}
    except sa.exc.NoSuchTableError:
        return set()


def _index_exists(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    try:
        indexes = inspector.get_indexes(table_name)
    except sa.exc.NoSuchTableError:
        return False
    return any(item["name"] == index_name for item in indexes)


def upgrade() -> None:
    columns = _table_columns("project_comments")
    if "target_kind" not in columns:
        op.add_column("project_comments", sa.Column("target_kind", sa.String(length=32), nullable=True))
        op.execute("UPDATE project_comments SET target_kind = 'general' WHERE target_kind IS NULL")
        with op.batch_alter_table("project_comments") as batch_op:
            batch_op.alter_column("target_kind", existing_type=sa.String(length=32), nullable=False)
    if "requires_action" not in columns:
        op.add_column("project_comments", sa.Column("requires_action", sa.Boolean(), nullable=True))
        op.execute("UPDATE project_comments SET requires_action = 0 WHERE requires_action IS NULL")
        with op.batch_alter_table("project_comments") as batch_op:
            batch_op.alter_column("requires_action", existing_type=sa.Boolean(), nullable=False)
    if "is_resolved" not in columns:
        op.add_column("project_comments", sa.Column("is_resolved", sa.Boolean(), nullable=True))
        op.execute("UPDATE project_comments SET is_resolved = 0 WHERE is_resolved IS NULL")
        with op.batch_alter_table("project_comments") as batch_op:
            batch_op.alter_column("is_resolved", existing_type=sa.Boolean(), nullable=False)
    if "resolved_at" not in columns:
        op.add_column("project_comments", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))

    if not _index_exists("project_comments", "ix_project_comments_target_kind"):
        op.create_index("ix_project_comments_target_kind", "project_comments", ["target_kind"])
    if not _index_exists("project_comments", "ix_project_comments_requires_action"):
        op.create_index("ix_project_comments_requires_action", "project_comments", ["requires_action"])
    if not _index_exists("project_comments", "ix_project_comments_is_resolved"):
        op.create_index("ix_project_comments_is_resolved", "project_comments", ["is_resolved"])
    if not _index_exists("project_comments", "ix_project_comments_resolved_at"):
        op.create_index("ix_project_comments_resolved_at", "project_comments", ["resolved_at"])


def downgrade() -> None:
    if _index_exists("project_comments", "ix_project_comments_resolved_at"):
        op.drop_index("ix_project_comments_resolved_at", table_name="project_comments")
    if _index_exists("project_comments", "ix_project_comments_is_resolved"):
        op.drop_index("ix_project_comments_is_resolved", table_name="project_comments")
    if _index_exists("project_comments", "ix_project_comments_requires_action"):
        op.drop_index("ix_project_comments_requires_action", table_name="project_comments")
    if _index_exists("project_comments", "ix_project_comments_target_kind"):
        op.drop_index("ix_project_comments_target_kind", table_name="project_comments")

    columns = _table_columns("project_comments")
    if "resolved_at" in columns:
        op.drop_column("project_comments", "resolved_at")
    if "is_resolved" in columns:
        op.drop_column("project_comments", "is_resolved")
    if "requires_action" in columns:
        op.drop_column("project_comments", "requires_action")
    if "target_kind" in columns:
        op.drop_column("project_comments", "target_kind")
