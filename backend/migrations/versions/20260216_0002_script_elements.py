"""add script_elements table

Revision ID: 20260216_0002
Revises: 20260216_0001
Create Date: 2026-02-16 23:40:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "20260216_0002"
down_revision = "20260216_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "script_elements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("block_type", sa.String(length=32), nullable=False, server_default="zk"),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("speaker_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("file_name", sa.Text(), nullable=False, server_default=""),
        sa.Column("tc_in", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("tc_out", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("additional_comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_script_elements_project_id", "script_elements", ["project_id"], unique=False)
    op.create_index("ix_script_elements_order_index", "script_elements", ["order_index"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_script_elements_order_index", table_name="script_elements")
    op.drop_index("ix_script_elements_project_id", table_name="script_elements")
    op.drop_table("script_elements")
