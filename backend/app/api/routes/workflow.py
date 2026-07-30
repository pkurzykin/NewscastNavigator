from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.workflow import WorkflowCommandRequest, WorkflowReadResponse
from app.services.workflow_service import get_workflow_read_model, run_workflow_command


router = APIRouter(prefix="/api/v1/stories", tags=["workflow"])


@router.get("/{story_id}/workflow", response_model=WorkflowReadResponse)
def get_story_workflow(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkflowReadResponse:
    return get_workflow_read_model(db, story_id=story_id, actor=current_user)


def _run(
    story_id: int,
    payload: WorkflowCommandRequest,
    command: str,
    db: Session,
    current_user: User,
) -> CommandAck:
    return run_workflow_command(
        db,
        story_id=story_id,
        actor=current_user,
        revision=payload.revision,
        command=command,
    )


@router.post("/{story_id}/workflow/submit-review", response_model=CommandAck)
def submit_review(story_id: int, payload: WorkflowCommandRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> CommandAck:
    return _run(story_id, payload, "submit-review", db, current_user)


@router.post("/{story_id}/workflow/confirm-editorial", response_model=CommandAck)
def confirm_editorial(story_id: int, payload: WorkflowCommandRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> CommandAck:
    return _run(story_id, payload, "confirm-editorial", db, current_user)


@router.post("/{story_id}/workflow/mark-proofread", response_model=CommandAck)
def mark_proofread(story_id: int, payload: WorkflowCommandRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> CommandAck:
    return _run(story_id, payload, "mark-proofread", db, current_user)


@router.post("/{story_id}/workflow/request-reproofread", response_model=CommandAck)
def request_reproofread(story_id: int, payload: WorkflowCommandRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> CommandAck:
    return _run(story_id, payload, "request-reproofread", db, current_user)
