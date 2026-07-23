from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Scenario, ScenarioEditSession, ScenarioRow, User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.scenario import (
    AcquireScenarioLeaseResponse,
    LeaseHeartbeatRequest,
    LeaseHeartbeatResponse,
    ReleaseScenarioLeaseRequest,
    SaveScenarioAck,
    SaveScenarioRequest,
    ScenarioEditState,
    ScenarioReadModel,
    ScenarioOpenedRequest,
    ScenarioReadResponse,
)
from app.schemas.stories import StoryListItem, UserRef
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
    return ScenarioReadResponse(
        story=StoryListItem.model_validate(read_model),
        scenario=ScenarioReadModel(revision=scenario.revision_no, rows=[scenario_row_values(row) for row in rows]),
        edit=edit,
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
