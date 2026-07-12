from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.stories import StoryListItem


class ScenarioEditorRow(BaseModel):
    id: int | None = None
    segment_uid: str | None = None
    order_index: int = 1
    block_type: str = Field(default="zk", max_length=32)
    text: str = ""
    speaker_text: str = ""
    file_name: str = ""
    tc_in: str = ""
    tc_out: str = ""
    additional_comment: str = ""
    structured_data: dict[str, Any] = Field(default_factory=dict)
    formatting: dict[str, Any] = Field(default_factory=dict)
    rich_text: dict[str, Any] = Field(default_factory=dict)


class StoryEditorPayload(BaseModel):
    story: StoryListItem
    elements: list[ScenarioEditorRow] = Field(default_factory=list)


class SaveScenarioRowsRequest(BaseModel):
    rows: list[ScenarioEditorRow] = Field(default_factory=list)


class SaveScenarioRowsResponse(StoryEditorPayload):
    ok: bool = True
    message: str
    updated: int
    inserted: int
    removed: int
    total: int
