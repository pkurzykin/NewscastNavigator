from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UserRef(BaseModel):
    id: int
    username: str
    display_name: str
    position: str
    function_codes: list[str]


class RubricRef(BaseModel):
    id: int
    name: str


class CodeLabel(BaseModel):
    code: str
    label: str


class AssignmentRef(BaseModel):
    kind: str
    user: UserRef


class StoryListItem(BaseModel):
    id: int
    title: str
    priority: CodeLabel
    rubric: RubricRef
    author: UserRef
    situation: CodeLabel
    assignments: list[AssignmentRef]
    created_at: datetime
    archived_at: datetime | None


class StoryListResponse(BaseModel):
    items: list[StoryListItem]
    total: int


class StoryListQuery(BaseModel):
    scope: Literal["active", "archive"] = "active"
    search: str | None = Field(default=None, max_length=255)
    rubric_id: int | None = Field(default=None, ge=1)
    priority: Literal["standard", "high"] | None = None
    area: Literal["scenario", "video", "titles", "voiceover", "external"] | None = None
    mine: bool = False
    limit: int = Field(default=50, ge=1, le=200)


class StoryMetadataPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    rubric_id: int | None = Field(default=None, ge=1)
