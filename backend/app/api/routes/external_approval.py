from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.external_approval import (
    EmptyExternalApprovalRequest,
    ExternalApprovalChangesRequestedRequest,
    ExternalApprovalCyclesResponse,
)
from app.services.correction_service import CorrectionPartInput
from app.services.external_approval_service import (
    get_external_approval_cycles,
    record_external_approval_result,
    send_external_approval,
)


router = APIRouter(
    prefix="/api/v1/stories/{story_id}/external-approval/cycles",
    tags=["external-approval"],
)


@router.get("", response_model=ExternalApprovalCyclesResponse)
def get_cycles(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ExternalApprovalCyclesResponse:
    return get_external_approval_cycles(db, story_id=story_id, actor=current_user)


@router.post("/send", response_model=CommandAck)
def send(
    story_id: int,
    _payload: EmptyExternalApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return send_external_approval(db, story_id=story_id, actor=current_user)


@router.post("/{cycle_id}/approved", response_model=CommandAck)
def record_approved(
    story_id: int,
    cycle_id: int,
    _payload: EmptyExternalApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return record_external_approval_result(
        db,
        story_id=story_id,
        cycle_id=cycle_id,
        actor=current_user,
        result="approved",
        parts=[],
    )


@router.post("/{cycle_id}/changes-requested", response_model=CommandAck)
def record_changes_requested(
    story_id: int,
    cycle_id: int,
    payload: ExternalApprovalChangesRequestedRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return record_external_approval_result(
        db,
        story_id=story_id,
        cycle_id=cycle_id,
        actor=current_user,
        result="changes_requested",
        parts=[
            CorrectionPartInput(
                scope=part.scope,
                description=part.description,
                assignee_user_id=part.assignee_user_id,
            )
            for part in payload.parts
        ],
    )
