from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Rubric, ScenarioRow
from app.domain.codes import SCENARIO_BLOCK_TYPES
from app.schemas.scenario_export import ScenarioDocxExportRequest
from app.services.story_service import lock_story_aggregate


@dataclass(frozen=True)
class DocxFileBundle:
    file_name: str
    tc_in: str
    tc_out: str


@dataclass(frozen=True)
class ScenarioDocxRow:
    block_type: str
    text: str
    speaker_text: str
    additional_comment: str
    structured_data: Mapping[str, Any]
    formatting: Mapping[str, Any]
    rich_text: Mapping[str, Any]
    file_bundles: tuple[DocxFileBundle, ...]


@dataclass(frozen=True)
class ScenarioDocxSnapshot:
    story_id: int
    title: str
    rubric_id: int
    rubric_name: str
    duration_text: str | None
    revision: int
    rows: tuple[ScenarioDocxRow, ...]


def _freeze_json(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze_json(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze_json(item) for item in value)
    return value


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _file_bundles(row: ScenarioRow) -> tuple[DocxFileBundle, ...]:
    structured_data = row.structured_data if isinstance(row.structured_data, dict) else {}
    raw_bundles = structured_data.get("file_bundles")
    candidates: list[Any]
    if isinstance(raw_bundles, list):
        candidates = raw_bundles
    else:
        candidates = [
            {
                "file_name": row.file_name,
                "tc_in": row.tc_in,
                "tc_out": row.tc_out,
            }
        ]

    bundles: list[DocxFileBundle] = []
    for candidate in candidates:
        if not isinstance(candidate, Mapping):
            continue
        file_name = _text(candidate.get("file_name"))
        tc_in = _text(candidate.get("tc_in"))
        tc_out = _text(candidate.get("tc_out"))
        if file_name or tc_in or tc_out:
            bundles.append(DocxFileBundle(file_name=file_name, tc_in=tc_in, tc_out=tc_out))
    return tuple(bundles)


def build_scenario_docx_snapshot(
    db: Session,
    *,
    story_id: int,
    expected: ScenarioDocxExportRequest,
) -> ScenarioDocxSnapshot:
    story, scenario, _workflow, _production = lock_story_aggregate(db, story_id=story_id)
    rubric = db.get(Rubric, story.rubric_id)
    rows = db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.scenario_id == scenario.id)
        .order_by(ScenarioRow.order_index.asc(), ScenarioRow.id.asc())
    ).scalars().all()

    actual = (scenario.revision_no, story.title, story.rubric_id, story.duration_text)
    requested = (
        expected.expected_revision,
        expected.expected_title,
        expected.expected_rubric_id,
        expected.expected_duration_text,
    )
    if actual != requested:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "EXPORT_SNAPSHOT_MISMATCH",
                "message": "Сюжет изменился. Обновите карточку и повторите экспорт.",
            },
        )

    if any(row.block_type not in SCENARIO_BLOCK_TYPES for row in rows):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "EXPORT_UNSUPPORTED_BLOCK",
                "message": "Тип блока сценария не поддерживается для экспорта.",
            },
        )

    return ScenarioDocxSnapshot(
        story_id=story.id,
        title=story.title,
        rubric_id=story.rubric_id,
        rubric_name=rubric.name if rubric is not None else "",
        duration_text=story.duration_text,
        revision=scenario.revision_no,
        rows=tuple(
            ScenarioDocxRow(
                block_type=row.block_type,
                text=row.text,
                speaker_text=row.speaker_text,
                additional_comment=row.additional_comment,
                structured_data=_freeze_json(row.structured_data or {}),
                formatting=_freeze_json(row.formatting or {}),
                rich_text=_freeze_json(row.rich_text or {}),
                file_bundles=_file_bundles(row),
            )
            for row in rows
        ),
    )
