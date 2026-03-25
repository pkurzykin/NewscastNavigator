"""add rich_text_json to script elements

Revision ID: 20260325_0007
Revises: 20260325_0006
Create Date: 2026-03-25 13:20:00.000000
"""

from __future__ import annotations

import json
from html import escape

from alembic import op
import sqlalchemy as sa


revision = "20260325_0007"
down_revision = "20260325_0006"
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


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def _parse_json_object(raw_value: str | None) -> dict:
    if not raw_value:
        return {}
    try:
        payload = json.loads(raw_value)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _normalize_text_lines(raw_value: object) -> list[str]:
    if isinstance(raw_value, list):
        source = raw_value
    else:
        source = str(raw_value or "").splitlines()
    return [str(item or "").strip() for item in source if str(item or "").strip()]


def _html_from_plain_text(value: str) -> str:
    normalized = str(value or "").replace("\u00a0", " ").replace("\r", "").rstrip("\n")
    if not normalized:
        return ""
    return escape(normalized).replace("\n", "<br>")


def _default_plain_targets(
    *,
    block_type: str,
    text: str,
    speaker_text: str,
    content_json: str | None,
) -> dict[str, str]:
    normalized_block = (block_type or "").strip().lower()
    targets: dict[str, str] = {
        "text": str(text or "").strip(),
    }

    if normalized_block == "snh":
        lines = _normalize_text_lines(speaker_text)
        targets["speaker_fio"] = lines[0] if len(lines) >= 1 else ""
        targets["speaker_position"] = lines[1] if len(lines) >= 2 else ""
        return targets

    if normalized_block == "zk_geo":
        payload = _parse_json_object(content_json)
        geo = str(payload.get("geo") or "").strip()
        text_lines = _normalize_text_lines(payload.get("text_lines"))
        targets["text"] = "\n".join(text_lines) if text_lines else str(text or "").strip()
        targets["geo"] = geo
        return targets

    return targets


def _build_initial_rich_text(
    *,
    block_type: str,
    text: str,
    speaker_text: str,
    content_json: str | None,
    formatting_json: str | None,
) -> str:
    default_targets = _default_plain_targets(
        block_type=block_type,
        text=text,
        speaker_text=speaker_text,
        content_json=content_json,
    )
    formatting = _parse_json_object(formatting_json)
    html_map = formatting.get("html_by_target") if isinstance(formatting, dict) else {}
    if not isinstance(html_map, dict):
        html_map = {}

    payload = {
        "schema_version": 1,
        "targets": {},
    }
    for target, plain_text in default_targets.items():
        stored_html = str(html_map.get(target) or "").strip()
        payload["targets"][target] = {
            "editor": "legacy_html",
            "text": plain_text,
            "html": stored_html or _html_from_plain_text(plain_text),
        }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _upgrade_script_elements_sqlite() -> None:
    rich_text_exists = _column_exists("script_elements", "rich_text_json")
    with op.batch_alter_table("script_elements", recreate="always") as batch_op:
        if not rich_text_exists:
            batch_op.add_column(sa.Column("rich_text_json", sa.Text(), nullable=True))


def _downgrade_script_elements_sqlite() -> None:
    rich_text_exists = _column_exists("script_elements", "rich_text_json")
    with op.batch_alter_table("script_elements", recreate="always") as batch_op:
        if rich_text_exists:
            batch_op.drop_column("rich_text_json")


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists("script_elements"):
        return

    if _is_sqlite():
        _upgrade_script_elements_sqlite()
    elif not _column_exists("script_elements", "rich_text_json"):
        op.add_column("script_elements", sa.Column("rich_text_json", sa.Text(), nullable=True))

    table = sa.table(
        "script_elements",
        sa.column("id", sa.Integer()),
        sa.column("block_type", sa.String()),
        sa.column("text", sa.Text()),
        sa.column("speaker_text", sa.Text()),
        sa.column("content_json", sa.Text()),
        sa.column("formatting_json", sa.Text()),
        sa.column("rich_text_json", sa.Text()),
    )
    rows = bind.execute(
        sa.select(
            table.c.id,
            table.c.block_type,
            table.c.text,
            table.c.speaker_text,
            table.c.content_json,
            table.c.formatting_json,
            table.c.rich_text_json,
        )
    ).all()
    for row in rows:
        if row.rich_text_json:
            continue
        bind.execute(
            sa.update(table)
            .where(table.c.id == row.id)
            .values(
                rich_text_json=_build_initial_rich_text(
                    block_type=str(row.block_type or ""),
                    text=str(row.text or ""),
                    speaker_text=str(row.speaker_text or ""),
                    content_json=row.content_json,
                    formatting_json=row.formatting_json,
                )
            )
        )


def downgrade() -> None:
    if not _table_exists("script_elements"):
        return

    if _is_sqlite():
        _downgrade_script_elements_sqlite()
    elif _column_exists("script_elements", "rich_text_json"):
        op.drop_column("script_elements", "rich_text_json")
