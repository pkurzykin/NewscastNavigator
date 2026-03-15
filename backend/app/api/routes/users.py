from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.user import UserListItem, UserListResponse


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
