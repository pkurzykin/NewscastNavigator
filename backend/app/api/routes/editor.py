from __future__ import annotations

import re

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


router = APIRouter(prefix="/api/v1/projects", tags=["editor"])

BLOCK_TYPE_CODES = {"podvodka", "zk", "life", "snh"}
BLOCK_LABEL_TO_CODE = {
    "подводка": "podvodka",
    "зк": "zk",
    "лайф": "life",
    "снх": "snh",
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


def _element_to_row(element: ScriptElement) -> ScriptElementRow:
    return ScriptElementRow(
        id=element.id,
        order_index=element.order_index,
        block_type=element.block_type or "zk",
        text=element.text or "",
        speaker_text=element.speaker_text or "",
        file_name=element.file_name or "",
        tc_in=element.tc_in or "",
        tc_out=element.tc_out or "",
        additional_comment=element.additional_comment or "",
    )


def _normalize_editor_rows(
    rows: list[ScriptElementRow],
) -> tuple[list[dict[str, str | int | None]], list[str]]:
    normalized_rows: list[dict[str, str | int | None]] = []
    errors: list[str] = []
    next_order_index = 1

    for row in rows:
        block_type = _normalize_block_type(row.block_type)
        text = (row.text or "").strip()
        speaker_text = (row.speaker_text or "").strip()
        file_name = (row.file_name or "").strip()
        tc_in = (row.tc_in or "").strip()
        tc_out = (row.tc_out or "").strip()
        additional_comment = (row.additional_comment or "").strip()

        is_blank_new_row = (
            row.id is None
            and not text
            and not speaker_text
            and not file_name
            and not tc_in
            and not tc_out
            and not additional_comment
        )
        if is_blank_new_row:
            continue

        tc_in_seconds = _parse_timecode_to_seconds(tc_in) if tc_in else None
        tc_out_seconds = _parse_timecode_to_seconds(tc_out) if tc_out else None
        if tc_in and tc_in_seconds is None:
            errors.append(
                f"Строка {next_order_index}: неверный формат TC IN (используйте MM:SS или HH:MM:SS)."
            )
        if tc_out and tc_out_seconds is None:
            errors.append(
                f"Строка {next_order_index}: неверный формат TC OUT (используйте MM:SS или HH:MM:SS)."
            )
        if (
            tc_in_seconds is not None
            and tc_out_seconds is not None
            and tc_out_seconds < tc_in_seconds
        ):
            errors.append(f"Строка {next_order_index}: TC OUT не может быть меньше TC IN.")

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

        normalized_rows.append(
            {
                "id": row.id,
                "order_index": next_order_index,
                "block_type": block_type,
                "text": text,
                "speaker_text": speaker_text,
                "file_name": file_name,
                "tc_in": tc_in,
                "tc_out": tc_out,
                "additional_comment": additional_comment,
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
    for row in normalized_rows:
        row_id = row.get("id")
        if row_id is not None and int(row_id) in existing_ids:
            db.execute(
                (
                    ScriptElement.__table__.update()
                    .where(ScriptElement.id == int(row_id))
                    .values(
                        order_index=int(row["order_index"]),
                        block_type=str(row["block_type"]),
                        text=str(row["text"]),
                        speaker_text=str(row["speaker_text"]),
                        file_name=str(row["file_name"]),
                        tc_in=str(row["tc_in"]),
                        tc_out=str(row["tc_out"]),
                        additional_comment=str(row["additional_comment"]),
                    )
                )
            )
            updated += 1
        else:
            db.add(
                ScriptElement(
                    project_id=project_id,
                    order_index=int(row["order_index"]),
                    block_type=str(row["block_type"]),
                    text=str(row["text"]),
                    speaker_text=str(row["speaker_text"]),
                    file_name=str(row["file_name"]),
                    tc_in=str(row["tc_in"]),
                    tc_out=str(row["tc_out"]),
                    additional_comment=str(row["additional_comment"]),
                )
            )
            inserted += 1

    db.commit()

    return SaveScriptElementsResponse(
        message="Таблица сценария сохранена",
        updated=updated,
        inserted=inserted,
        removed=len(removed_ids),
        total=len(normalized_rows),
    )
