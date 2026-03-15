from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_session_token
from app.db.models import User
from app.db.session import get_db
from app.schemas.auth import LoginRequest, LoginResponse, UserPublic
from app.services.auth_service import authenticate_user


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user = authenticate_user(
        db=db,
        username=payload.username.strip(),
        password=payload.password,
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверные учетные данные",
        )
    return LoginResponse(
        access_token=create_session_token(user.id),
        user=UserPublic.model_validate(user),
    )


@router.get("/me", response_model=UserPublic)
def me(
    current_user: User = Depends(get_current_user),
) -> UserPublic:
    return UserPublic.model_validate(current_user)
