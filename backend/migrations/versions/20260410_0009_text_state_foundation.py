"""add project text state foundation

Revision ID: 20260410_0009
Revises: 20260326_0008
Create Date: 2026-04-10 17:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260410_0009"
down_revision = "20260326_0008"
branch_labels = None
depends_on = None


TEXT_STATE_COLUMNS = (
    ("text_seq", sa.Column("text_seq", sa.Integer(), nullable=False, server_default="0")),
    ("current_text_seq", sa.Column("current_text_seq", sa.Integer(), nullable=True)),
    ("current_text_set_at", sa.Column("current_text_set_at", sa.DateTime(timezone=True), nullable=True)),
    ("current_text_set_by", sa.Column("current_text_set_by", sa.Integer(), nullable=True)),
    ("checked_text_seq", sa.Column("checked_text_seq", sa.Integer(), nullable=True)),
    ("checked_at", sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True)),
    ("checked_by", sa.Column("checked_by", sa.Integer(), nullable=True)),
    ("proofread_text_seq", sa.Column("proofread_text_seq", sa.Integer(), nullable=True)),
    ("proofread_at", sa.Column("proofread_at", sa.DateTime(timezone=True), nullable=True)),
    ("proofread_by", sa.Column("proofread_by", sa.Integer(), nullable=True)),
)


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


def _foreign_key_exists(table_name: str, fk_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return any(fk.get("name") == fk_name for fk in inspector.get_foreign_keys(table_name))


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def _upgrade_projects_sqlite() -> None:
    with op.batch_alter_table("projects", recreate="always") as batch_op:
        for column_name, column in TEXT_STATE_COLUMNS:
            if not _column_exists("projects", column_name):
                batch_op.add_column(column)

        if not _foreign_key_exists("projects", "fk_projects_current_text_set_by_users"):
            batch_op.create_foreign_key(
                "fk_projects_current_text_set_by_users",
                "users",
                ["current_text_set_by"],
                ["id"],
                ondelete="SET NULL",
            )
        if not _foreign_key_exists("projects", "fk_projects_checked_by_users"):
            batch_op.create_foreign_key(
                "fk_projects_checked_by_users",
                "users",
                ["checked_by"],
                ["id"],
                ondelete="SET NULL",
            )
        if not _foreign_key_exists("projects", "fk_projects_proofread_by_users"):
            batch_op.create_foreign_key(
                "fk_projects_proofread_by_users",
                "users",
                ["proofread_by"],
                ["id"],
                ondelete="SET NULL",
            )


def _downgrade_projects_sqlite() -> None:
    with op.batch_alter_table("projects", recreate="always") as batch_op:
        if _foreign_key_exists("projects", "fk_projects_proofread_by_users"):
            batch_op.drop_constraint("fk_projects_proofread_by_users", type_="foreignkey")
        if _foreign_key_exists("projects", "fk_projects_checked_by_users"):
            batch_op.drop_constraint("fk_projects_checked_by_users", type_="foreignkey")
        if _foreign_key_exists("projects", "fk_projects_current_text_set_by_users"):
            batch_op.drop_constraint("fk_projects_current_text_set_by_users", type_="foreignkey")

        for column_name, _column in reversed(TEXT_STATE_COLUMNS):
            if _column_exists("projects", column_name):
                batch_op.drop_column(column_name)


def upgrade() -> None:
    if _table_exists("projects"):
        if _is_sqlite():
            _upgrade_projects_sqlite()
        else:
            for column_name, column in TEXT_STATE_COLUMNS:
                if not _column_exists("projects", column_name):
                    op.add_column("projects", column)
            if not _foreign_key_exists("projects", "fk_projects_current_text_set_by_users"):
                op.create_foreign_key(
                    "fk_projects_current_text_set_by_users",
                    "projects",
                    "users",
                    ["current_text_set_by"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if not _foreign_key_exists("projects", "fk_projects_checked_by_users"):
                op.create_foreign_key(
                    "fk_projects_checked_by_users",
                    "projects",
                    "users",
                    ["checked_by"],
                    ["id"],
                    ondelete="SET NULL",
                )
            if not _foreign_key_exists("projects", "fk_projects_proofread_by_users"):
                op.create_foreign_key(
                    "fk_projects_proofread_by_users",
                    "projects",
                    "users",
                    ["proofread_by"],
                    ["id"],
                    ondelete="SET NULL",
                )

    for index_name, column_name in (
        ("ix_projects_current_text_seq", "current_text_seq"),
        ("ix_projects_current_text_set_at", "current_text_set_at"),
        ("ix_projects_current_text_set_by", "current_text_set_by"),
        ("ix_projects_checked_text_seq", "checked_text_seq"),
        ("ix_projects_checked_at", "checked_at"),
        ("ix_projects_checked_by", "checked_by"),
        ("ix_projects_proofread_text_seq", "proofread_text_seq"),
        ("ix_projects_proofread_at", "proofread_at"),
        ("ix_projects_proofread_by", "proofread_by"),
    ):
        if _table_exists("projects") and not _index_exists("projects", index_name):
            op.create_index(index_name, "projects", [column_name], unique=False)

    if _table_exists("projects"):
        op.execute(
            """
            UPDATE projects
            SET text_seq = CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM script_elements
                    WHERE script_elements.project_id = projects.id
                ) THEN 1
                ELSE 0
            END
            """
        )
        op.execute(
            """
            UPDATE projects
            SET current_text_seq = CASE
                WHEN text_seq > 0 THEN COALESCE(current_text_seq, text_seq)
                ELSE NULL
            END
            """
        )
        op.execute(
            """
            UPDATE projects
            SET current_text_set_at = CASE
                WHEN current_text_seq IS NOT NULL THEN COALESCE(current_text_set_at, status_changed_at, created_at)
                ELSE NULL
            END
            """
        )
        op.execute(
            """
            UPDATE projects
            SET current_text_set_by = CASE
                WHEN current_text_seq IS NOT NULL THEN COALESCE(current_text_set_by, status_changed_by, author_user_id)
                ELSE NULL
            END
            """
        )


def downgrade() -> None:
    for index_name in (
        "ix_projects_proofread_by",
        "ix_projects_proofread_at",
        "ix_projects_proofread_text_seq",
        "ix_projects_checked_by",
        "ix_projects_checked_at",
        "ix_projects_checked_text_seq",
        "ix_projects_current_text_set_by",
        "ix_projects_current_text_set_at",
        "ix_projects_current_text_seq",
    ):
        if _index_exists("projects", index_name):
            op.drop_index(index_name, table_name="projects")

    if _table_exists("projects"):
        if _is_sqlite():
            _downgrade_projects_sqlite()
        else:
            if _foreign_key_exists("projects", "fk_projects_proofread_by_users"):
                op.drop_constraint("fk_projects_proofread_by_users", "projects", type_="foreignkey")
            if _foreign_key_exists("projects", "fk_projects_checked_by_users"):
                op.drop_constraint("fk_projects_checked_by_users", "projects", type_="foreignkey")
            if _foreign_key_exists("projects", "fk_projects_current_text_set_by_users"):
                op.drop_constraint("fk_projects_current_text_set_by_users", "projects", type_="foreignkey")
            for column_name, _column in reversed(TEXT_STATE_COLUMNS):
                if _column_exists("projects", column_name):
                    op.drop_column("projects", column_name)
