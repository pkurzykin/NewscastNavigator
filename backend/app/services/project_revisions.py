from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.db.models import Project, ProjectRevision, ProjectRevisionElement, ScriptElement
from app.services.structured_fields import parse_json_object


REVISION_BRANCH_MAIN = "main"
REVISION_KIND_BASELINE = "baseline"
REVISION_KIND_MANUAL = "manual"
REVISION_STATUS_DRAFT = "draft"
REVISION_STATUS_SUBMITTED = "submitted"
REVISION_STATUS_APPROVED = "approved"
REVISION_STATUS_REJECTED = "rejected"


def generate_revision_uid() -> str:
    return f"rev_{uuid4().hex}"


def get_current_project_revision(db: Session, project_id: int) -> ProjectRevision | None:
    return db.execute(
        select(ProjectRevision)
        .where(ProjectRevision.project_id == project_id, ProjectRevision.is_current.is_(True))
        .order_by(ProjectRevision.revision_no.desc(), ProjectRevision.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def get_latest_project_revision(db: Session, project_id: int) -> ProjectRevision | None:
    return db.execute(
        select(ProjectRevision)
        .where(ProjectRevision.project_id == project_id)
        .order_by(ProjectRevision.revision_no.desc(), ProjectRevision.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def list_project_revisions(db: Session, project_id: int) -> list[ProjectRevision]:
    return db.execute(
        select(ProjectRevision)
        .where(ProjectRevision.project_id == project_id)
        .order_by(ProjectRevision.revision_no.desc(), ProjectRevision.created_at.desc())
    ).scalars().all()


def get_project_revision_or_none(db: Session, project_id: int, revision_id: str) -> ProjectRevision | None:
    return db.execute(
        select(ProjectRevision)
        .where(ProjectRevision.project_id == project_id, ProjectRevision.id == revision_id)
        .limit(1)
    ).scalar_one_or_none()


def list_project_revision_elements(
    db: Session,
    *,
    revision_id: str,
) -> list[ProjectRevisionElement]:
    return db.execute(
        select(ProjectRevisionElement)
        .where(ProjectRevisionElement.revision_id == revision_id)
        .order_by(ProjectRevisionElement.order_index.asc(), ProjectRevisionElement.id.asc())
    ).scalars().all()


def _next_revision_no(db: Session, project_id: int) -> int:
    current_max = db.execute(
        select(func.max(ProjectRevision.revision_no)).where(ProjectRevision.project_id == project_id)
    ).scalar_one_or_none()
    return int(current_max or 0) + 1


def _current_workspace_rows(db: Session, project_id: int) -> list[ScriptElement]:
    return db.execute(
        select(ScriptElement)
        .where(ScriptElement.project_id == project_id)
        .order_by(ScriptElement.order_index.asc(), ScriptElement.id.asc())
    ).scalars().all()


def _append_snapshot_rows(
    db: Session,
    *,
    revision_id: str,
    rows: list[ScriptElement],
) -> None:
    for row in rows:
        db.add(
            ProjectRevisionElement(
                revision_id=revision_id,
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


def _create_revision_snapshot(
    db: Session,
    *,
    project: Project,
    created_by_user_id: int | None,
    revision_kind: str,
    status: str,
    is_current: bool,
    parent_revision_id: str | None,
    title: str,
    comment: str,
) -> ProjectRevision:
    revision = ProjectRevision(
        id=generate_revision_uid(),
        project_id=project.id,
        revision_no=_next_revision_no(db, project.id),
        parent_revision_id=parent_revision_id,
        branch_key=REVISION_BRANCH_MAIN,
        revision_kind=revision_kind,
        status=status,
        title=title.strip(),
        comment=comment.strip(),
        project_title=project.title,
        project_rubric=project.rubric,
        project_planned_duration=project.planned_duration,
        created_by=created_by_user_id,
        is_current=is_current,
    )
    db.add(revision)
    db.flush()
    _append_snapshot_rows(
        db,
        revision_id=revision.id,
        rows=_current_workspace_rows(db, project.id),
    )
    db.flush()
    return revision


def ensure_project_baseline_revision(
    db: Session,
    *,
    project: Project,
    created_by_user_id: int | None,
) -> tuple[ProjectRevision, bool]:
    latest = get_latest_project_revision(db, project.id)
    if latest is not None:
        return latest, False

    baseline = _create_revision_snapshot(
        db,
        project=project,
        created_by_user_id=created_by_user_id,
        revision_kind=REVISION_KIND_BASELINE,
        status=REVISION_STATUS_APPROVED,
        is_current=True,
        parent_revision_id=None,
        title="Базовая версия",
        comment="Автоматически создана из текущего состояния проекта",
    )
    return baseline, True


def create_manual_project_revision(
    db: Session,
    *,
    project: Project,
    created_by_user_id: int | None,
    title: str,
    comment: str,
) -> ProjectRevision:
    current_revision = get_current_project_revision(db, project.id)
    if current_revision is None:
        current_revision, _ = ensure_project_baseline_revision(
            db,
            project=project,
            created_by_user_id=created_by_user_id,
        )

    next_revision_no = _next_revision_no(db, project.id)
    normalized_title = title.strip() or f"Версия {next_revision_no}"
    return _create_revision_snapshot(
        db,
        project=project,
        created_by_user_id=created_by_user_id,
        revision_kind=REVISION_KIND_MANUAL,
        status=REVISION_STATUS_DRAFT,
        is_current=False,
        parent_revision_id=current_revision.id if current_revision else None,
        title=normalized_title,
        comment=comment.strip(),
    )


def restore_project_revision_to_workspace(
    db: Session,
    *,
    project: Project,
    revision: ProjectRevision,
) -> None:
    snapshot_rows = list_project_revision_elements(db, revision_id=revision.id)

    db.execute(delete(ScriptElement).where(ScriptElement.project_id == project.id))

    project.title = revision.project_title
    project.rubric = revision.project_rubric
    project.planned_duration = revision.project_planned_duration
    db.add(project)

    for row in snapshot_rows:
        db.add(
            ScriptElement(
                project_id=project.id,
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
    db.flush()


def mark_project_revision_current(
    db: Session,
    *,
    project_id: int,
    revision: ProjectRevision,
) -> ProjectRevision:
    if revision.status != REVISION_STATUS_APPROVED:
        raise ValueError("only_approved_revision_can_be_current")
    db.execute(
        update(ProjectRevision)
        .where(ProjectRevision.project_id == project_id, ProjectRevision.is_current.is_(True))
        .values(is_current=False)
    )
    revision.is_current = True
    revision.status = REVISION_STATUS_APPROVED
    db.add(revision)
    db.flush()
    return revision


def submit_project_revision(
    db: Session,
    *,
    revision: ProjectRevision,
) -> ProjectRevision:
    if revision.is_current:
        raise ValueError("current_revision_cannot_be_submitted")
    if revision.status not in {REVISION_STATUS_DRAFT, REVISION_STATUS_REJECTED}:
        raise ValueError("revision_cannot_be_submitted")
    revision.status = REVISION_STATUS_SUBMITTED
    db.add(revision)
    db.flush()
    return revision


def approve_project_revision(
    db: Session,
    *,
    revision: ProjectRevision,
) -> ProjectRevision:
    if revision.status != REVISION_STATUS_SUBMITTED:
        raise ValueError("only_submitted_revision_can_be_approved")
    revision.status = REVISION_STATUS_APPROVED
    db.add(revision)
    db.flush()
    return revision


def reject_project_revision(
    db: Session,
    *,
    revision: ProjectRevision,
) -> ProjectRevision:
    if revision.status != REVISION_STATUS_SUBMITTED:
        raise ValueError("only_submitted_revision_can_be_rejected")
    revision.status = REVISION_STATUS_REJECTED
    db.add(revision)
    db.flush()
    return revision


def _normalize_revision_payload_value(value: str | None) -> str:
    return (value or "").strip()


def _revision_header_snapshot(revision: ProjectRevision) -> dict[str, str]:
    return {
        "title": _normalize_revision_payload_value(revision.project_title),
        "rubric": _normalize_revision_payload_value(revision.project_rubric),
        "planned_duration": _normalize_revision_payload_value(revision.project_planned_duration),
    }


def _revision_element_payload(row: ProjectRevisionElement) -> dict[str, Any]:
    return {
        "block_type": _normalize_revision_payload_value(row.block_type),
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


def build_project_revision_diff(
    db: Session,
    *,
    revision: ProjectRevision,
    against_revision: ProjectRevision,
) -> dict[str, Any]:
    header_changes: list[dict[str, Any]] = []
    revision_header = _revision_header_snapshot(revision)
    against_header = _revision_header_snapshot(against_revision)
    for field_name in ("title", "rubric", "planned_duration"):
        before_value = against_header[field_name] or None
        after_value = revision_header[field_name] or None
        if before_value != after_value:
            header_changes.append(
                {
                    "field": field_name,
                    "before": before_value,
                    "after": after_value,
                }
            )

    revision_rows = list_project_revision_elements(db, revision_id=revision.id)
    against_rows = list_project_revision_elements(db, revision_id=against_revision.id)
    revision_by_segment = {
        item.segment_uid: item for item in revision_rows if (item.segment_uid or "").strip()
    }
    against_by_segment = {
        item.segment_uid: item for item in against_rows if (item.segment_uid or "").strip()
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
    for item in against_rows + revision_rows:
        segment_uid = (item.segment_uid or "").strip()
        if segment_uid and segment_uid not in seen_segment_uids:
            seen_segment_uids.add(segment_uid)
            ordered_segment_uids.append(segment_uid)

    for segment_uid in ordered_segment_uids:
        before_row = against_by_segment.get(segment_uid)
        after_row = revision_by_segment.get(segment_uid)
        change_types: list[str] = []
        changed_fields: list[str] = []

        if before_row is None and after_row is not None:
            change_types.append("added")
        elif before_row is not None and after_row is None:
            change_types.append("removed")
        elif before_row is not None and after_row is not None:
            before_payload = _revision_element_payload(before_row)
            after_payload = _revision_element_payload(after_row)
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
                for value in (
                    item["order_after"],
                    item["order_before"],
                )
                if value is not None
            )
            if item["order_after"] is not None or item["order_before"] is not None
            else 10**9,
            item["segment_uid"],
        )
    )

    return {
        "header_changes": header_changes,
        "row_changes": row_changes,
        "summary": summary,
    }
