"""Add the casefolded rubric-name uniqueness key.

Revision ID: 20260730_0003
Revises: 20260730_0002
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision = "20260730_0003"
down_revision = "20260730_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def upgrade() -> None:
    connection = op.get_bind()
    rubrics = connection.execute(
        sa.text("SELECT id, name FROM rubrics ORDER BY id")
    ).mappings().all()
    keys_by_id = {int(rubric["id"]): _name_key(str(rubric["name"])) for rubric in rubrics}
    ids_by_key: dict[str, int] = {}
    for rubric_id, key in keys_by_id.items():
        duplicate_id = ids_by_key.get(key)
        if duplicate_id is not None:
            raise RuntimeError(
                "Rubric names collide after casefold normalization: "
                f"{duplicate_id} and {rubric_id}"
            )
        ids_by_key[key] = rubric_id

    op.add_column(
        "rubrics",
        sa.Column(
            "name_key",
            sa.String(360),
            nullable=False,
            server_default="",
        ),
    )
    for rubric_id, key in keys_by_id.items():
        connection.execute(
            sa.text(
                "UPDATE rubrics SET name_key = :name_key WHERE id = :rubric_id"
            ),
            {"name_key": key, "rubric_id": rubric_id},
        )
    op.create_index(
        "uq_rubrics_name_key",
        "rubrics",
        ["name_key"],
        unique=True,
    )
    if connection.dialect.name == "postgresql":
        op.alter_column(
            "rubrics",
            "name_key",
            existing_type=sa.String(360),
            server_default=None,
        )


def downgrade() -> None:
    op.drop_index("uq_rubrics_name_key", table_name="rubrics")
    op.drop_column("rubrics", "name_key")
