from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.scenario import (
    AcquireScenarioLeaseResponse,
    LeaseHeartbeatRequest,
    LeaseHeartbeatResponse,
    ReleaseScenarioLeaseRequest,
    SaveScenarioAck,
    SaveScenarioRequest,
)
from app.services.scenario_service import get_active_story_scenario, save_scenario
from app.services.scenario_sessions import acquire_lease, heartbeat_lease, release_lease


router = APIRouter(prefix="/api/v1/stories", tags=["scenario"])


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
