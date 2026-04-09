from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.models import User
from app.db.session import get_db
from app.schemas.user import (
    UserActionResponse,
    UserActivationRequest,
    UserListItem,
    UserListResponse,
)
from app.services.user_admin import set_user_active


router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get("", response_model=UserListResponse)
def list_users(
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> UserListResponse:
    rows = db.execute(select(User).order_by(User.id.asc()).limit(limit)).scalars().all()
    items = [
        UserListItem(
            id=row.id,
            username=row.username,
            role=row.role,
            is_active=row.is_active,
        )
        for row in rows
    ]
    return UserListResponse(items=items, total=len(items))


@router.post("/{user_id}/activation", response_model=UserActionResponse)
def update_user_activation(
    user_id: int,
    payload: UserActivationRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(["admin"])),
) -> UserActionResponse:
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    try:
        updated_user = set_user_active(db, user, is_active=payload.is_active)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return UserActionResponse(
        ok=True,
        message="Пользователь обновлен",
        user=UserListItem(
            id=updated_user.id,
            username=updated_user.username,
            role=updated_user.role,
            is_active=updated_user.is_active,
        ),
    )
