from __future__ import annotations

from datetime import UTC, datetime, timedelta
import secrets

from sqlalchemy import Select, select, update
from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.db.models import User, UserSession
from app.services.user_admin import change_user_password, set_user_password


def credential_user_lock_statement(
    *,
    user_id: int | None = None,
    username: str | None = None,
) -> Select[tuple[User]]:
    if (user_id is None) == (username is None):
        raise ValueError("Exactly one credential user lookup key is required")
    statement = select(User).execution_options(populate_existing=True)
    if user_id is not None:
        statement = statement.where(User.id == user_id)
    else:
        statement = statement.where(User.username == username)
    return statement.with_for_update()


def lock_user_for_credentials(
    db: Session,
    *,
    user_id: int | None = None,
    username: str | None = None,
) -> User | None:
    return db.execute(
        credential_user_lock_statement(user_id=user_id, username=username)
    ).scalar_one_or_none()


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = lock_user_for_credentials(db, username=username)
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


def revoke_user_sessions(
    db: Session,
    *,
    user_id: int,
    except_session_id: str | None = None,
) -> None:
    statement = update(UserSession).where(
        UserSession.user_id == user_id,
        UserSession.revoked_at.is_(None),
    )
    if except_session_id is not None:
        statement = statement.where(UserSession.id != except_session_id)
    db.execute(
        statement.values(revoked_at=datetime.now(UTC)),
        execution_options={"synchronize_session": False},
    )


__all__ = [
    "authenticate_user",
    "change_user_password",
    "create_user_session",
    "credential_user_lock_statement",
    "lock_user_for_credentials",
    "revoke_user_session",
    "revoke_user_sessions",
    "set_user_password",
]
