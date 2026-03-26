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


class ProjectRevisionDetailResponse(BaseModel):
    revision: ProjectRevisionItem


class ProjectRevisionElementsResponse(BaseModel):
    revision: ProjectRevisionItem
    elements: list[ScriptElementRow]


class ProjectRevisionActionResponse(BaseModel):
    ok: bool = True
    message: str
    revision: ProjectRevisionItem
