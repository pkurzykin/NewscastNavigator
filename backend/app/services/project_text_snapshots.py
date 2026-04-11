from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import (
    Project,
    ProjectTextSnapshot,
    ProjectTextSnapshotElement,
    ScriptElement,
)
from app.services.structured_fields import parse_json_object


TEXT_SNAPSHOT_KIND_CURRENT = "current"
TEXT_SNAPSHOT_KIND_CHECKED = "checked"
TEXT_SNAPSHOT_KIND_PROOFREAD = "proofread"
TEXT_SNAPSHOT_KINDS = {
    TEXT_SNAPSHOT_KIND_CURRENT,
    TEXT_SNAPSHOT_KIND_CHECKED,
    TEXT_SNAPSHOT_KIND_PROOFREAD,
}


def generate_text_snapshot_uid() -> str:
    return f"tsnap_{uuid4().hex}"


def get_project_text_snapshot_or_none(
    db: Session,
    *,
    project_id: int,
    snapshot_kind: str,
) -> ProjectTextSnapshot | None:
    return db.execute(
        select(ProjectTextSnapshot)
        .where(
            ProjectTextSnapshot.project_id == project_id,
            ProjectTextSnapshot.snapshot_kind == snapshot_kind,
        )
        .limit(1)
    ).scalar_one_or_none()


def _current_workspace_rows(db: Session, project_id: int) -> list[ScriptElement]:
    return db.execute(
        select(ScriptElement)
        .where(ScriptElement.project_id == project_id)
        .order_by(ScriptElement.order_index.asc(), ScriptElement.id.asc())
    ).scalars().all()


def _append_snapshot_rows(
    db: Session,
    *,
    snapshot_id: str,
    rows: list[ScriptElement],
) -> None:
    for row in rows:
        db.add(
            ProjectTextSnapshotElement(
                snapshot_id=snapshot_id,
                segment_uid=row.segment_uid,
                order_index=row.order_index,
                block_type=row.block_type,
                text=row.text,
                content_json=row.content_json,
                speaker_text=row.speaker_text,
                file_name=row.file_name,
                tc_in=row.tc_in,
                tc_out=row.tc_out,
                additional_comment=row.additional_comment,
                formatting_json=row.formatting_json,
                rich_text_json=row.rich_text_json,
            )
        )


def upsert_project_text_snapshot(
    db: Session,
    *,
    project: Project,
    snapshot_kind: str,
    text_seq: int,
    created_by_user_id: int | None,
) -> ProjectTextSnapshot:
    if snapshot_kind not in TEXT_SNAPSHOT_KINDS:
        raise ValueError(f"Unsupported snapshot kind: {snapshot_kind}")

    snapshot = get_project_text_snapshot_or_none(
        db,
        project_id=project.id,
        snapshot_kind=snapshot_kind,
    )
    if snapshot is None:
        snapshot = ProjectTextSnapshot(
            id=generate_text_snapshot_uid(),
            project_id=project.id,
            snapshot_kind=snapshot_kind,
        )
        db.add(snapshot)
        db.flush()
    else:
        db.execute(
            delete(ProjectTextSnapshotElement).where(
                ProjectTextSnapshotElement.snapshot_id == snapshot.id
            )
        )

    snapshot.text_seq = text_seq
    snapshot.project_title = project.title
    snapshot.project_rubric = project.rubric
    snapshot.project_planned_duration = project.planned_duration
    snapshot.created_by = created_by_user_id
    db.add(snapshot)
    db.flush()

    _append_snapshot_rows(
        db,
        snapshot_id=snapshot.id,
        rows=_current_workspace_rows(db, project.id),
    )
    db.flush()
    return snapshot


def _normalize_payload_value(value: str | None) -> str:
    return (value or "").strip()


def _project_header_snapshot(project: Project) -> dict[str, str]:
    return {
        "title": _normalize_payload_value(project.title),
        "rubric": _normalize_payload_value(project.rubric),
        "planned_duration": _normalize_payload_value(project.planned_duration),
    }


def _snapshot_header_snapshot(snapshot: ProjectTextSnapshot) -> dict[str, str]:
    return {
        "title": _normalize_payload_value(snapshot.project_title),
        "rubric": _normalize_payload_value(snapshot.project_rubric),
        "planned_duration": _normalize_payload_value(snapshot.project_planned_duration),
    }


def _workspace_row_payload(row: ScriptElement) -> dict[str, Any]:
    return {
        "block_type": _normalize_payload_value(row.block_type),
        "text": row.text or "",
        "speaker_text": row.speaker_text or "",
        "file_name": row.file_name or "",
        "tc_in": row.tc_in or "",
        "tc_out": row.tc_out or "",
        "additional_comment": row.additional_comment or "",
        "content_json": parse_json_object(row.content_json),
        "formatting_json": parse_json_object(row.formatting_json),
        "rich_text_json": parse_json_object(row.rich_text_json),
    }


def _snapshot_row_payload(row: ProjectTextSnapshotElement) -> dict[str, Any]:
    return {
        "block_type": _normalize_payload_value(row.block_type),
        "text": row.text or "",
        "speaker_text": row.speaker_text or "",
        "file_name": row.file_name or "",
        "tc_in": row.tc_in or "",
        "tc_out": row.tc_out or "",
        "additional_comment": row.additional_comment or "",
        "content_json": parse_json_object(row.content_json),
        "formatting_json": parse_json_object(row.formatting_json),
        "rich_text_json": parse_json_object(row.rich_text_json),
    }


def build_project_text_snapshot_diff(
    db: Session,
    *,
    project: Project,
    snapshot_kind: str,
) -> dict[str, Any]:
    snapshot = get_project_text_snapshot_or_none(
        db,
        project_id=project.id,
        snapshot_kind=snapshot_kind,
    )
    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Для выбранного состояния текста еще нет сохраненного снимка.",
        )

    header_changes: list[dict[str, Any]] = []
    workspace_header = _project_header_snapshot(project)
    snapshot_header = _snapshot_header_snapshot(snapshot)
    for field_name in ("title", "rubric", "planned_duration"):
        before_value = snapshot_header[field_name] or None
        after_value = workspace_header[field_name] or None
        if before_value != after_value:
            header_changes.append(
                {
                    "field": field_name,
                    "before": before_value,
                    "after": after_value,
                }
            )

    workspace_rows = _current_workspace_rows(db, project.id)
    snapshot_rows = list(snapshot.elements)
    workspace_by_segment = {
        item.segment_uid: item for item in workspace_rows if (item.segment_uid or "").strip()
    }
    snapshot_by_segment = {
        item.segment_uid: item for item in snapshot_rows if (item.segment_uid or "").strip()
    }

    row_changes: list[dict[str, Any]] = []
    summary = {
        "added": 0,
        "removed": 0,
        "changed": 0,
        "moved": 0,
        "total": 0,
    }

    ordered_segment_uids: list[str] = []
    seen_segment_uids: set[str] = set()
    for item in snapshot_rows + workspace_rows:
        segment_uid = (item.segment_uid or "").strip()
        if segment_uid and segment_uid not in seen_segment_uids:
            seen_segment_uids.add(segment_uid)
            ordered_segment_uids.append(segment_uid)

    for segment_uid in ordered_segment_uids:
        before_row = snapshot_by_segment.get(segment_uid)
        after_row = workspace_by_segment.get(segment_uid)
        change_types: list[str] = []
        changed_fields: list[str] = []

        if before_row is None and after_row is not None:
            change_types.append("added")
        elif before_row is not None and after_row is None:
            change_types.append("removed")
        elif before_row is not None and after_row is not None:
            before_payload = _snapshot_row_payload(before_row)
            after_payload = _workspace_row_payload(after_row)
            for field_name, before_value in before_payload.items():
                after_value = after_payload[field_name]
                if before_value != after_value:
                    changed_fields.append(field_name)
            if changed_fields:
                change_types.append("changed")
            if before_row.order_index != after_row.order_index:
                change_types.append("moved")

        if not change_types:
            continue

        for change_type in change_types:
            summary[change_type] += 1
        summary["total"] += 1
        row_changes.append(
            {
                "segment_uid": segment_uid,
                "change_types": change_types,
                "changed_fields": changed_fields,
                "order_before": before_row.order_index if before_row else None,
                "order_after": after_row.order_index if after_row else None,
                "before_row": before_row,
                "after_row": after_row,
            }
        )

    row_changes.sort(
        key=lambda item: (
            min(
                value
                for value in (item["order_after"], item["order_before"])
                if value is not None
            )
            if item["order_after"] is not None or item["order_before"] is not None
            else 10**9,
            item["segment_uid"],
        )
    )

    return {
        "snapshot": snapshot,
        "header_changes": header_changes,
        "row_changes": row_changes,
        "summary": summary,
        "is_outdated": snapshot.text_seq != int(project.text_seq or 0),
    }
