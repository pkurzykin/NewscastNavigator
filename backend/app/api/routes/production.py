from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.production import (
    AssignmentRequest,
    EmptyProductionRequest,
    MaterialCreateRequest,
    ProductionReadResponse,
    RevisionProductionRequest,
    VoiceoverNotReadyRequest,
)
from app.services.production_service import (
    add_material,
    delete_assignment,
    get_production_read_model,
    run_production_command,
    set_assignment,
)


router = APIRouter(prefix="/api/v1/stories", tags=["production"])


@router.get("/{story_id}/production", response_model=ProductionReadResponse)
def get_story_production(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProductionReadResponse:
    return get_production_read_model(db, story_id=story_id, actor=current_user)


@router.put("/{story_id}/assignments/{kind}", response_model=CommandAck)
def put_story_assignment(
    story_id: int,
    kind: str,
    payload: AssignmentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return set_assignment(
        db,
        story_id=story_id,
        actor=current_user,
        kind=kind,
        user_id=payload.user_id,
    )


@router.delete("/{story_id}/assignments/{kind}", response_model=CommandAck)
def remove_story_assignment(
    story_id: int,
    kind: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return delete_assignment(
        db,
        story_id=story_id,
        actor=current_user,
        kind=kind,
    )


@router.post("/{story_id}/materials", response_model=CommandAck)
def create_story_material(
    story_id: int,
    payload: MaterialCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return add_material(
        db,
        story_id=story_id,
        actor=current_user,
        title=payload.title,
        location=payload.location,
    )


def _empty_command(
    story_id: int,
    _payload: EmptyProductionRequest,
    command: str,
    db: Session,
    current_user: User,
) -> CommandAck:
    return run_production_command(
        db,
        story_id=story_id,
        actor=current_user,
        command=command,
    )


@router.post("/{story_id}/production/voiceover/ready", response_model=CommandAck)
def mark_voiceover_ready(
    story_id: int,
    payload: EmptyProductionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return _empty_command(story_id, payload, "voiceover-ready", db, current_user)


@router.post("/{story_id}/production/voiceover/not-ready", response_model=CommandAck)
def mark_voiceover_not_ready(
    story_id: int,
    payload: VoiceoverNotReadyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return run_production_command(
        db,
        story_id=story_id,
        actor=current_user,
        command="voiceover-not-ready",
        description=payload.description,
        assignee_user_id=payload.assignee_user_id,
    )


@router.post("/{story_id}/production/video/start", response_model=CommandAck)
def start_video(
    story_id: int,
    payload: RevisionProductionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return run_production_command(
        db,
        story_id=story_id,
        actor=current_user,
        command="video-start",
        revision=payload.revision,
    )


@router.post("/{story_id}/production/video/ready", response_model=CommandAck)
def mark_video_ready(
    story_id: int,
    payload: EmptyProductionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return _empty_command(story_id, payload, "video-ready", db, current_user)


@router.post("/{story_id}/production/video/approve-for-titles", response_model=CommandAck)
def approve_video_for_titles(
    story_id: int,
    payload: EmptyProductionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return _empty_command(story_id, payload, "video-approve-for-titles", db, current_user)


@router.post("/{story_id}/production/titles/start", response_model=CommandAck)
def start_titles(
    story_id: int,
    payload: RevisionProductionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return run_production_command(
        db,
        story_id=story_id,
        actor=current_user,
        command="titles-start",
        revision=payload.revision,
    )


@router.post("/{story_id}/production/titles/ready", response_model=CommandAck)
def mark_titles_ready(
    story_id: int,
    payload: EmptyProductionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return _empty_command(story_id, payload, "titles-ready", db, current_user)


@router.post("/{story_id}/production/titles/accept", response_model=CommandAck)
def accept_titles(
    story_id: int,
    payload: EmptyProductionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return _empty_command(story_id, payload, "titles-accept", db, current_user)
