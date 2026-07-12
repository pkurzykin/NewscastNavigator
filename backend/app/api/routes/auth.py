from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_session_token
from app.core.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.schemas.admin import CommandAck
from app.schemas.auth import ChangePasswordRequest, LoginRequest, LoginResponse, UserPublic
from app.services.auth_service import authenticate_user, change_user_password


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> LoginResponse:
    user = authenticate_user(
        db=db,
        username=payload.username.strip(),
        password=payload.password,
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_REQUIRED", "message": "Неверные учетные данные"},
        )
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=create_session_token(user.id),
        max_age=settings.session_token_ttl_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return LoginResponse(user=UserPublic.model_validate(user))


@router.get("/me", response_model=UserPublic)
def me(
    current_user: User = Depends(get_current_user),
) -> UserPublic:
    return UserPublic.model_validate(current_user)


@router.post("/change-password", response_model=CommandAck)
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CommandAck:
    try:
        change_user_password(
            db,
            current_user,
            current_password=payload.current_password,
            new_password=payload.new_password,
        )
    except ValueError as exc:
        message = str(exc)
        code = (
            "CURRENT_PASSWORD_INVALID"
            if message == "Текущий пароль указан неверно"
            else "UNSAFE_PASSWORD"
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": code, "message": message},
        ) from exc

    db.commit()
    return CommandAck(changed_at=datetime.now(UTC))
