from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_functions
from app.db.models import User
from app.db.session import get_db
from app.schemas.admin import (
    AdminUserCreate,
    AdminUsersResponse,
    AdminUserUpdate,
    CommandAck,
    ResetPasswordRequest,
    ResourceRef,
)
from app.services.admin_user_queries import list_admin_users
from app.services.auth_service import revoke_user_sessions
from app.services.user_admin import (
    ensure_chief_invariant,
    normalize_function_codes,
    set_temporary_password,
    set_user_functions,
)


router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
require_chief = require_functions({"chief"})


def _error(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": code, "message": message})


def _get_user(db: Session, user_id: int) -> User:
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None:
        raise _error("USER_NOT_FOUND", "Пользователь не найден")
    return user


def _functions_or_error(function_codes: list[str]) -> tuple[str, ...]:
    try:
        return normalize_function_codes(function_codes)
    except ValueError as exc:
        raise _error("UNKNOWN_FUNCTION", "Указана неизвестная функция") from exc


@router.get("/users", response_model=AdminUsersResponse)
def get_users(
    db: Session = Depends(get_db),
    _chief: User = Depends(require_chief),
) -> AdminUsersResponse:
    return list_admin_users(db)


@router.post("/users", response_model=CommandAck)
def create_user(
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    _chief: User = Depends(require_chief),
) -> CommandAck:
    function_codes = _functions_or_error(payload.function_codes)
    user = User(
        username=payload.username.strip(),
        display_name=payload.display_name.strip(),
        position=payload.position.strip(),
        password_hash="",
        is_active=True,
        must_change_password=True,
    )
    set_user_functions(user, function_codes)
    db.add(user)
    try:
        db.flush()
        set_temporary_password(db, user, payload.temporary_password)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _error("USERNAME_TAKEN", "Логин уже используется") from exc
    except ValueError as exc:
        db.rollback()
        raise _error("UNSAFE_PASSWORD", str(exc)) from exc
    return CommandAck(changed_at=datetime.now(UTC), resource=ResourceRef(type="user", id=user.id))


@router.patch("/users/{user_id}", response_model=CommandAck)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    _chief: User = Depends(require_chief),
) -> CommandAck:
    if not payload.model_fields_set:
        raise _error("EMPTY_PATCH", "Нужно указать хотя бы одно изменение")
    user = _get_user(db, user_id)
    next_functions = (
        _functions_or_error(payload.function_codes)
        if payload.function_codes is not None
        else tuple(item.function_code for item in user.functions)
    )
    next_active = user.is_active if payload.is_active is None else payload.is_active
    try:
        ensure_chief_invariant(
            db,
            user,
            next_is_active=next_active,
            next_function_codes=next_functions,
        )
    except ValueError as exc:
        raise _error("LAST_CHIEF_REQUIRED", "Нельзя удалить последнего активного начальника") from exc
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.position is not None:
        user.position = payload.position.strip()
    if payload.function_codes is not None:
        set_user_functions(user, next_functions)
    if payload.is_active is not None:
        user.is_active = payload.is_active
        if payload.is_active is False:
            revoke_user_sessions(db, user_id=user.id)
    db.add(user)
    db.commit()
    return CommandAck(changed_at=datetime.now(UTC), resource=ResourceRef(type="user", id=user.id))


@router.post("/users/{user_id}/reset-password", response_model=CommandAck)
def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
    _chief: User = Depends(require_chief),
) -> CommandAck:
    user = _get_user(db, user_id)
    try:
        set_temporary_password(db, user, payload.temporary_password)
        revoke_user_sessions(db, user_id=user.id)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise _error("UNSAFE_PASSWORD", str(exc)) from exc
    return CommandAck(changed_at=datetime.now(UTC), resource=ResourceRef(type="user", id=user.id))
