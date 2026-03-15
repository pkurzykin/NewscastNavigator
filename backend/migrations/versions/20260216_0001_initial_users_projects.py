"""initial users and projects tables

Revision ID: 20260216_0001
Revises:
Create Date: 2026-02-16 22:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "20260216_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="author"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("rubric", sa.String(length=120), nullable=True),
        sa.Column("planned_duration", sa.String(length=32), nullable=True),
        sa.Column("author_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_projects_status", "projects", ["status"], unique=False)
    op.create_index("ix_projects_created_at", "projects", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_projects_created_at", table_name="projects")
    op.drop_index("ix_projects_status", table_name="projects")
    op.drop_table("projects")

    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
