"""project source stage and story date

Revision ID: 20260521_0023
Revises: 20260424_0022
Create Date: 2026-05-21 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260521_0023"
down_revision = "20260424_0022"
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
    columns = _table_columns("projects")
    dialect_name = op.get_bind().dialect.name

    if dialect_name == "sqlite":
        with op.batch_alter_table("projects") as batch_op:
            if "story_date" not in columns:
                batch_op.add_column(sa.Column("story_date", sa.Date(), nullable=True))
    else:
        if "story_date" not in columns:
            op.add_column("projects", sa.Column("story_date", sa.Date(), nullable=True))

    if not _index_exists("projects", "ix_projects_story_date"):
        op.create_index("ix_projects_story_date", "projects", ["story_date"])


def downgrade() -> None:
    dialect_name = op.get_bind().dialect.name

    if _index_exists("projects", "ix_projects_story_date"):
        op.drop_index("ix_projects_story_date", table_name="projects")

    columns = _table_columns("projects")
    if dialect_name == "sqlite":
        with op.batch_alter_table("projects") as batch_op:
            if "story_date" in columns:
                batch_op.drop_column("story_date")
    else:
        if "story_date" in columns:
            op.drop_column("projects", "story_date")
