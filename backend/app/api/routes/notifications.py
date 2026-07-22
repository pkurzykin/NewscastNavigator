from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.common import CommandAck
from app.schemas.notifications import (
    EmptyNotificationRequest,
    NotificationListResponse,
    PersonalActionListResponse,
)
from app.services.notification_service import (
    get_personal_actions,
    list_notifications,
    mark_notification_read,
)


router = APIRouter(prefix="/api/v1", tags=["notifications"])


@router.get("/me/actions", response_model=PersonalActionListResponse)
def get_my_actions(
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PersonalActionListResponse:
    return get_personal_actions(db, actor=current_user, limit=limit)


@router.get("/notifications", response_model=NotificationListResponse)
def get_notifications(
    unread: bool = True,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NotificationListResponse:
    return list_notifications(db, recipient=current_user, unread_only=unread, limit=limit)


@router.post("/notifications/{notification_id}/read", response_model=CommandAck)
def read_notification(
    notification_id: int,
    _payload: EmptyNotificationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommandAck:
    return mark_notification_read(
        db,
        notification_id=notification_id,
        recipient=current_user,
    )
