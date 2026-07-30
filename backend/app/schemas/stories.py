from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ActionRef


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


class StoryManagementState(BaseModel):
    action: ActionRef
    author_options: list[UserRef]
    priority_options: list[CodeLabel]


class StoryListItem(BaseModel):
    id: int
    title: str
    priority: CodeLabel
    rubric: RubricRef
    author: UserRef
    situation: CodeLabel
    assignments: list[AssignmentRef]
    created_at: datetime
    updated_at: datetime
    aired_at: datetime | None
    archived_at: datetime | None
    lifecycle_actions: list[ActionRef] = Field(default_factory=list)
    management: StoryManagementState | None = None


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


class StoryManagementPatch(BaseModel):
    author_user_id: int | None = Field(default=None, ge=1)
    priority: str | None = Field(default=None, max_length=16)


class StoryCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    rubric_id: int = Field(ge=1)
    author_user_id: int | None = Field(default=None, ge=1)
    priority: Literal["standard", "high"] = "standard"


class RubricManagementItem(BaseModel):
    id: int
    name: str
    is_active: bool
    update_action: ActionRef


class RubricManagementState(BaseModel):
    items: list[RubricManagementItem]
    create_action: ActionRef


class StoryCreateOptionsResponse(BaseModel):
    rubrics: list[RubricRef]
    authors: list[UserRef]
    priority_options: list[CodeLabel]
    create_action: ActionRef | None
    rubric_management: RubricManagementState | None = None
