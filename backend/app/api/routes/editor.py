from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import ScriptElement, User
from app.db.session import get_db
from app.schemas.editor import (
    ProjectEditorPayload,
    SaveScriptElementsRequest,
    SaveScriptElementsResponse,
    ScriptElementRow,
)
from app.services.project_access import ensure_can_edit_project_content
from app.services.project_queries import (
    fetch_project_row as _fetch_project_row,
    project_to_item as _project_to_item,
)
from app.services.segment_ids import generate_segment_uid
from app.services.structured_fields import (
    build_structured_storage,
    dump_json_object,
    normalize_file_bundle_items,
    normalize_row_formatting,
    normalize_rich_text_payload,
    parse_json_object,
    rich_text_from_storage,
    structured_data_from_storage,
)


router = APIRouter(prefix="/api/v1/projects", tags=["editor"])

BLOCK_TYPE_CODES = {"podvodka", "zk", "life", "snh", "zk_geo"}
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
    if not value:
        return None
    if not re.match(r"^\d{2}:\d{2}(:\d{2})?$", value):
        return None

    parts = [int(item) for item in value.split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        if seconds >= 60:
            return None
        return minutes * 60 + seconds

    hours, minutes, seconds = parts
    if minutes >= 60 or seconds >= 60:
        return None
    return hours * 3600 + minutes * 60 + seconds


def _normalize_block_type(raw_block_type: str) -> str:
    text = (raw_block_type or "").strip().lower()
    if text in BLOCK_TYPE_CODES:
        return text
    if text in BLOCK_LABEL_TO_CODE:
        return BLOCK_LABEL_TO_CODE[text]
    return "zk"


def _has_meaningful_row_text(raw_value: str) -> bool:
    text = (raw_value or "").strip().lower()
    if not text:
        return False
    return text not in PLACEHOLDER_ROW_TEXTS


def _normalize_file_bundles(
    raw_value: Any,
    *,
    fallback_file_name: str,
    fallback_tc_in: str,
    fallback_tc_out: str,
) -> list[dict[str, str]]:
    bundles = normalize_file_bundle_items(raw_value)
    if bundles:
        return bundles
    if fallback_file_name or fallback_tc_in or fallback_tc_out:
        return [
            {
                "file_name": fallback_file_name,
                "tc_in": fallback_tc_in,
                "tc_out": fallback_tc_out,
            }
        ]
    return []


def _pick_primary_file_bundle(bundles: list[dict[str, str]]) -> dict[str, str]:
    for bundle in bundles:
        if bundle["file_name"] or bundle["tc_in"] or bundle["tc_out"]:
            return bundle
    return bundles[0] if bundles else {"file_name": "", "tc_in": "", "tc_out": ""}


def _element_to_row(element: ScriptElement) -> ScriptElementRow:
    structured_data = structured_data_from_storage(
        block_type=element.block_type or "zk",
        text=element.text or "",
        content_json=element.content_json,
    )
    formatting = normalize_row_formatting(
        parse_json_object(element.formatting_json),
        block_type=element.block_type or "zk",
    )
    return ScriptElementRow(
        id=element.id,
        segment_uid=element.segment_uid,
        order_index=element.order_index,
        block_type=element.block_type or "zk",
        text=element.text or "",
        speaker_text=element.speaker_text or "",
        file_name=element.file_name or "",
        tc_in=element.tc_in or "",
        tc_out=element.tc_out or "",
        additional_comment=element.additional_comment or "",
        structured_data=structured_data,
        formatting=formatting,
        rich_text=rich_text_from_storage(
            block_type=element.block_type or "zk",
            text=element.text or "",
            speaker_text=element.speaker_text or "",
            content_json=element.content_json,
            formatting_json=element.formatting_json,
            rich_text_json=element.rich_text_json,
        ),
    )


def _normalize_editor_rows(
    rows: list[ScriptElementRow],
) -> tuple[list[dict[str, Any]], list[str]]:
    normalized_rows: list[dict[str, str | int | None]] = []
    errors: list[str] = []
    next_order_index = 1

    for row in rows:
        block_type = _normalize_block_type(row.block_type)
        segment_uid = (row.segment_uid or "").strip() or None
        text = (row.text or "").strip()
        speaker_text = (row.speaker_text or "").strip()
        file_name = (row.file_name or "").strip()
        tc_in = (row.tc_in or "").strip()
        tc_out = (row.tc_out or "").strip()
        additional_comment = (row.additional_comment or "").strip()
        structured_input = row.structured_data if isinstance(row.structured_data, dict) else {}
        file_bundles = _normalize_file_bundles(
            structured_input.get("file_bundles"),
            fallback_file_name=file_name,
            fallback_tc_in=tc_in,
            fallback_tc_out=tc_out,
        )
        primary_file_bundle = _pick_primary_file_bundle(file_bundles)
        file_name = primary_file_bundle["file_name"]
        tc_in = primary_file_bundle["tc_in"]
        tc_out = primary_file_bundle["tc_out"]
        structured_data = {
            **structured_input,
            "file_bundles": file_bundles,
        } if file_bundles else {
            key: value
            for key, value in structured_input.items()
            if key != "file_bundles"
        }
        formatting = normalize_row_formatting(
            row.formatting if isinstance(row.formatting, dict) else {},
            block_type=block_type,
        )

        bundles_to_validate = file_bundles or [
            {
                "file_name": file_name,
                "tc_in": tc_in,
                "tc_out": tc_out,
            }
        ]
        for bundle_index, bundle in enumerate(bundles_to_validate, start=1):
            bundle_tc_in = bundle["tc_in"]
            bundle_tc_out = bundle["tc_out"]
            tc_in_seconds = _parse_timecode_to_seconds(bundle_tc_in) if bundle_tc_in else None
            tc_out_seconds = _parse_timecode_to_seconds(bundle_tc_out) if bundle_tc_out else None
            bundle_prefix = (
                f"Строка {next_order_index}, файл {bundle_index}:"
                if len(bundles_to_validate) > 1
                else f"Строка {next_order_index}:"
            )
            if bundle_tc_in and tc_in_seconds is None:
                errors.append(
                    f"{bundle_prefix} неверный формат TC IN (используйте MM:SS или HH:MM:SS)."
                )
            if bundle_tc_out and tc_out_seconds is None:
                errors.append(
                    f"{bundle_prefix} неверный формат TC OUT (используйте MM:SS или HH:MM:SS)."
                )
            if (
                tc_in_seconds is not None
                and tc_out_seconds is not None
                and tc_out_seconds < tc_in_seconds
            ):
                errors.append(f"{bundle_prefix} TC OUT не может быть меньше TC IN.")

        if block_type == "snh":
            lines = [line.strip() for line in speaker_text.splitlines() if line.strip()]
            requires_snh_meta = bool(lines) or _has_meaningful_row_text(text)
            if requires_snh_meta and len(lines) != 2:
                errors.append(
                    f"Строка {next_order_index}: для СНХ нужно заполнить ФИО и должность отдельными строками."
                )
            elif len(lines) == 2:
                speaker_text = "\n".join(lines)
            else:
                speaker_text = ""

        text, content_json = build_structured_storage(
            block_type=block_type,
            text=text,
            structured_data=structured_data,
        )
        structured_data = structured_data_from_storage(
            block_type=block_type,
            text=text,
            content_json=content_json,
        )

        rich_text = normalize_rich_text_payload(
            row.rich_text if isinstance(row.rich_text, dict) else {},
            block_type=block_type,
            text=text,
            speaker_text=speaker_text,
            structured_data=structured_data,
            formatting=formatting,
        )

        normalized_rows.append(
            {
                "id": row.id,
                "segment_uid": segment_uid,
                "order_index": next_order_index,
                "block_type": block_type,
                "text": text,
                "content_json": content_json,
                "speaker_text": speaker_text,
                "file_name": file_name,
                "tc_in": tc_in,
                "tc_out": tc_out,
                "additional_comment": additional_comment,
                "structured_data": structured_data,
                "formatting": formatting,
                "formatting_json": dump_json_object(formatting),
                "rich_text": rich_text,
                "rich_text_json": dump_json_object(rich_text),
            }
        )
        next_order_index += 1

    return normalized_rows, errors


@router.get("/{project_id}/editor", response_model=ProjectEditorPayload)
def get_project_editor(
    project_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> ProjectEditorPayload:
    project, author_username, executor_username, proofreader_username, archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    rows = db.execute(
        select(ScriptElement)
        .where(ScriptElement.project_id == project_id)
        .order_by(ScriptElement.order_index.asc(), ScriptElement.id.asc())
    ).scalars().all()

    return ProjectEditorPayload(
        project=_project_to_item(
            project,
            author_username=author_username,
            executor_username=executor_username,
            proofreader_username=proofreader_username,
            archived_by_username=archived_by_username,
        ),
        elements=[_element_to_row(row) for row in rows],
    )


@router.put("/{project_id}/editor", response_model=SaveScriptElementsResponse)
def save_project_editor(
    project_id: int,
    payload: SaveScriptElementsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SaveScriptElementsResponse:
    project, _author_username, _executor_username, _proofreader_username, _archived_by_username = _fetch_project_row(
        db,
        project_id,
    )
    ensure_can_edit_project_content(current_user, project)

    normalized_rows, validation_errors = _normalize_editor_rows(payload.rows)
    if validation_errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="\n".join(validation_errors),
        )

    existing_rows = db.execute(
        select(ScriptElement.id).where(ScriptElement.project_id == project_id)
    ).all()
    existing_ids = {int(row[0]) for row in existing_rows}
    incoming_ids = {
        int(row["id"])
        for row in normalized_rows
        if row.get("id") is not None
    }

    removed_ids = sorted(existing_ids - incoming_ids)
    if removed_ids:
        db.execute(delete(ScriptElement).where(ScriptElement.id.in_(removed_ids)))

    updated = 0
    inserted = 0
    existing_segment_uids = {
        int(row.id): row.segment_uid
        for row in db.execute(
            select(ScriptElement.id, ScriptElement.segment_uid).where(ScriptElement.project_id == project_id)
        ).all()
    }
    for row in normalized_rows:
        row_id = row.get("id")
        if row_id is not None and int(row_id) in existing_ids:
            segment_uid = str(
                row.get("segment_uid") or existing_segment_uids[int(row_id)] or generate_segment_uid()
            )
            db.execute(
                (
                    ScriptElement.__table__.update()
                    .where(ScriptElement.id == int(row_id))
                    .values(
                        segment_uid=segment_uid,
                        order_index=int(row["order_index"]),
                        block_type=str(row["block_type"]),
                        text=str(row["text"]),
                        content_json=str(row["content_json"]),
                        speaker_text=str(row["speaker_text"]),
                        file_name=str(row["file_name"]),
                        tc_in=str(row["tc_in"]),
                        tc_out=str(row["tc_out"]),
                        additional_comment=str(row["additional_comment"]),
                        formatting_json=str(row["formatting_json"]),
                        rich_text_json=str(row["rich_text_json"]),
                    )
                )
            )
            updated += 1
        else:
            segment_uid = str(row.get("segment_uid") or generate_segment_uid())
            db.add(
                ScriptElement(
                    project_id=project_id,
                    segment_uid=segment_uid,
                    order_index=int(row["order_index"]),
                    block_type=str(row["block_type"]),
                    text=str(row["text"]),
                    content_json=str(row["content_json"]),
                    speaker_text=str(row["speaker_text"]),
                    file_name=str(row["file_name"]),
                    tc_in=str(row["tc_in"]),
                    tc_out=str(row["tc_out"]),
                    additional_comment=str(row["additional_comment"]),
                    formatting_json=str(row["formatting_json"]),
                    rich_text_json=str(row["rich_text_json"]),
                )
            )
            inserted += 1

    db.commit()

    persisted_rows = db.execute(
        select(ScriptElement)
        .where(ScriptElement.project_id == project_id)
        .order_by(ScriptElement.order_index.asc(), ScriptElement.id.asc())
    ).scalars().all()

    return SaveScriptElementsResponse(
        message="Таблица сценария сохранена",
        updated=updated,
        inserted=inserted,
        removed=len(removed_ids),
        total=len(normalized_rows),
        elements=[_element_to_row(row) for row in persisted_rows],
    )
