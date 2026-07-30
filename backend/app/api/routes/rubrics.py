from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.rubrics import RubricCreateRequest, RubricPatchRequest
from app.services.rubric_service import create_rubric, update_rubric


router = APIRouter(prefix="/api/v1/rubrics", tags=["rubrics"])


@router.post("", response_model=CommandAck)
def post_rubric(
    payload: RubricCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return create_rubric(
        db,
        actor=current_user,
        name=payload.name,
    )


@router.patch("/{rubric_id}", response_model=CommandAck)
def patch_rubric(
    rubric_id: int,
    payload: RubricPatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return update_rubric(
        db,
        rubric_id=rubric_id,
        actor=current_user,
        name=payload.name,
        is_active=payload.is_active,
    )
