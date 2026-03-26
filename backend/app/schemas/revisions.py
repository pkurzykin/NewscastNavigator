from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.editor import ScriptElementRow


class ProjectRevisionItem(BaseModel):
    id: str
    project_id: int
    revision_no: int
    parent_revision_id: str | None = None
    branch_key: str
    revision_kind: str
    status: str
    title: str
    comment: str
    project_title: str
    project_rubric: str | None = None
    project_planned_duration: str | None = None
    created_by_user_id: int | None = None
    created_by_username: str | None = None
    created_at: datetime | None = None
    is_current: bool = False


class ProjectRevisionListResponse(BaseModel):
    items: list[ProjectRevisionItem]
    total: int


class CreateProjectRevisionRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    comment: str | None = Field(default=None, max_length=5000)
    branch_key: str | None = Field(default=None, max_length=64)
    parent_revision_id: str | None = Field(default=None, max_length=64)


class BranchProjectRevisionRequest(BaseModel):
    branch_key: str = Field(min_length=1, max_length=64)
    title: str | None = Field(default=None, max_length=255)
    comment: str | None = Field(default=None, max_length=5000)


class ProjectRevisionDetailResponse(BaseModel):
    revision: ProjectRevisionItem


class ProjectRevisionElementsResponse(BaseModel):
    revision: ProjectRevisionItem
    elements: list[ScriptElementRow]


class ProjectRevisionHeaderDiffItem(BaseModel):
    field: str
    before: str | None = None
    after: str | None = None


class ProjectRevisionRowDiffItem(BaseModel):
    segment_uid: str
    change_types: list[str]
    changed_fields: list[str] = Field(default_factory=list)
    order_before: int | None = None
    order_after: int | None = None
    before_row: ScriptElementRow | None = None
    after_row: ScriptElementRow | None = None


class ProjectRevisionDiffSummary(BaseModel):
    added: int = 0
    removed: int = 0
    changed: int = 0
    moved: int = 0
    total: int = 0


class ProjectRevisionDiffResponse(BaseModel):
    revision: ProjectRevisionItem
    against_revision: ProjectRevisionItem
    header_changes: list[ProjectRevisionHeaderDiffItem]
    row_changes: list[ProjectRevisionRowDiffItem]
    summary: ProjectRevisionDiffSummary


class ProjectRevisionActionResponse(BaseModel):
    ok: bool = True
    message: str
    revision: ProjectRevisionItem
