from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import (
    Scenario,
    ScenarioEditSession,
    ScenarioReadMarker,
    ScenarioRevision,
    ScenarioRevisionRow,
    ScenarioRow,
    Story,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.services.permissions import is_leadership
from app.services.scenario_diff import build_scenario_diff, scenario_snapshot_hash
from app.services.scenario_serialization import ROW_FIELDS, make_revision_row


def _error(code: str, message: str, http_status: int = status.HTTP_409_CONFLICT) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _revision(db: Session, *, scenario_id: int, revision_no: int) -> ScenarioRevision | None:
    return db.scalar(
        select(ScenarioRevision).where(
            ScenarioRevision.scenario_id == scenario_id,
            ScenarioRevision.revision_no == revision_no,
        )
    )


def revision_rows(db: Session, revision: ScenarioRevision) -> list[ScenarioRevisionRow]:
    return db.execute(
        select(ScenarioRevisionRow)
        .where(ScenarioRevisionRow.revision_id == revision.id)
        .order_by(ScenarioRevisionRow.order_index.asc(), ScenarioRevisionRow.id.asc())
    ).scalars().all()


def ensure_current_revision_snapshot(db: Session, *, scenario: Scenario, actor: User) -> ScenarioRevision:
    existing = _revision(db, scenario_id=scenario.id, revision_no=scenario.revision_no)
    if existing is not None:
        return existing
    revision = ScenarioRevision(
        scenario_id=scenario.id,
        revision_no=scenario.revision_no,
        client_save_id=f"boundary_{scenario.id}_{scenario.revision_no}",
        edit_session_id=None,
        created_by_user_id=actor.id,
    )
    db.add(revision)
    db.flush()
    rows = db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.scenario_id == scenario.id)
        .order_by(ScenarioRow.order_index.asc(), ScenarioRow.id.asc())
    ).scalars().all()
    db.add_all(make_revision_row(revision_id=revision.id, row=row) for row in rows)
    db.flush()
    return revision


def finalize_edit_session(
    db: Session,
    *,
    session: ScenarioEditSession,
    ended_at: datetime,
) -> None:
    if session.ended_at is not None:
        return
    scenario = db.get(Scenario, session.scenario_id)
    base = _revision(db, scenario_id=session.scenario_id, revision_no=session.base_revision_no)
    latest = _revision(db, scenario_id=session.scenario_id, revision_no=session.latest_revision_no)
    if base is None or latest is None:
        summary = {"added": 0, "removed": 0, "changed": 0, "moved": 0, "total": 0}
        changes: list[dict] = []
    else:
        summary, changes = build_scenario_diff(revision_rows(db, base), revision_rows(db, latest))

    session.diff_summary = summary
    session.diff_payload = {"changes": changes, "save_hashes": {}}
    session.ended_at = ended_at
    db.flush()
    from app.services.notification_service import finalize_late_edit_notifications

    # Persist recipient-relative diffs before compacting intermediate autosave snapshots:
    # a downstream worker may have opened one of those exact revisions mid-session.
    finalize_late_edit_notifications(db, session=session, now=ended_at)

    session_revisions = db.execute(
        select(ScenarioRevision)
        .where(ScenarioRevision.edit_session_id == session.id)
        .order_by(ScenarioRevision.revision_no.asc())
    ).scalars().all()
    late_diff_baselines: set[int] = set()
    if scenario is not None:
        late_diff_baselines.update(
            db.execute(
                select(ScenarioReadMarker.revision_no).where(
                    ScenarioReadMarker.story_id == scenario.story_id,
                    ScenarioReadMarker.context.in_({"video", "titles", "captionpanels"}),
                )
            ).scalars()
        )
        workflow = db.get(StoryWorkflowState, scenario.story_id)
        production = db.get(StoryProductionState, scenario.story_id)
        late_diff_baselines.update(
            revision
            for revision in (
                workflow.proofread_revision if workflow is not None else None,
                production.video_started_revision if production is not None else None,
                production.titles_started_revision if production is not None else None,
            )
            if revision is not None
        )
    save_hashes: dict[str, str] = {}
    for revision in session_revisions:
        rows = revision_rows(db, revision)
        save_hashes[revision.client_save_id] = scenario_snapshot_hash(rows)

    if scenario is not None:
        retained_revisions = late_diff_baselines | {scenario.revision_no}
        retained_revisions.update(
            db.execute(
                select(ScenarioEditSession.latest_revision_no).where(
                    ScenarioEditSession.scenario_id == scenario.id,
                )
            ).scalars()
        )
        prunable_revision_ids = list(
            db.execute(
                select(ScenarioRevision.id).where(
                    ScenarioRevision.scenario_id == scenario.id,
                    ScenarioRevision.edit_session_id.is_not(None),
                    ScenarioRevision.revision_no.not_in(retained_revisions),
                )
            ).scalars()
        )
        if prunable_revision_ids:
            db.execute(
                delete(ScenarioRevisionRow).where(
                    ScenarioRevisionRow.revision_id.in_(prunable_revision_ids)
                )
            )

    session.diff_payload = {"changes": changes, "save_hashes": save_hashes}
    db.flush()


def restore_edit_session(
    db: Session,
    *,
    story_id: int,
    edit_session_id: int,
    actor: User,
) -> Scenario:
    if not is_leadership(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    story = db.get(Story, story_id)
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)
    if story.archived_at is not None:
        raise _error("STORY_ARCHIVED", "Архивный сюжет нельзя изменять")
    scenario = db.scalar(select(Scenario).where(Scenario.story_id == story_id).with_for_update())
    if scenario is None:
        raise _error("SCENARIO_NOT_FOUND", "У сюжета нет сценария", status.HTTP_404_NOT_FOUND)
    source_session = db.get(ScenarioEditSession, edit_session_id)
    if source_session is None or source_session.scenario_id != scenario.id:
        raise _error("EDIT_SESSION_NOT_FOUND", "Сеанс редактирования не найден", status.HTTP_404_NOT_FOUND)
    source_revision = _revision(
        db,
        scenario_id=scenario.id,
        revision_no=source_session.latest_revision_no,
    )
    if source_session.ended_at is None or source_session.diff_summary is None or source_revision is None:
        raise _error("SESSION_HAS_NO_SNAPSHOT", "У сеанса нет доступного снимка")
    source_rows = revision_rows(db, source_revision)
    now = datetime.now(UTC)
    active_session = db.scalar(
        select(ScenarioEditSession).where(
            ScenarioEditSession.scenario_id == scenario.id,
            ScenarioEditSession.ended_at.is_(None),
        ).with_for_update()
    )
    if active_session is not None and _as_utc(active_session.expires_at) <= now:
        finalize_edit_session(db, session=active_session, ended_at=now)
        active_session = None
    if active_session is not None:
        raise _error("SCENARIO_LEASE_HELD", "Сценарий сейчас редактируется")

    current_revision = _revision(db, scenario_id=scenario.id, revision_no=scenario.revision_no)
    if current_revision is None:
        current_revision = ensure_current_revision_snapshot(db, scenario=scenario, actor=actor)
    restore_session = ScenarioEditSession(
        scenario_id=scenario.id,
        actor_user_id=actor.id,
        lease_token_hash=uuid4().hex + uuid4().hex,
        base_revision_no=scenario.revision_no,
        latest_revision_no=scenario.revision_no + 1,
        started_at=now,
        last_activity_at=now,
        expires_at=now,
    )
    db.add(restore_session)
    db.flush()

    db.execute(delete(ScenarioRow).where(ScenarioRow.scenario_id == scenario.id))
    db.flush()
    current_rows: list[ScenarioRow] = []
    for source_row in source_rows:
        row = ScenarioRow(
            scenario_id=scenario.id,
            **{field: getattr(source_row, field) for field in ROW_FIELDS},
        )
        db.add(row)
        current_rows.append(row)
    db.flush()

    next_revision_no = scenario.revision_no + 1
    revision = ScenarioRevision(
        scenario_id=scenario.id,
        revision_no=next_revision_no,
        client_save_id=f"restore_{uuid4().hex}",
        edit_session_id=restore_session.id,
        created_by_user_id=actor.id,
    )
    db.add(revision)
    db.flush()
    db.add_all(make_revision_row(revision_id=revision.id, row=row) for row in current_rows)
    scenario.revision_no = next_revision_no
    from app.services.workflow_service import apply_workflow_revision_change

    apply_workflow_revision_change(
        db,
        story_id=story_id,
        actor=actor,
        revision=next_revision_no,
        changed_at=now,
    )
    db.flush()
    finalize_edit_session(db, session=restore_session, ended_at=now)
    db.commit()
    db.refresh(scenario)
    return scenario
