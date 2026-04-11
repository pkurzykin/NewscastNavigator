"""voiceover track foundation

Revision ID: 20260410_0013
Revises: 20260410_0012
Create Date: 2026-04-11 00:40:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260410_0013"
down_revision = "20260410_0012"
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
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    columns = _table_columns("projects")
    if "voiceover_status" not in columns:
        op.add_column("projects", sa.Column("voiceover_status", sa.String(length=32), nullable=True))
        op.execute("UPDATE projects SET voiceover_status = 'not_started' WHERE voiceover_status IS NULL")
        with op.batch_alter_table("projects") as batch_op:
            batch_op.alter_column("voiceover_status", existing_type=sa.String(length=32), nullable=False)
    if "voiceover_text_seq" not in columns:
        op.add_column("projects", sa.Column("voiceover_text_seq", sa.Integer(), nullable=True))
    if "voiceover_updated_at" not in columns:
        op.add_column("projects", sa.Column("voiceover_updated_at", sa.DateTime(timezone=True), nullable=True))
    if "voiceover_updated_by" not in columns:
        if dialect_name == "sqlite":
            op.add_column("projects", sa.Column("voiceover_updated_by", sa.Integer(), nullable=True))
        else:
            op.add_column(
                "projects",
                sa.Column(
                    "voiceover_updated_by",
                    sa.Integer(),
                    sa.ForeignKey("users.id", ondelete="SET NULL"),
                    nullable=True,
                ),
            )

    if not _index_exists("projects", "ix_projects_voiceover_status"):
        op.create_index("ix_projects_voiceover_status", "projects", ["voiceover_status"])
    if not _index_exists("projects", "ix_projects_voiceover_text_seq"):
        op.create_index("ix_projects_voiceover_text_seq", "projects", ["voiceover_text_seq"])
    if not _index_exists("projects", "ix_projects_voiceover_updated_at"):
        op.create_index("ix_projects_voiceover_updated_at", "projects", ["voiceover_updated_at"])
    if not _index_exists("projects", "ix_projects_voiceover_updated_by"):
        op.create_index("ix_projects_voiceover_updated_by", "projects", ["voiceover_updated_by"])


def downgrade() -> None:
    if _index_exists("projects", "ix_projects_voiceover_updated_by"):
        op.drop_index("ix_projects_voiceover_updated_by", table_name="projects")
    if _index_exists("projects", "ix_projects_voiceover_updated_at"):
        op.drop_index("ix_projects_voiceover_updated_at", table_name="projects")
    if _index_exists("projects", "ix_projects_voiceover_text_seq"):
        op.drop_index("ix_projects_voiceover_text_seq", table_name="projects")
    if _index_exists("projects", "ix_projects_voiceover_status"):
        op.drop_index("ix_projects_voiceover_status", table_name="projects")

    columns = _table_columns("projects")
    if "voiceover_updated_by" in columns:
        op.drop_column("projects", "voiceover_updated_by")
    if "voiceover_updated_at" in columns:
        op.drop_column("projects", "voiceover_updated_at")
    if "voiceover_text_seq" in columns:
        op.drop_column("projects", "voiceover_text_seq")
    if "voiceover_status" in columns:
        op.drop_column("projects", "voiceover_status")
