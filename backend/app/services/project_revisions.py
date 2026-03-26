from __future__ import annotations

from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.db.models import Project, ProjectRevision, ProjectRevisionElement, ScriptElement


REVISION_BRANCH_MAIN = "main"
REVISION_KIND_BASELINE = "baseline"
REVISION_KIND_MANUAL = "manual"
REVISION_STATUS_DRAFT = "draft"
REVISION_STATUS_APPROVED = "approved"


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
    snapshot_rows = db.execute(
        select(ProjectRevisionElement)
        .where(ProjectRevisionElement.revision_id == revision.id)
        .order_by(ProjectRevisionElement.order_index.asc(), ProjectRevisionElement.id.asc())
    ).scalars().all()

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
