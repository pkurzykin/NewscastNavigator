from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password, is_legacy_bcrypt_hash, verify_password
from app.db.models import User


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    if is_legacy_bcrypt_hash(user.password_hash):
        user.password_hash = hash_password(password)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user
