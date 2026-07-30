from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_authenticated_user
from app.core.security import create_session_token, verify_session_token
from app.core.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.schemas.admin import CommandAck
from app.schemas.auth import ChangePasswordRequest, LoginRequest, LoginResponse, UserPublic
from app.services.auth_service import (
    authenticate_user,
    change_user_password,
    create_user_session,
    lock_user_for_credentials,
    revoke_user_session,
    revoke_user_sessions,
)


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
    user_session = create_user_session(
        db,
        user_id=user.id,
        ttl_seconds=settings.session_token_ttl_seconds,
    )
    db.commit()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=create_session_token(
            user.id,
            user_session.id,
            expires_at=user_session.expires_at,
        ),
        max_age=settings.session_token_ttl_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return LoginResponse(user=UserPublic.model_validate(user))


@router.get("/me", response_model=UserPublic)
def me(
    current_user: User = Depends(get_authenticated_user),
) -> UserPublic:
    return UserPublic.model_validate(current_user)


@router.post("/logout", response_model=CommandAck)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> CommandAck:
    session_token = request.cookies.get(get_settings().session_cookie_name)
    claims = verify_session_token(session_token or "")
    if claims is not None:
        revoke_user_session(
            db,
            user_id=claims.user_id,
            session_id=claims.session_id,
        )
        db.commit()
    response.delete_cookie(
        key=get_settings().session_cookie_name,
        path="/",
        httponly=True,
        secure=get_settings().session_cookie_secure,
        samesite="lax",
    )
    return CommandAck(changed_at=datetime.now(UTC))


@router.post("/change-password", response_model=CommandAck)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_authenticated_user),
    db: Session = Depends(get_db),
) -> CommandAck:
    session_token = request.cookies.get(get_settings().session_cookie_name)
    claims = verify_session_token(session_token or "")
    if claims is None or claims.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_REQUIRED", "message": "Сессия недействительна или истекла"},
        )
    locked_user = lock_user_for_credentials(db, user_id=current_user.id)
    if locked_user is None or not locked_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_REQUIRED", "message": "Сессия недействительна или истекла"},
        )
    try:
        change_user_password(
            db,
            locked_user,
            current_password=payload.current_password,
            new_password=payload.new_password,
        )
        revoke_user_sessions(
            db,
            user_id=current_user.id,
            except_session_id=claims.session_id,
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
