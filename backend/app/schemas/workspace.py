from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.project import ProjectListItem


class ProjectWorkspaceMeta(BaseModel):
    file_root: str = ""
    file_roots: list[str] = Field(default_factory=list)
    project_note: str = ""


class ProjectCommentItem(BaseModel):
    id: int
    target_kind: str
    requires_action: bool
    is_resolved: bool
    assignee_user_id: int | None = None
    assignee_username: str | None = None
    taken_in_work_at: datetime | None = None
    taken_in_work_by_user_id: int | None = None
    taken_in_work_by_username: str | None = None
    created_text_snapshot_kind: str | None = None
    created_text_seq: int | None = None
    created_revision_id: str | None = None
    created_revision_no: int | None = None
    resolved_at: datetime | None
    resolved_text_snapshot_kind: str | None = None
    resolved_text_seq: int | None = None
    resolved_revision_id: str | None = None
    resolved_revision_no: int | None = None
    text: str
    created_at: datetime | None
    author_user_id: int | None
    author_username: str


class ProjectFileItem(BaseModel):
    id: int
    original_name: str
    mime_type: str
    file_size: int
    uploaded_at: datetime | None
    uploaded_by_user_id: int | None
    uploaded_by_username: str
    exists_on_disk: bool


class ProjectMaterialLinkItem(BaseModel):
    id: int
    link_type: str
    path: str
    comment: str
    created_at: datetime | None
    updated_at: datetime | None
    added_by_user_id: int | None
    added_by_username: str


class ProjectWorkspacePayload(BaseModel):
    project: ProjectListItem
    workspace: ProjectWorkspaceMeta
    comments: list[ProjectCommentItem]
    material_links: list[ProjectMaterialLinkItem]
    files: list[ProjectFileItem]


class UpdateWorkspaceRequest(BaseModel):
    file_root: str = Field(default="", max_length=512)
    file_roots: list[str] = Field(default_factory=list, max_length=24)
    project_note: str = Field(default="", max_length=20000)


class WorkspaceActionResponse(BaseModel):
    ok: bool = True
    message: str


class AddProjectCommentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    target_kind: str = Field(default="general", min_length=1, max_length=32)
    requires_action: bool = False
    assignee_user_id: int | None = Field(default=None, ge=1)


class ResolveProjectCommentRequest(BaseModel):
    is_resolved: bool = True


class UpdateProjectCommentWorkflowRequest(BaseModel):
    assignee_user_id: int | None = Field(default=None, ge=1)
    clear_assignee: bool = False
    taken_in_work: bool | None = None


class ProjectMaterialLinkUpsertRequest(BaseModel):
    link_type: str = Field(min_length=1, max_length=32)
    path: str = Field(min_length=1, max_length=1024)
    comment: str = Field(default="", max_length=4000)
