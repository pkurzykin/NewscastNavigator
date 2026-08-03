from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    BROWSER_SESSION_PURPOSE,
    CAPTIONPANELS_SESSION_PURPOSE,
    SessionTokenClaims,
    verify_session_token,
)
from app.core.config import get_settings
from app.db.models import User, UserSession
from app.db.session import get_db
from app.services.permissions import has_any_function


def _auth_required(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "AUTH_REQUIRED", "message": message},
    )


def _resolve_session_user(
    db: Session,
    claims: SessionTokenClaims | None,
    *,
    required_purpose: str,
) -> User:
    if claims is None or claims.purpose != required_purpose:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "AUTH_REQUIRED", "message": "Сессия недействительна или истекла"},
        )

    user_session = db.execute(
        select(UserSession).where(
            UserSession.id == claims.session_id,
            UserSession.user_id == claims.user_id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(UTC),
        )
    ).scalar_one_or_none()
    if user_session is None:
        raise _auth_required("Сессия недействительна или истекла")

    user = db.execute(select(User).where(User.id == claims.user_id)).scalar_one_or_none()
    if user is None or not user.is_active:
        raise _auth_required("Пользователь недоступен")
    return user


def get_authenticated_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    session_token = request.cookies.get(get_settings().session_cookie_name)
    if not session_token:
        raise _auth_required("Не передана сессионная cookie")
    return _resolve_session_user(
        db,
        verify_session_token(session_token),
        required_purpose=BROWSER_SESSION_PURPOSE,
    )


def get_browser_or_captionpanels_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    session_token = request.cookies.get(get_settings().session_cookie_name)
    if session_token:
        return _resolve_session_user(
            db,
            verify_session_token(session_token),
            required_purpose=BROWSER_SESSION_PURPOSE,
        )

    authorization = request.headers.get("Authorization", "")
    scheme, _, token = authorization.partition(" ")
    if request.headers.get("Origin") != "null" or scheme.casefold() != "bearer" or not token:
        raise _auth_required("Не передана сессионная cookie")
    return _resolve_session_user(
        db,
        verify_session_token(token.strip()),
        required_purpose=CAPTIONPANELS_SESSION_PURPOSE,
    )


def get_captionpanels_current_user(
    authenticated_user: User = Depends(get_browser_or_captionpanels_user),
) -> User:
    if authenticated_user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PASSWORD_CHANGE_REQUIRED",
                "message": "Сначала смените временный пароль",
            },
        )
    return authenticated_user


def get_current_user(
    authenticated_user: User = Depends(get_authenticated_user),
) -> User:
    if authenticated_user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PASSWORD_CHANGE_REQUIRED",
                "message": "Сначала смените временный пароль",
            },
        )
    return authenticated_user


def require_functions(function_codes: Iterable[str]) -> Callable[..., User]:
    allowed_functions = {code.strip() for code in function_codes if code.strip()}

    def _dependency(current_user: User = Depends(get_current_user)) -> User:
        if not has_any_function(current_user, allowed_functions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "FORBIDDEN", "message": "Недостаточно прав для выполнения операции"},
            )
        return current_user

    return _dependency
