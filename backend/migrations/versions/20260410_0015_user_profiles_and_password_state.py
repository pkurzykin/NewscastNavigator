"""user profiles and password state

Revision ID: 20260410_0015
Revises: 20260410_0014
Create Date: 2026-04-11 01:35:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260410_0015"
down_revision = "20260410_0014"
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
    columns = _table_columns("users")
    if "full_name" not in columns:
        op.add_column("users", sa.Column("full_name", sa.String(length=255), nullable=True))
    if "job_title" not in columns:
        op.add_column("users", sa.Column("job_title", sa.String(length=120), nullable=True))
    if "must_change_password" not in columns:
        op.add_column("users", sa.Column("must_change_password", sa.Boolean(), nullable=True))
        op.execute("UPDATE users SET must_change_password = 0 WHERE must_change_password IS NULL")
        with op.batch_alter_table("users") as batch_op:
            batch_op.alter_column(
                "must_change_password",
                existing_type=sa.Boolean(),
                nullable=False,
            )
    if "password_changed_at" not in columns:
        op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))

    if not _index_exists("users", "ix_users_full_name"):
        op.create_index("ix_users_full_name", "users", ["full_name"])
    if not _index_exists("users", "ix_users_job_title"):
        op.create_index("ix_users_job_title", "users", ["job_title"])
    if not _index_exists("users", "ix_users_password_changed_at"):
        op.create_index("ix_users_password_changed_at", "users", ["password_changed_at"])


def downgrade() -> None:
    if _index_exists("users", "ix_users_password_changed_at"):
        op.drop_index("ix_users_password_changed_at", table_name="users")
    if _index_exists("users", "ix_users_job_title"):
        op.drop_index("ix_users_job_title", table_name="users")
    if _index_exists("users", "ix_users_full_name"):
        op.drop_index("ix_users_full_name", table_name="users")

    columns = _table_columns("users")
    if "password_changed_at" in columns:
        op.drop_column("users", "password_changed_at")
    if "must_change_password" in columns:
        op.drop_column("users", "must_change_password")
    if "job_title" in columns:
        op.drop_column("users", "job_title")
    if "full_name" in columns:
        op.drop_column("users", "full_name")
