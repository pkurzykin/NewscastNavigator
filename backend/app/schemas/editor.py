from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.project import ProjectListItem


class ScriptElementRow(BaseModel):
    id: int | None = None
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


class ProjectEditorPayload(BaseModel):
    project: ProjectListItem
    elements: list[ScriptElementRow]


class SaveScriptElementsRequest(BaseModel):
    rows: list[ScriptElementRow] = Field(default_factory=list)


class SaveScriptElementsResponse(BaseModel):
    ok: bool = True
    message: str
    updated: int
    inserted: int
    removed: int
    total: int
    elements: list[ScriptElementRow] = Field(default_factory=list)
