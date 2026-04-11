from __future__ import annotations

from pydantic import BaseModel


class UserListItem(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    job_title: str | None = None
    role: str
    is_active: bool
    must_change_password: bool = False


class UserListResponse(BaseModel):
    items: list[UserListItem]
    total: int


class UserActivationRequest(BaseModel):
    is_active: bool


class UserActionResponse(BaseModel):
    ok: bool
    message: str
    user: UserListItem
