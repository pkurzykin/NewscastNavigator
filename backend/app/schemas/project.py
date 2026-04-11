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

TITLES_STATUS_VALUES = (
    "not_started",
    "in_progress",
    "review",
    "changes_requested",
    "done",
)

EDIT_STATUS_VALUES = (
    "not_started",
    "in_progress",
    "review",
    "changes_requested",
    "done",
)

VOICEOVER_STATUS_VALUES = (
    "not_started",
    "in_progress",
    "review",
    "changes_requested",
    "done",
)

FINAL_REVIEW_STATUS_VALUES = (
    "not_started",
    "submitted",
    "changes_requested",
    "approved",
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
    text_seq: int = 0
    current_text_seq: int | None = None
    current_text_set_at: datetime | None = None
    current_text_set_by_user_id: int | None = None
    checked_text_seq: int | None = None
    checked_at: datetime | None = None
    checked_by_user_id: int | None = None
    proofread_text_seq: int | None = None
    proofread_at: datetime | None = None
    proofread_by_user_id: int | None = None
    current_text_is_latest: bool = False
    checked_text_is_current: bool = False
    proofread_text_is_current: bool = False
    latest_text_is_checked: bool = False
    latest_text_is_proofread: bool = False
    titles_status: str = "not_started"
    titles_text_seq: int | None = None
    titles_updated_at: datetime | None = None
    titles_updated_by_user_id: int | None = None
    titles_text_is_latest: bool = False
    titles_text_is_current: bool = False
    titles_text_is_proofread: bool = False
    titles_requires_resync: bool = False
    edit_status: str = "not_started"
    edit_text_seq: int | None = None
    edit_updated_at: datetime | None = None
    edit_updated_by_user_id: int | None = None
    edit_text_is_current: bool = False
    edit_text_is_latest: bool = False
    edit_requires_resync: bool = False
    voiceover_status: str = "not_started"
    voiceover_text_seq: int | None = None
    voiceover_updated_at: datetime | None = None
    voiceover_updated_by_user_id: int | None = None
    voiceover_text_is_latest: bool = False
    voiceover_text_is_current: bool = False
    voiceover_text_is_proofread: bool = False
    voiceover_requires_resync: bool = False
    final_review_status: str = "not_started"
    final_review_updated_at: datetime | None = None
    final_review_updated_by_user_id: int | None = None
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


class ProjectTextStateActionRequest(BaseModel):
    text_seq: int | None = Field(default=None, ge=1)


class ProjectTitlesTextSyncRequest(BaseModel):
    text_seq: int | None = Field(default=None, ge=1)


class ProjectTitlesStatusRequest(BaseModel):
    status: str = Field(min_length=1, max_length=32)


class ProjectEditTextSyncRequest(BaseModel):
    text_seq: int | None = Field(default=None, ge=1)


class ProjectEditStatusRequest(BaseModel):
    status: str = Field(min_length=1, max_length=32)


class ProjectVoiceoverTextSyncRequest(BaseModel):
    text_seq: int | None = Field(default=None, ge=1)


class ProjectVoiceoverStatusRequest(BaseModel):
    status: str = Field(min_length=1, max_length=32)


class ProjectFinalReviewStatusRequest(BaseModel):
    status: str = Field(min_length=1, max_length=32)


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
