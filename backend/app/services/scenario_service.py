from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

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
    User,
)
from app.schemas.scenario import SaveScenarioAck, SaveScenarioRequest, ScenarioCaptionPanelsState
from app.services.scenario_serialization import ROW_FIELDS, make_revision_row, row_values
from app.services.scenario_diff import scenario_snapshot_hash
from app.services.scenario_sessions import require_owned_lease


def _error(code: str, message: str, http_status: int = status.HTTP_409_CONFLICT) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def get_active_story_scenario(db: Session, *, story_id: int) -> tuple[Story, Scenario]:
    story = db.get(Story, story_id)
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)
    if story.archived_at is not None:
        raise _error("STORY_ARCHIVED", "Архивный сюжет нельзя изменять")
    scenario = db.scalar(select(Scenario).where(Scenario.story_id == story_id).with_for_update())
    if scenario is None:
        raise _error("SCENARIO_NOT_FOUND", "У сюжета нет сценария", status.HTTP_404_NOT_FOUND)
    return story, scenario


OPEN_CONTEXTS = frozenset({"scenario", "video", "titles", "captionpanels"})


def upsert_scenario_read_marker(
    db: Session,
    *,
    story_id: int,
    user_id: int,
    context: str,
    revision_no: int,
) -> ScenarioReadMarker:
    marker = db.scalar(
        select(ScenarioReadMarker).where(
            ScenarioReadMarker.story_id == story_id,
            ScenarioReadMarker.user_id == user_id,
            ScenarioReadMarker.context == context,
        )
    )
    now = datetime.now(UTC)
    if marker is None:
        marker = ScenarioReadMarker(
            story_id=story_id,
            user_id=user_id,
            context=context,
            revision_no=revision_no,
            opened_at=now,
        )
        db.add(marker)
    else:
        marker.revision_no = max(marker.revision_no, revision_no)
        marker.opened_at = now
    db.flush()
    return marker


def mark_scenario_opened(
    db: Session,
    *,
    story_id: int,
    actor: User,
    context: str,
    revision_no: int,
) -> Scenario:
    if context not in OPEN_CONTEXTS:
        raise _error(
            "OPEN_CONTEXT_INVALID",
            "Контекст открытия сценария не поддерживается",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    story = db.get(Story, story_id)
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)
    scenario = db.scalar(select(Scenario).where(Scenario.story_id == story_id).with_for_update())
    if scenario is None:
        raise _error("SCENARIO_NOT_FOUND", "У сюжета нет сценария", status.HTTP_404_NOT_FOUND)
    revision_exists = revision_no == scenario.revision_no or db.scalar(
        select(ScenarioRevision.id).where(
            ScenarioRevision.scenario_id == scenario.id,
            ScenarioRevision.revision_no == revision_no,
        )
    ) is not None
    if not revision_exists:
        raise _error(
            "REVISION_NOT_FOUND",
            "Редакция не принадлежит сценарию сюжета",
            status.HTTP_404_NOT_FOUND,
        )
    marker = upsert_scenario_read_marker(
        db,
        story_id=story_id,
        user_id=actor.id,
        context=context,
        revision_no=revision_no,
    )
    from app.services.notification_service import mark_downstream_notifications_read

    mark_downstream_notifications_read(
        db,
        story_id=story_id,
        user_id=actor.id,
        context=context,
        revision_no=marker.revision_no,
        now=datetime.now(UTC),
    )
    db.commit()
    return scenario


def get_captionpanels_state(
    db: Session,
    *,
    story_id: int,
    scenario: Scenario,
    user_id: int,
) -> ScenarioCaptionPanelsState:
    marker = db.scalar(
        select(ScenarioReadMarker).where(
            ScenarioReadMarker.story_id == story_id,
            ScenarioReadMarker.user_id == user_id,
            ScenarioReadMarker.context == "captionpanels",
        )
    )
    if marker is None:
        return ScenarioCaptionPanelsState()
    changed = scenario.revision_no > marker.revision_no
    diff_session_id: int | None = None
    if changed:
        completed_sessions = db.execute(
            select(ScenarioEditSession)
            .where(
                ScenarioEditSession.scenario_id == scenario.id,
                ScenarioEditSession.ended_at.is_not(None),
                ScenarioEditSession.latest_revision_no > marker.revision_no,
                ScenarioEditSession.latest_revision_no <= scenario.revision_no,
            )
            .order_by(
                ScenarioEditSession.latest_revision_no.desc(),
                ScenarioEditSession.ended_at.desc(),
                ScenarioEditSession.id.desc(),
            )
        ).scalars()
        diff_session_id = next(
            (
                session.id
                for session in completed_sessions
                if int((session.diff_summary or {}).get("total", 0)) > 0
            ),
            None,
        )
    return ScenarioCaptionPanelsState(
        last_opened_revision=marker.revision_no,
        changed_since_last_open=changed,
        diff_session_id=diff_session_id,
    )


def _is_equivalent_retry(
    db: Session,
    *,
    revision: ScenarioRevision,
    payload: SaveScenarioRequest,
) -> bool:
    if payload.base_revision != revision.revision_no - 1:
        return False
    persisted_rows = db.execute(
        select(ScenarioRevisionRow)
        .where(ScenarioRevisionRow.revision_id == revision.id)
        .order_by(ScenarioRevisionRow.order_index.asc(), ScenarioRevisionRow.id.asc())
    ).scalars().all()
    requested_values = [row_values(row, order_index=index) for index, row in enumerate(payload.rows, start=1)]
    persisted_values = [{field: getattr(row, field) for field in ROW_FIELDS} for row in persisted_rows]
    if not persisted_rows and revision.edit_session_id is not None:
        from app.db.models import ScenarioEditSession

        session = db.get(ScenarioEditSession, revision.edit_session_id)
        saved_hash = (session.diff_payload or {}).get("save_hashes", {}).get(revision.client_save_id) if session else None
        if saved_hash is not None:
            return saved_hash == scenario_snapshot_hash(requested_values)
    return requested_values == persisted_values


def _require_client_segment_uids(payload: SaveScenarioRequest) -> None:
    for row in payload.rows:
        if not row.segment_uid.startswith("seg_"):
            raise _error(
                "SEGMENT_UID_INVALID",
                "segment_uid должен иметь вид seg_<UUID>",
                status.HTTP_422_UNPROCESSABLE_CONTENT,
            )
        try:
            UUID(row.segment_uid.removeprefix("seg_"))
        except ValueError as exc:
            raise _error(
                "SEGMENT_UID_INVALID",
                "segment_uid должен иметь вид seg_<UUID>",
                status.HTTP_422_UNPROCESSABLE_CONTENT,
            ) from exc


def save_scenario(
    db: Session,
    *,
    story_id: int,
    actor: User,
    payload: SaveScenarioRequest,
) -> SaveScenarioAck:
    _story, scenario = get_active_story_scenario(db, story_id=story_id)
    _require_client_segment_uids(payload)

    existing_save = db.scalar(
        select(ScenarioRevision).where(
            ScenarioRevision.scenario_id == scenario.id,
            ScenarioRevision.client_save_id == payload.client_save_id,
        )
    )
    if existing_save is not None:
        if existing_save.created_by_user_id != actor.id:
            raise _error("SCENARIO_SAVE_ID_REUSED", "client_save_id уже использован")
        if not _is_equivalent_retry(db, revision=existing_save, payload=payload):
            raise _error("SCENARIO_SAVE_ID_REUSED", "client_save_id уже использован для другой правки")
        return SaveScenarioAck(
            client_save_id=payload.client_save_id,
            revision=existing_save.revision_no,
            saved_at=existing_save.created_at,
        )

    session = require_owned_lease(
        db,
        scenario=scenario,
        actor=actor,
        edit_session_id=payload.edit_session_id,
        lease_token=payload.lease_token,
    )
    if payload.base_revision != scenario.revision_no:
        raise _error("SCENARIO_REVISION_CONFLICT", "Сценарий изменился на сервере")

    existing_rows = db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.scenario_id == scenario.id)
        .order_by(ScenarioRow.order_index.asc(), ScenarioRow.id.asc())
    ).scalars().all()
    existing_by_segment = {row.segment_uid: row for row in existing_rows}
    incoming_segments = {row.segment_uid for row in payload.rows}
    db.execute(
        delete(ScenarioRow).where(
            ScenarioRow.scenario_id == scenario.id,
            ScenarioRow.segment_uid.not_in(incoming_segments),
        )
    ) if existing_rows else None
    for offset, row in enumerate(existing_rows, start=1):
        if row.segment_uid in incoming_segments:
            row.order_index = -offset
    db.flush()

    persisted_rows: list[ScenarioRow] = []
    for order_index, input_row in enumerate(payload.rows, start=1):
        values = row_values(input_row, order_index=order_index)
        row = existing_by_segment.get(input_row.segment_uid)
        if row is None:
            row = ScenarioRow(scenario_id=scenario.id, **values)
            db.add(row)
        else:
            for field_name, value in values.items():
                setattr(row, field_name, value)
        persisted_rows.append(row)
    db.flush()

    next_revision = scenario.revision_no + 1
    revision = ScenarioRevision(
        scenario_id=scenario.id,
        revision_no=next_revision,
        client_save_id=payload.client_save_id,
        edit_session_id=session.id,
        created_by_user_id=actor.id,
    )
    db.add(revision)
    db.flush()
    db.add_all(make_revision_row(revision_id=revision.id, row=row) for row in persisted_rows)
    now = datetime.now(UTC)
    scenario.revision_no = next_revision
    session.latest_revision_no = next_revision
    session.last_activity_at = now
    from app.services.workflow_service import apply_workflow_revision_change

    apply_workflow_revision_change(
        db,
        story_id=story_id,
        actor=actor,
        revision=next_revision,
        changed_at=now,
    )
    db.commit()
    db.refresh(revision)
    return SaveScenarioAck(
        client_save_id=payload.client_save_id,
        revision=next_revision,
        saved_at=revision.created_at,
    )
