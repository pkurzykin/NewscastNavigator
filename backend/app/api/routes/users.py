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
    UserCreateRequest,
    UserListItem,
    UserListResponse,
    UserTemporaryPasswordRequest,
    UserTemporaryPasswordResponse,
    UserUpdateRequest,
)
from app.services.staff_import import generate_temporary_password
from app.services.user_admin import set_temporary_password, set_user_active


router = APIRouter(prefix="/api/v1/users", tags=["users"])


def _user_to_item(row: User) -> UserListItem:
    return UserListItem(
        id=row.id,
        username=row.username,
        full_name=row.full_name,
        job_title=row.job_title,
        role=row.role,
        is_active=row.is_active,
        must_change_password=row.must_change_password,
    )


@router.get("", response_model=UserListResponse)
def list_users(
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> UserListResponse:
    rows = db.execute(select(User).order_by(User.id.asc()).limit(limit)).scalars().all()
    items = [_user_to_item(row) for row in rows]
    return UserListResponse(items=items, total=len(items))


@router.post("", response_model=UserTemporaryPasswordResponse)
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(["admin"])),
) -> UserTemporaryPasswordResponse:
    username = (payload.username or "").strip()
    if not username:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Логин не может быть пустым",
        )
    existing = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с таким логином уже существует",
        )

    user = User(
        username=username,
        full_name=(payload.full_name or "").strip() or None,
        job_title=(payload.job_title or "").strip() or None,
        role=(payload.role or "").strip().lower() or "author",
        is_active=True,
        must_change_password=True,
        password_hash="",
    )
    db.add(user)
    db.flush()
    temporary_password = payload.temporary_password or generate_temporary_password()
    set_temporary_password(db, user, temporary_password)
    return UserTemporaryPasswordResponse(
        ok=True,
        message="Пользователь создан",
        user=_user_to_item(user),
        temporary_password=temporary_password,
    )


@router.put("/{user_id}", response_model=UserActionResponse)
def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(["admin"])),
) -> UserActionResponse:
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    if "full_name" in payload.model_fields_set:
        user.full_name = (payload.full_name or "").strip() or None
    if "job_title" in payload.model_fields_set:
        user.job_title = (payload.job_title or "").strip() or None
    if "role" in payload.model_fields_set:
        next_role = (payload.role or "").strip().lower()
        if not next_role:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Роль не может быть пустой",
            )
        user.role = next_role
    db.add(user)
    db.commit()
    db.refresh(user)

    if payload.is_active is not None and payload.is_active != user.is_active:
        try:
            user = set_user_active(db, user, is_active=payload.is_active)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

    return UserActionResponse(
        ok=True,
        message="Пользователь обновлен",
        user=_user_to_item(user),
    )


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
        user=_user_to_item(updated_user),
    )


@router.post("/{user_id}/temporary-password", response_model=UserTemporaryPasswordResponse)
def reset_user_temporary_password(
    user_id: int,
    payload: UserTemporaryPasswordRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(["admin"])),
) -> UserTemporaryPasswordResponse:
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    temporary_password = payload.temporary_password or generate_temporary_password()
    try:
        updated_user = set_temporary_password(db, user, temporary_password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return UserTemporaryPasswordResponse(
        ok=True,
        message="Временный пароль обновлен",
        user=_user_to_item(updated_user),
        temporary_password=temporary_password,
    )
