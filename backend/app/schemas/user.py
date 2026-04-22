from __future__ import annotations

from pydantic import BaseModel, Field


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


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    full_name: str | None = Field(default=None, max_length=255)
    job_title: str | None = Field(default=None, max_length=120)
    role: str = Field(min_length=1, max_length=32)
    temporary_password: str | None = Field(default=None, max_length=255)


class UserUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    job_title: str | None = Field(default=None, max_length=120)
    role: str | None = Field(default=None, max_length=32)
    is_active: bool | None = None


class UserTemporaryPasswordRequest(BaseModel):
    temporary_password: str | None = Field(default=None, max_length=255)


class UserTemporaryPasswordResponse(BaseModel):
    ok: bool
    message: str
    user: UserListItem
    temporary_password: str


class UserActionResponse(BaseModel):
    ok: bool
    message: str
    user: UserListItem
