from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.corrections import (
    CompleteCorrectionPartRequest,
    CorrectionPackageCreateRequest,
    CorrectionPackagesResponse,
    EmptyCorrectionRequest,
    ReturnCorrectionPartRequest,
)
from app.services.correction_service import (
    CorrectionPartInput,
    close_correction_package,
    complete_correction_part,
    create_correction_package_command,
    get_correction_packages,
    return_correction_part,
)


router = APIRouter(prefix="/api/v1/stories", tags=["corrections"])


@router.get("/{story_id}/correction-packages", response_model=CorrectionPackagesResponse)
def get_story_correction_packages(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CorrectionPackagesResponse:
    return get_correction_packages(db, story_id=story_id, actor=current_user)


@router.post("/{story_id}/correction-packages", response_model=CommandAck)
def create_story_correction_package(
    story_id: int,
    payload: CorrectionPackageCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return create_correction_package_command(
        db,
        story_id=story_id,
        actor=current_user,
        source=payload.source,
        parts=[
            CorrectionPartInput(
                scope=part.scope,
                description=part.description,
                assignee_user_id=part.assignee_user_id,
            )
            for part in payload.parts
        ],
    )


@router.post(
    "/{story_id}/correction-packages/{package_id}/parts/{part_id}/complete",
    response_model=CommandAck,
)
def complete_story_correction_part(
    story_id: int,
    package_id: int,
    part_id: int,
    payload: CompleteCorrectionPartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return complete_correction_part(
        db,
        story_id=story_id,
        package_id=package_id,
        part_id=part_id,
        actor=current_user,
        completion_action=payload.completion_action,
    )


@router.post(
    "/{story_id}/correction-packages/{package_id}/parts/{part_id}/return",
    response_model=CommandAck,
)
def return_story_correction_part(
    story_id: int,
    package_id: int,
    part_id: int,
    payload: ReturnCorrectionPartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return return_correction_part(
        db,
        story_id=story_id,
        package_id=package_id,
        part_id=part_id,
        actor=current_user,
        reason=payload.reason,
    )


@router.post("/{story_id}/correction-packages/{package_id}/close", response_model=CommandAck)
def close_story_correction_package(
    story_id: int,
    package_id: int,
    _payload: EmptyCorrectionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return close_correction_package(
        db,
        story_id=story_id,
        package_id=package_id,
        actor=current_user,
    )
