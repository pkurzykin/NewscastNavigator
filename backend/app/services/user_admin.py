from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.db.models import User
from app.services.project_events import utcnow


MIN_PASSWORD_LENGTH = 12
COMMON_WEAK_PASSWORDS = {
    "admin",
    "admin123",
    "editor123",
    "author123",
    "proof123",
    "password",
    "password123",
    "qwerty123",
    "12345678",
    "123456789",
    "1234567890",
}


def validate_password_strength(raw_password: str, *, username: str | None = None) -> str:
    password = raw_password.strip()
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов")

    lowered = password.lower()
    if lowered in COMMON_WEAK_PASSWORDS:
        raise ValueError("Пароль слишком простой, выбери более надежное значение")

    normalized_username = (username or "").strip().lower()
    if normalized_username and lowered == normalized_username:
        raise ValueError("Пароль не должен совпадать с логином")

    return password


def set_user_password(db: Session, user: User, new_password: str) -> User:
    normalized_password = validate_password_strength(new_password, username=user.username)
    if verify_password(normalized_password, user.password_hash):
        raise ValueError("Новый пароль должен отличаться от текущего")

    user.password_hash = hash_password(normalized_password)
    user.must_change_password = False
    user.password_changed_at = utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def set_temporary_password(db: Session, user: User, temporary_password: str) -> User:
    normalized_password = validate_password_strength(temporary_password, username=user.username)
    user.password_hash = hash_password(normalized_password)
    user.must_change_password = True
    user.password_changed_at = None
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def change_user_password(
    db: Session,
    user: User,
    *,
    current_password: str,
    new_password: str,
) -> User:
    if not verify_password(current_password, user.password_hash):
        raise ValueError("Текущий пароль указан неверно")
    return set_user_password(db, user, new_password)


def set_user_active(db: Session, user: User, *, is_active: bool) -> User:
    if user.role == "admin" and user.is_active and not is_active:
        active_admins = db.scalar(
            select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True))
        ) or 0
        if active_admins <= 1:
            raise ValueError("Нельзя деактивировать последнего активного администратора")

    user.is_active = is_active
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
