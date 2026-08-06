from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Rubric, Scenario, ScenarioEditSession, ScenarioRow, User
from app.db.session import get_db
from app.domain.codes import DEFAULT_RUBRIC_NAMES
from app.schemas.common import CommandAck
from app.schemas.scenario import (
    AcquireScenarioLeaseResponse,
    LeaseHeartbeatRequest,
    LeaseHeartbeatResponse,
    ReleaseScenarioLeaseRequest,
    SaveScenarioAck,
    SaveScenarioRequest,
    ScenarioEditState,
    ScenarioMetadataState,
    ScenarioReadModel,
    ScenarioOpenedRequest,
    ScenarioReadResponse,
)
from app.schemas.scenario_export import ScenarioDocxExportRequest
from app.schemas.stories import RubricRef, StoryListItem, UserRef
from app.services.action_policy import can_update_story_metadata
from app.services.scenario_docx_renderer import (
    DOCX_CONTENT_TYPE,
    render_scenario_docx,
    safe_docx_filename,
)
from app.services.scenario_docx_snapshot import build_scenario_docx_snapshot
from app.services.scenario_service import (
    get_active_story_scenario,
    get_captionpanels_state,
    mark_scenario_opened,
    save_scenario,
)
from app.services.scenario_serialization import scenario_row_values
from app.services.scenario_sessions import acquire_lease, expire_current_lease, heartbeat_lease, release_lease
from app.services.story_queries import get_story_read_model
from app.services.story_service import lock_story_aggregate


router = APIRouter(prefix="/api/v1/stories", tags=["scenario"])


@router.post("/{story_id}/scenario/export-docx")
def export_story_scenario_docx(
    story_id: int,
    payload: ScenarioDocxExportRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> Response:
    snapshot = build_scenario_docx_snapshot(db, story_id=story_id, expected=payload)
    buffer = render_scenario_docx(snapshot)
    fallback, utf8_name = safe_docx_filename(snapshot.title, story_id)
    return Response(
        content=buffer.getvalue(),
        media_type=DOCX_CONTENT_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{fallback}"; '
                f"filename*=UTF-8''{quote(utf8_name, safe='')}"
            ),
            "Cache-Control": "no-store",
        },
    )


@router.get("/{story_id}/scenario", response_model=ScenarioReadResponse)
def get_story_scenario(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ScenarioReadResponse:
    story, scenario, _workflow, _production = lock_story_aggregate(
        db,
        story_id=story_id,
    )
    rows = db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.scenario_id == scenario.id)
        .order_by(ScenarioRow.order_index.asc(), ScenarioRow.id.asc())
    ).scalars().all()
    edit = ScenarioEditState(state="archived" if story.archived_at is not None else "available")
    if story.archived_at is None:
        now = datetime.now(UTC)
        if expire_current_lease(db, scenario_id=scenario.id, now=now):
            db.commit()
        active_session = db.scalar(
            select(ScenarioEditSession)
            .where(ScenarioEditSession.scenario_id == scenario.id, ScenarioEditSession.ended_at.is_(None))
            .order_by(ScenarioEditSession.id.desc())
        )
        if active_session is not None:
            holder = db.get(User, active_session.actor_user_id)
            edit = ScenarioEditState(
                state="mine" if active_session.actor_user_id == current_user.id else "held",
                edit_session_id=active_session.id,
                holder=UserRef(
                    id=holder.id,
                    username=holder.username,
                    display_name=holder.display_name,
                    position=holder.position,
                    function_codes=holder.function_codes,
                ) if holder is not None else None,
                expires_at=active_session.expires_at,
            )
    read_model = get_story_read_model(db, story.id, current_user)
    assert read_model is not None
    rubric_order = {name: index for index, name in enumerate(DEFAULT_RUBRIC_NAMES)}
    rubrics = list(
        db.execute(select(Rubric).where(Rubric.is_active.is_(True))).scalars()
    )
    rubrics.sort(
        key=lambda item: (
            rubric_order.get(item.name, len(rubric_order)),
            item.name.casefold(),
            item.id,
        )
    )
    return ScenarioReadResponse(
        story=StoryListItem.model_validate(read_model),
        scenario=ScenarioReadModel(revision=scenario.revision_no, rows=[scenario_row_values(row) for row in rows]),
        edit=edit,
        metadata=ScenarioMetadataState(
            editable=can_update_story_metadata(current_user, story),
            rubrics=[RubricRef(id=item.id, name=item.name) for item in rubrics],
        ),
        captionpanels=(
            get_captionpanels_state(
                db,
                story_id=story.id,
                scenario=scenario,
                user_id=current_user.id,
            ).model_copy(update={"eligible": False})
            if story.archived_at is not None
            else get_captionpanels_state(
                db,
                story_id=story.id,
                scenario=scenario,
                user_id=current_user.id,
            )
        ),
    )


@router.post("/{story_id}/scenario/opened", response_model=CommandAck)
def mark_story_scenario_opened(
    story_id: int,
    payload: ScenarioOpenedRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    scenario = mark_scenario_opened(
        db,
        story_id=story_id,
        actor=current_user,
        context=payload.context,
        revision_no=payload.revision,
    )
    return CommandAck(
        changed_at=datetime.now(UTC),
        resource={"type": "scenario", "id": scenario.id},
    )


@router.post("/{story_id}/scenario/lease", response_model=AcquireScenarioLeaseResponse)
def acquire_scenario_lease(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AcquireScenarioLeaseResponse:
    _story, scenario = get_active_story_scenario(db, story_id=story_id)
    session, token = acquire_lease(db, scenario=scenario, actor=current_user)
    db.commit()
    return AcquireScenarioLeaseResponse(
        edit_session_id=session.id,
        lease_token=token,
        expires_at=session.expires_at,
        revision=scenario.revision_no,
    )


@router.post("/{story_id}/scenario/lease/heartbeat", response_model=LeaseHeartbeatResponse)
def heartbeat_scenario_lease(
    story_id: int,
    payload: LeaseHeartbeatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LeaseHeartbeatResponse:
    _story, scenario = get_active_story_scenario(db, story_id=story_id)
    session = heartbeat_lease(
        db,
        scenario=scenario,
        actor=current_user,
        edit_session_id=payload.edit_session_id,
        lease_token=payload.lease_token,
    )
    return LeaseHeartbeatResponse(expires_at=session.expires_at)


@router.delete("/{story_id}/scenario/lease", response_model=CommandAck)
def release_scenario_lease(
    story_id: int,
    payload: ReleaseScenarioLeaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    _story, scenario = get_active_story_scenario(db, story_id=story_id)
    release_lease(
        db,
        scenario=scenario,
        actor=current_user,
        edit_session_id=payload.edit_session_id,
        lease_token=payload.lease_token,
    )
    return CommandAck(changed_at=datetime.now(UTC), resource={"type": "scenario", "id": scenario.id})


@router.put("/{story_id}/scenario", response_model=SaveScenarioAck)
def save_story_scenario(
    story_id: int,
    payload: SaveScenarioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SaveScenarioAck:
    return save_scenario(db, story_id=story_id, actor=current_user, payload=payload)
