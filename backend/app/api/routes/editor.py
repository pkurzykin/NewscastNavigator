from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Scenario, ScenarioRow, Story, User
from app.db.session import get_db
from app.schemas.editor import (
    SaveScenarioRowsRequest,
    SaveScenarioRowsResponse,
    ScenarioEditorRow,
    StoryEditorPayload,
)
from app.schemas.stories import StoryListItem
from app.services.segment_ids import generate_segment_uid
from app.services.story_queries import get_story_read_model
from app.services.structured_fields import (
    normalize_file_bundle_items,
    normalize_row_formatting,
    normalize_rich_text_payload,
    normalize_text_lines,
)


router = APIRouter(prefix="/api/v1/stories", tags=["editor"])

BLOCK_TYPE_CODES = {"podvodka", "zk", "zk_geo", "life", "snh"}
BLOCK_LABEL_TO_CODE = {
    "подводка": "podvodka",
    "зк": "zk",
    "лайф": "life",
    "снх": "snh",
    "зк+гео": "zk_geo",
}
PLACEHOLDER_ROW_TEXTS = {
    "подводка",
    "подводка:",
    "зк",
    "зк:",
    "лайф",
    "лайф:",
    "снх",
    "снх:",
    "зк+гео",
    "зк+гео:",
}


def _parse_timecode_to_seconds(raw_value: str) -> int | None:
    value = (raw_value or "").strip()
    if not value or not re.match(r"^\d{2}:\d{2}(:\d{2})?$", value):
        return None
    parts = [int(item) for item in value.split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        return minutes * 60 + seconds if seconds < 60 else None
    hours, minutes, seconds = parts
    return hours * 3600 + minutes * 60 + seconds if minutes < 60 and seconds < 60 else None


def _normalize_block_type(raw_block_type: str) -> str:
    value = (raw_block_type or "").strip().lower()
    if value in BLOCK_TYPE_CODES:
        return value
    return BLOCK_LABEL_TO_CODE.get(value, "zk")


def _has_meaningful_row_text(raw_value: str) -> bool:
    text = (raw_value or "").strip().lower()
    return bool(text and text not in PLACEHOLDER_ROW_TEXTS)


def _primary_file_bundle(
    raw_value: Any,
    *,
    file_name: str,
    tc_in: str,
    tc_out: str,
) -> tuple[list[dict[str, str]], dict[str, str]]:
    bundles = normalize_file_bundle_items(raw_value)
    if not bundles and (file_name or tc_in or tc_out):
        bundles = [{"file_name": file_name, "tc_in": tc_in, "tc_out": tc_out}]
    primary = next(
        (item for item in bundles if item["file_name"] or item["tc_in"] or item["tc_out"]),
        bundles[0] if bundles else {"file_name": "", "tc_in": "", "tc_out": ""},
    )
    return bundles, primary


def _row_to_schema(row: ScenarioRow) -> ScenarioEditorRow:
    structured_data = dict(row.structured_data or {})
    return ScenarioEditorRow(
        id=row.id,
        segment_uid=row.segment_uid,
        order_index=row.order_index,
        block_type=row.block_type,
        text=row.text,
        speaker_text=row.speaker_text,
        file_name=row.file_name,
        tc_in=row.tc_in,
        tc_out=row.tc_out,
        additional_comment=row.additional_comment,
        structured_data=structured_data,
        formatting=normalize_row_formatting(row.formatting or {}, block_type=row.block_type),
        rich_text=normalize_rich_text_payload(
            row.rich_text or {},
            block_type=row.block_type,
            text=row.text,
            speaker_text=row.speaker_text,
            structured_data=structured_data,
            formatting=row.formatting or {},
        ),
    )


def _normalize_rows(rows: list[ScenarioEditorRow]) -> tuple[list[dict[str, Any]], list[str]]:
    normalized_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    for order_index, row in enumerate(rows, start=1):
        block_type = _normalize_block_type(row.block_type)
        text = (row.text or "").strip()
        speaker_text = (row.speaker_text or "").strip()
        structured_data = dict(row.structured_data or {})
        bundles, primary = _primary_file_bundle(
            structured_data.get("file_bundles"),
            file_name=(row.file_name or "").strip(),
            tc_in=(row.tc_in or "").strip(),
            tc_out=(row.tc_out or "").strip(),
        )
        if bundles:
            structured_data["file_bundles"] = bundles
        else:
            structured_data.pop("file_bundles", None)
        if block_type == "zk_geo":
            text_lines = normalize_text_lines(structured_data.get("text_lines")) or normalize_text_lines(text)
            structured_data["geo"] = str(structured_data.get("geo") or "").strip()
            structured_data["text_lines"] = text_lines
            text = "\n".join(text_lines)
        if block_type == "snh":
            lines = normalize_text_lines(speaker_text)
            if (lines or _has_meaningful_row_text(text)) and len(lines) != 2:
                errors.append(
                    f"Строка {order_index}: для СНХ нужно заполнить ФИО и должность отдельными строками."
                )
            speaker_text = "\n".join(lines) if len(lines) == 2 else ""
        for bundle_index, bundle in enumerate(
            bundles or [primary], start=1
        ):
            tc_in_seconds = _parse_timecode_to_seconds(bundle["tc_in"]) if bundle["tc_in"] else None
            tc_out_seconds = _parse_timecode_to_seconds(bundle["tc_out"]) if bundle["tc_out"] else None
            prefix = f"Строка {order_index}, файл {bundle_index}:" if len(bundles) > 1 else f"Строка {order_index}:"
            if bundle["tc_in"] and tc_in_seconds is None:
                errors.append(f"{prefix} неверный формат TC IN (используйте MM:SS или HH:MM:SS).")
            if bundle["tc_out"] and tc_out_seconds is None:
                errors.append(f"{prefix} неверный формат TC OUT (используйте MM:SS или HH:MM:SS).")
            if tc_in_seconds is not None and tc_out_seconds is not None and tc_out_seconds < tc_in_seconds:
                errors.append(f"{prefix} TC OUT не может быть меньше TC IN.")
        formatting = normalize_row_formatting(row.formatting or {}, block_type=block_type)
        normalized_rows.append(
            {
                "id": row.id,
                "segment_uid": (row.segment_uid or "").strip() or None,
                "order_index": order_index,
                "block_type": block_type,
                "text": text,
                "speaker_text": speaker_text,
                "file_name": primary["file_name"],
                "tc_in": primary["tc_in"],
                "tc_out": primary["tc_out"],
                "additional_comment": (row.additional_comment or "").strip(),
                "structured_data": structured_data,
                "formatting": formatting,
                "rich_text": normalize_rich_text_payload(
                    row.rich_text or {},
                    block_type=block_type,
                    text=text,
                    speaker_text=speaker_text,
                    structured_data=structured_data,
                    formatting=formatting,
                ),
            }
        )
    return normalized_rows, errors


def _get_story_and_scenario(db: Session, story_id: int) -> tuple[Story, Scenario]:
    story = db.get(Story, story_id)
    if story is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сюжет не найден")
    scenario = db.scalar(select(Scenario).where(Scenario.story_id == story_id))
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="У сюжета нет актуального сценария")
    return story, scenario


def _story_payload(db: Session, story_id: int) -> StoryListItem:
    item = get_story_read_model(db, story_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сюжет не найден")
    return StoryListItem.model_validate(item)


def _ensure_story_editable(story: Story, current_user: User) -> None:
    if story.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Архивный сюжет нельзя редактировать")
    if not current_user.function_codes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для редактирования сценария")


@router.get("/{story_id}/editor", response_model=StoryEditorPayload)
def get_story_editor(
    story_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> StoryEditorPayload:
    _story, scenario = _get_story_and_scenario(db, story_id)
    rows = db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.scenario_id == scenario.id)
        .order_by(ScenarioRow.order_index.asc(), ScenarioRow.id.asc())
    ).scalars().all()
    return StoryEditorPayload(story=_story_payload(db, story_id), elements=[_row_to_schema(row) for row in rows])


@router.put("/{story_id}/editor", response_model=SaveScenarioRowsResponse)
def save_story_editor(
    story_id: int,
    payload: SaveScenarioRowsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SaveScenarioRowsResponse:
    story, scenario = _get_story_and_scenario(db, story_id)
    _ensure_story_editable(story, current_user)
    normalized_rows, validation_errors = _normalize_rows(payload.rows)
    if validation_errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="\n".join(validation_errors))

    existing_rows = db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.scenario_id == scenario.id)
        .order_by(ScenarioRow.order_index.asc(), ScenarioRow.id.asc())
    ).scalars().all()
    existing_by_id = {row.id: row for row in existing_rows}
    incoming_ids = {int(row["id"]) for row in normalized_rows if row["id"] is not None}
    unknown_ids = incoming_ids - set(existing_by_id)
    if unknown_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Строка не принадлежит актуальному сценарию")

    removed_ids = set(existing_by_id) - incoming_ids
    if removed_ids:
        db.execute(delete(ScenarioRow).where(ScenarioRow.id.in_(removed_ids)))
    for offset, row in enumerate(existing_rows, start=1):
        if row.id not in removed_ids:
            row.order_index = -offset
    db.flush()

    updated = 0
    inserted = 0
    for data in normalized_rows:
        row_id = data.pop("id")
        existing = existing_by_id.get(int(row_id)) if row_id is not None else None
        if existing is not None:
            existing.segment_uid = data.pop("segment_uid") or existing.segment_uid
            for field_name, value in data.items():
                setattr(existing, field_name, value)
            updated += 1
            continue
        segment_uid = data.pop("segment_uid") or generate_segment_uid()
        db.add(ScenarioRow(scenario_id=scenario.id, segment_uid=segment_uid, **data))
        inserted += 1
    db.commit()

    persisted_rows = db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.scenario_id == scenario.id)
        .order_by(ScenarioRow.order_index.asc(), ScenarioRow.id.asc())
    ).scalars().all()
    return SaveScenarioRowsResponse(
        message="Таблица сценария сохранена",
        updated=updated,
        inserted=inserted,
        removed=len(removed_ids),
        total=len(normalized_rows),
        story=_story_payload(db, story_id),
        elements=[_row_to_schema(row) for row in persisted_rows],
    )
