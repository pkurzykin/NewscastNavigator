"""add stable segment uids

Revision ID: 20260325_0006
Revises: 20260319_0005
Create Date: 2026-03-25 13:20:00.000000
"""

from __future__ import annotations

from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision = "20260325_0006"
down_revision = "20260319_0005"
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
    return any(idx.get("name") == index_name for idx in inspector.get_indexes(table_name))


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def _generate_segment_uid() -> str:
    return f"seg_{uuid4().hex}"


def _upgrade_script_elements_sqlite() -> None:
    segment_uid_exists = _column_exists("script_elements", "segment_uid")

    with op.batch_alter_table("script_elements", recreate="always") as batch_op:
        if not segment_uid_exists:
            batch_op.add_column(sa.Column("segment_uid", sa.String(length=40), nullable=True))
        batch_op.create_index(
            "ix_script_elements_segment_uid",
            ["segment_uid"],
            unique=True,
        )


def _downgrade_script_elements_sqlite() -> None:
    segment_uid_exists = _column_exists("script_elements", "segment_uid")

    with op.batch_alter_table("script_elements", recreate="always") as batch_op:
        if _index_exists("script_elements", "ix_script_elements_segment_uid"):
            batch_op.drop_index("ix_script_elements_segment_uid")
        if segment_uid_exists:
            batch_op.drop_column("segment_uid")


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists("script_elements"):
        return

    if _is_sqlite():
        _upgrade_script_elements_sqlite()
    else:
        if not _column_exists("script_elements", "segment_uid"):
            op.add_column(
                "script_elements",
                sa.Column("segment_uid", sa.String(length=40), nullable=True),
            )
        if not _index_exists("script_elements", "ix_script_elements_segment_uid"):
            op.create_index(
                "ix_script_elements_segment_uid",
                "script_elements",
                ["segment_uid"],
                unique=True,
            )

    script_elements = sa.table(
        "script_elements",
        sa.column("id", sa.Integer()),
        sa.column("segment_uid", sa.String(length=40)),
    )
    rows = bind.execute(
        sa.select(script_elements.c.id, script_elements.c.segment_uid)
    ).all()
    for row in rows:
        current_value = str(row.segment_uid or "").strip()
        if current_value:
            continue
        bind.execute(
            sa.update(script_elements)
            .where(script_elements.c.id == row.id)
            .values(segment_uid=_generate_segment_uid())
        )

    if not _is_sqlite():
        op.alter_column("script_elements", "segment_uid", nullable=False)


def downgrade() -> None:
    if not _table_exists("script_elements"):
        return

    if _is_sqlite():
        _downgrade_script_elements_sqlite()
    else:
        if _index_exists("script_elements", "ix_script_elements_segment_uid"):
            op.drop_index("ix_script_elements_segment_uid", table_name="script_elements")
        if _column_exists("script_elements", "segment_uid"):
            op.drop_column("script_elements", "segment_uid")
