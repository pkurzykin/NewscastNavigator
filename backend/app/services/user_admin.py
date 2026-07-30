from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.db.models import User, UserFunction
from app.domain.codes import FUNCTION_CODES


MIN_PASSWORD_LENGTH = 12
CHIEF_INVARIANT_LOCK_KEY = 5_642_816_703_216_324_676
IDENTITY_FIELD_CONTRACTS = {
    "username": ("Логин", 120),
    "display_name": ("Отображаемое имя", 255),
    "position": ("Должность", 120),
}
COMMON_WEAK_PASSWORDS = {
    "admin",
    "admin123",
    "password",
    "password123",
    "password12345",
    "qwerty123",
    "12345678",
    "123456789",
    "1234567890",
    "synthetic-demo-2026!",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


def normalize_identity_value(value: object, *, field_name: str) -> str:
    if field_name not in IDENTITY_FIELD_CONTRACTS:
        raise ValueError("Неизвестное поле пользователя")
    label, max_length = IDENTITY_FIELD_CONTRACTS[field_name]
    if not isinstance(value, str):
        raise ValueError(f"{label} должен быть строкой")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{label} не может быть пустым")
    if len(normalized) > max_length:
        raise ValueError(f"{label} не может быть длиннее {max_length} символов")
    return normalized


def validate_password_strength(raw_password: str, *, username: str | None = None) -> str:
    password_for_checks = raw_password.strip()
    if len(password_for_checks) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов")
    lowered = password_for_checks.casefold()
    if lowered in COMMON_WEAK_PASSWORDS:
        raise ValueError("Пароль слишком простой, выбери более надежное значение")
    if username and lowered == username.strip().casefold():
        raise ValueError("Пароль не должен совпадать с логином")
    return raw_password


def normalize_function_codes(function_codes: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    normalized = tuple(sorted({code.strip() for code in function_codes if code.strip()}))
    unknown = sorted(set(normalized) - FUNCTION_CODES)
    if unknown:
        raise ValueError("UNKNOWN_FUNCTION:" + ",".join(unknown))
    if not normalized:
        raise ValueError("UNKNOWN_FUNCTION:at least one function is required")
    return normalized


def set_user_functions(user: User, function_codes: list[str] | tuple[str, ...]) -> None:
    normalized = normalize_function_codes(function_codes)
    user.functions = [UserFunction(function_code=code) for code in normalized]


def _active_chief_count(db: Session, *, excluding_user_id: int | None = None) -> int:
    query = (
        select(func.count(func.distinct(User.id)))
        .join(UserFunction, UserFunction.user_id == User.id)
        .where(User.is_active.is_(True), UserFunction.function_code == "chief")
    )
    if excluding_user_id is not None:
        query = query.where(User.id != excluding_user_id)
    return int(db.scalar(query) or 0)


def _serialize_chief_invariant(db: Session) -> None:
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        db.scalar(select(func.pg_advisory_xact_lock(CHIEF_INVARIANT_LOCK_KEY)))
        return
    if bind.dialect.name == "sqlite":
        return
    raise RuntimeError("Инвариант начальника поддерживается только в PostgreSQL")


def ensure_chief_invariant(
    db: Session,
    user: User,
    *,
    next_is_active: bool,
    next_function_codes: tuple[str, ...],
) -> None:
    currently_chief = "chief" in {item.function_code for item in user.functions}
    remains_active_chief = next_is_active and "chief" in next_function_codes
    if user.is_active and currently_chief and not remains_active_chief:
        _serialize_chief_invariant(db)
        if _active_chief_count(db, excluding_user_id=user.id) == 0:
            raise ValueError("LAST_CHIEF_REQUIRED")


def set_user_password(db: Session, user: User, new_password: str) -> User:
    normalized_password = validate_password_strength(new_password, username=user.username)
    if user.password_hash and verify_password(normalized_password, user.password_hash):
        raise ValueError("Новый пароль должен отличаться от текущего")
    user.password_hash = hash_password(normalized_password)
    user.must_change_password = False
    user.password_changed_at = utcnow()
    db.add(user)
    db.flush()
    return user


def set_temporary_password(db: Session, user: User, temporary_password: str) -> User:
    normalized_password = validate_password_strength(temporary_password, username=user.username)
    user.password_hash = hash_password(normalized_password)
    user.must_change_password = True
    user.password_changed_at = None
    db.add(user)
    db.flush()
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
    current_functions = tuple(item.function_code for item in user.functions)
    ensure_chief_invariant(
        db,
        user,
        next_is_active=is_active,
        next_function_codes=current_functions,
    )
    user.is_active = is_active
    db.add(user)
    db.flush()
    return user
