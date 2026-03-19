from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


PROJECT_STATUS_VALUES = (
    "draft",
    "reviewed",
    "in_editing",
    "in_proofreading",
    "ready",
    "delivered",
    "archived",
)


class ProjectListItem(BaseModel):
    id: int
    title: str
    status: str
    rubric: str | None
    planned_duration: str | None
    source_project_id: int | None = None
    author_user_id: int | None = None
    author_username: str | None
    executor_user_id: int | None = None
    executor_user_ids: list[int] = Field(default_factory=list)
    executor_username: str | None = None
    proofreader_user_id: int | None = None
    proofreader_username: str | None = None
    archived_at: datetime | None = None
    archived_by_user_id: int | None = None
    archived_by_username: str | None = None
    status_changed_at: datetime | None = None
    status_changed_by_user_id: int | None = None
    created_at: datetime | None


class ProjectListResponse(BaseModel):
    items: list[ProjectListItem]
    total: int


class ProjectCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    rubric: str | None = Field(default=None, max_length=120)
    planned_duration: str | None = Field(default=None, max_length=32)


class UpdateProjectMetaRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    rubric: str | None = Field(default=None, max_length=120)
    planned_duration: str | None = Field(default=None, max_length=32)
    status: str | None = Field(default=None, max_length=32)
    author_user_id: int | None = Field(default=None, ge=1)
    executor_user_id: int | None = Field(default=None, ge=1)
    executor_user_ids: list[int] | None = None
    proofreader_user_id: int | None = Field(default=None, ge=1)


class ProjectActionResponse(BaseModel):
    ok: bool = True
    message: str
    project: ProjectListItem


class ProjectHistoryItem(BaseModel):
    id: int
    event_type: str
    old_value: str | None
    new_value: str | None
    actor_user_id: int | None
    actor_username: str
    created_at: datetime | None
    meta_json: str | None


class ProjectHistoryResponse(BaseModel):
    items: list[ProjectHistoryItem]
    total: int
