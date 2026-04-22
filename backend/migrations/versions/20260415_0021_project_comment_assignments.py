"""project comment assignments and taken-in-work state

Revision ID: 20260415_0021
Revises: 20260411_0020
Create Date: 2026-04-15 15:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260415_0021"
down_revision = "20260411_0020"
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
    dialect_name = op.get_bind().dialect.name

    if dialect_name == "sqlite":
        with op.batch_alter_table("project_comments") as batch_op:
            if "assignee_user_id" not in columns:
                batch_op.add_column(sa.Column("assignee_user_id", sa.Integer(), nullable=True))
            if "taken_in_work_at" not in columns:
                batch_op.add_column(sa.Column("taken_in_work_at", sa.DateTime(timezone=True), nullable=True))
            if "taken_in_work_by" not in columns:
                batch_op.add_column(sa.Column("taken_in_work_by", sa.Integer(), nullable=True))
    else:
        if "assignee_user_id" not in columns:
            op.add_column(
                "project_comments",
                sa.Column(
                    "assignee_user_id",
                    sa.Integer(),
                    sa.ForeignKey("users.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )
        if "taken_in_work_at" not in columns:
            op.add_column(
                "project_comments",
                sa.Column("taken_in_work_at", sa.DateTime(timezone=True), nullable=True),
            )
        if "taken_in_work_by" not in columns:
            op.add_column(
                "project_comments",
                sa.Column(
                    "taken_in_work_by",
                    sa.Integer(),
                    sa.ForeignKey("users.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )

    if not _index_exists("project_comments", op.f("ix_project_comments_assignee_user_id")):
        op.create_index(
            op.f("ix_project_comments_assignee_user_id"),
            "project_comments",
            ["assignee_user_id"],
            unique=False,
        )
    if not _index_exists("project_comments", op.f("ix_project_comments_taken_in_work_at")):
        op.create_index(
            op.f("ix_project_comments_taken_in_work_at"),
            "project_comments",
            ["taken_in_work_at"],
            unique=False,
        )
    if not _index_exists("project_comments", op.f("ix_project_comments_taken_in_work_by")):
        op.create_index(
            op.f("ix_project_comments_taken_in_work_by"),
            "project_comments",
            ["taken_in_work_by"],
            unique=False,
        )


def downgrade() -> None:
    columns = _table_columns("project_comments")
    dialect_name = op.get_bind().dialect.name

    if _index_exists("project_comments", op.f("ix_project_comments_taken_in_work_by")):
        op.drop_index(op.f("ix_project_comments_taken_in_work_by"), table_name="project_comments")
    if _index_exists("project_comments", op.f("ix_project_comments_taken_in_work_at")):
        op.drop_index(op.f("ix_project_comments_taken_in_work_at"), table_name="project_comments")
    if _index_exists("project_comments", op.f("ix_project_comments_assignee_user_id")):
        op.drop_index(op.f("ix_project_comments_assignee_user_id"), table_name="project_comments")

    if dialect_name == "sqlite":
        with op.batch_alter_table("project_comments") as batch_op:
            if "taken_in_work_by" in columns:
                batch_op.drop_column("taken_in_work_by")
            if "taken_in_work_at" in columns:
                batch_op.drop_column("taken_in_work_at")
            if "assignee_user_id" in columns:
                batch_op.drop_column("assignee_user_id")
    else:
        if "taken_in_work_by" in columns:
            op.drop_column("project_comments", "taken_in_work_by")
        if "taken_in_work_at" in columns:
            op.drop_column("project_comments", "taken_in_work_at")
        if "assignee_user_id" in columns:
            op.drop_column("project_comments", "assignee_user_id")
