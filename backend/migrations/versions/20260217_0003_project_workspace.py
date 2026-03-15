"""add project workspace fields, comments and files

Revision ID: 20260217_0003
Revises: 20260216_0002
Create Date: 2026-02-17 00:50:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "20260217_0003"
down_revision = "20260216_0002"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return any(col.get("name") == column_name for col in inspector.get_columns(table_name))


def _index_exists(table_name: str, index_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    if _table_exists("projects") and not _column_exists("projects", "project_file_root"):
        op.add_column(
            "projects",
            sa.Column("project_file_root", sa.String(length=512), nullable=True),
        )
    if _table_exists("projects") and not _column_exists("projects", "project_note"):
        op.add_column(
            "projects",
            sa.Column("project_note", sa.Text(), nullable=False, server_default=""),
        )

    if not _table_exists("project_comments"):
        op.create_table(
            "project_comments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "project_id",
                sa.Integer(),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("text", sa.Text(), nullable=False, server_default=""),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
    if _table_exists("project_comments") and not _index_exists("project_comments", "ix_project_comments_project_id"):
        op.create_index(
            "ix_project_comments_project_id",
            "project_comments",
            ["project_id"],
            unique=False,
        )
    if _table_exists("project_comments") and not _index_exists("project_comments", "ix_project_comments_user_id"):
        op.create_index(
            "ix_project_comments_user_id",
            "project_comments",
            ["user_id"],
            unique=False,
        )
    if _table_exists("project_comments") and not _index_exists("project_comments", "ix_project_comments_created_at"):
        op.create_index(
            "ix_project_comments_created_at",
            "project_comments",
            ["created_at"],
            unique=False,
        )

    if not _table_exists("project_files"):
        op.create_table(
            "project_files",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "project_id",
                sa.Integer(),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("original_name", sa.Text(), nullable=False),
            sa.Column("storage_path", sa.Text(), nullable=False),
            sa.Column("mime_type", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("file_size", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column(
                "uploaded_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "uploaded_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
    if _table_exists("project_files") and not _index_exists("project_files", "ix_project_files_project_id"):
        op.create_index("ix_project_files_project_id", "project_files", ["project_id"], unique=False)
    if _table_exists("project_files") and not _index_exists("project_files", "ix_project_files_uploaded_by"):
        op.create_index("ix_project_files_uploaded_by", "project_files", ["uploaded_by"], unique=False)
    if _table_exists("project_files") and not _index_exists("project_files", "ix_project_files_uploaded_at"):
        op.create_index("ix_project_files_uploaded_at", "project_files", ["uploaded_at"], unique=False)


def downgrade() -> None:
    if _index_exists("project_files", "ix_project_files_uploaded_at"):
        op.drop_index("ix_project_files_uploaded_at", table_name="project_files")
    if _index_exists("project_files", "ix_project_files_uploaded_by"):
        op.drop_index("ix_project_files_uploaded_by", table_name="project_files")
    if _index_exists("project_files", "ix_project_files_project_id"):
        op.drop_index("ix_project_files_project_id", table_name="project_files")
    if _table_exists("project_files"):
        op.drop_table("project_files")

    if _index_exists("project_comments", "ix_project_comments_created_at"):
        op.drop_index("ix_project_comments_created_at", table_name="project_comments")
    if _index_exists("project_comments", "ix_project_comments_user_id"):
        op.drop_index("ix_project_comments_user_id", table_name="project_comments")
    if _index_exists("project_comments", "ix_project_comments_project_id"):
        op.drop_index("ix_project_comments_project_id", table_name="project_comments")
    if _table_exists("project_comments"):
        op.drop_table("project_comments")

    if _column_exists("projects", "project_note"):
        op.drop_column("projects", "project_note")
    if _column_exists("projects", "project_file_root"):
        op.drop_column("projects", "project_file_root")
