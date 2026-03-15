from __future__ import annotations

from pydantic import BaseModel


class UserListItem(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool


class UserListResponse(BaseModel):
    items: list[UserListItem]
    total: int
