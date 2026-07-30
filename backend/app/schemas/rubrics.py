from __future__ import annotations

from pydantic import BaseModel, Field


class RubricCreateRequest(BaseModel):
    name: str = Field(max_length=120)


class RubricPatchRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
