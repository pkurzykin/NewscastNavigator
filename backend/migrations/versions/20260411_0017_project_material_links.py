"""project material links

Revision ID: 20260411_0017
Revises: 20260411_0016
Create Date: 2026-04-11 11:55:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260411_0017"
down_revision = "20260411_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_material_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("link_type", sa.String(length=32), nullable=False, server_default="other"),
        sa.Column("path", sa.String(length=1024), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("added_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_project_material_links_project_id",
        "project_material_links",
        ["project_id"],
    )
    op.create_index(
        "ix_project_material_links_link_type",
        "project_material_links",
        ["link_type"],
    )
    op.create_index(
        "ix_project_material_links_added_by",
        "project_material_links",
        ["added_by"],
    )
    op.create_index(
        "ix_project_material_links_created_at",
        "project_material_links",
        ["created_at"],
    )
    op.create_index(
        "ix_project_material_links_updated_at",
        "project_material_links",
        ["updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_project_material_links_updated_at", table_name="project_material_links")
    op.drop_index("ix_project_material_links_created_at", table_name="project_material_links")
    op.drop_index("ix_project_material_links_added_by", table_name="project_material_links")
    op.drop_index("ix_project_material_links_link_type", table_name="project_material_links")
    op.drop_index("ix_project_material_links_project_id", table_name="project_material_links")
    op.drop_table("project_material_links")
