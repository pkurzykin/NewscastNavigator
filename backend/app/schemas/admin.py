from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.schemas.stories import CodeLabel
from app.services.user_admin import normalize_identity_value


class AdminUserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=255)
    position: str = Field(min_length=1, max_length=120)
    function_codes: list[str] = Field(min_length=1)
    temporary_password: str = Field(min_length=12, max_length=255)

    @field_validator("username", "display_name", "position", mode="before")
    @classmethod
    def normalize_identity(cls, value: object, info: ValidationInfo) -> str:
        return normalize_identity_value(value, field_name=info.field_name)


class AdminUserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=120)
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    position: str | None = Field(default=None, min_length=1, max_length=120)
    function_codes: list[str] | None = None
    is_active: bool | None = None

    @field_validator("username", "display_name", "position", mode="before")
    @classmethod
    def normalize_identity(cls, value: object, info: ValidationInfo) -> str | None:
        if value is None:
            return None
        return normalize_identity_value(value, field_name=info.field_name)


class AdminUserItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    position: str
    function_codes: list[str]
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime


class AdminUsersResponse(BaseModel):
    items: list[AdminUserItem]
    function_options: list[CodeLabel]


class ResetPasswordRequest(BaseModel):
    temporary_password: str = Field(min_length=12, max_length=255)


class ResourceRef(BaseModel):
    type: str
    id: int


class CommandAck(BaseModel):
    ok: bool = True
    event_id: str | None = None
    changed_at: datetime
    resource: ResourceRef | None = None
