from __future__ import annotations

from typing import Any

from app.db.models import ScenarioRevisionRow, ScenarioRow
from app.schemas.scenario import ScenarioRowInput


ROW_FIELDS = (
    "segment_uid",
    "order_index",
    "block_type",
    "text",
    "speaker_text",
    "file_name",
    "tc_in",
    "tc_out",
    "additional_comment",
    "structured_data",
    "formatting",
    "rich_text",
)


def row_values(row: ScenarioRowInput, *, order_index: int) -> dict[str, Any]:
    return {
        "segment_uid": row.segment_uid,
        "order_index": order_index,
        "block_type": row.block_type,
        "text": row.text,
        "speaker_text": row.speaker_text,
        "file_name": row.file_name,
        "tc_in": row.tc_in,
        "tc_out": row.tc_out,
        "additional_comment": row.additional_comment,
        "structured_data": dict(row.structured_data),
        "formatting": dict(row.formatting),
        "rich_text": dict(row.rich_text),
    }


def revision_row_values(row: ScenarioRow) -> dict[str, Any]:
    return {field: getattr(row, field) for field in ROW_FIELDS}


def scenario_row_values(row: ScenarioRow) -> dict[str, Any]:
    return {field: getattr(row, field) for field in ROW_FIELDS}


def make_revision_row(*, revision_id: int, row: ScenarioRow) -> ScenarioRevisionRow:
    return ScenarioRevisionRow(revision_id=revision_id, **revision_row_values(row))
