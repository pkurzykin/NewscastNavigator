from __future__ import annotations

from datetime import UTC, datetime, timedelta
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.db.models import User, UserSession
from app.services.user_admin import change_user_password, set_user_password


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def create_user_session(
    db: Session,
    *,
    user_id: int,
    ttl_seconds: int,
) -> UserSession:
    now = datetime.now(UTC)
    user_session = UserSession(
        id=secrets.token_urlsafe(32),
        user_id=user_id,
        created_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
    )
    db.add(user_session)
    db.flush()
    return user_session


def revoke_user_session(
    db: Session,
    *,
    user_id: int,
    session_id: str,
) -> None:
    user_session = db.execute(
        select(UserSession).where(
            UserSession.id == session_id,
            UserSession.user_id == user_id,
        )
    ).scalar_one_or_none()
    if user_session is not None and user_session.revoked_at is None:
        user_session.revoked_at = datetime.now(UTC)
        db.add(user_session)


__all__ = [
    "authenticate_user",
    "change_user_password",
    "create_user_session",
    "revoke_user_session",
    "set_user_password",
]
