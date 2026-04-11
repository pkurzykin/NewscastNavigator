from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.editor import ScriptElementRow


class ProjectTextStateDiffRowItem(BaseModel):
    segment_uid: str
    change_types: list[str]
    changed_fields: list[str] = Field(default_factory=list)
    order_before: int | None = None
    order_after: int | None = None
    before_row: ScriptElementRow | None = None
    after_row: ScriptElementRow | None = None


class ProjectTextStateDiffSummary(BaseModel):
    added: int = 0
    removed: int = 0
    changed: int = 0
    moved: int = 0
    total: int = 0


class ProjectTextStateDiffHeaderItem(BaseModel):
    field: str
    before: str | None = None
    after: str | None = None


class ProjectTextStateDiffResponse(BaseModel):
    snapshot_kind: str
    snapshot_text_seq: int
    workspace_text_seq: int
    snapshot_created_at: datetime | None = None
    snapshot_created_by_user_id: int | None = None
    is_outdated: bool = False
    header_changes: list[ProjectTextStateDiffHeaderItem]
    row_changes: list[ProjectTextStateDiffRowItem]
    summary: ProjectTextStateDiffSummary
