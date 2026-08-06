"""Add free-form duration text to stories.

Revision ID: 20260806_0004
Revises: 20260730_0003
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision = "20260806_0004"
down_revision = "20260730_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("stories", sa.Column("duration_text", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("stories", "duration_text")
