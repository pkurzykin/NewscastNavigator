from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.common import ActionRef
from app.schemas.stories import StoryListItem, UserRef


class ScenarioDiffSummary(BaseModel):
    added: int = 0
    removed: int = 0
    changed: int = 0
    moved: int = 0
    total: int = 0


class EditSessionHistoryItem(BaseModel):
    kind: Literal["edit_session"] = "edit_session"
    id: int
    actor: UserRef
    started_at: datetime
    ended_at: datetime
    from_revision: int
    to_revision: int
    diff_summary: ScenarioDiffSummary
    diff_href: str
    available_actions: list[ActionRef] = Field(default_factory=list)


class WorkflowEventHistoryItem(BaseModel):
    kind: Literal["workflow_event"] = "workflow_event"
    id: int
    event_code: str
    label: str
    summary: str | None = None
    actor: UserRef | None
    at: datetime
    diff_href: str | None = None
    available_actions: list[ActionRef] = Field(default_factory=list)


class StoryHistoryResponse(BaseModel):
    story: StoryListItem
    items: list[EditSessionHistoryItem | WorkflowEventHistoryItem]
    next_cursor: str | None = None


class ScenarioRowDiff(BaseModel):
    segment_uid: str
    kind: Literal["added", "removed", "changed", "moved"]
    moved: bool = False
    changed_fields: list[str] = Field(default_factory=list)
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None


class ScenarioSessionDiffResponse(BaseModel):
    story: StoryListItem
    session: EditSessionHistoryItem
    changes: list[ScenarioRowDiff]
