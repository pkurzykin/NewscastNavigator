from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.domain.codes import SCENARIO_BLOCK_TYPES


class ScenarioRowInput(BaseModel):
    segment_uid: str = Field(min_length=5, max_length=64)
    order_index: int = Field(ge=1)
    block_type: str = Field(max_length=32)
    text: str = ""
    speaker_text: str = ""
    file_name: str = ""
    tc_in: str = ""
    tc_out: str = ""
    additional_comment: str = ""
    structured_data: dict[str, Any] = Field(default_factory=dict)
    formatting: dict[str, Any] = Field(default_factory=dict)
    rich_text: dict[str, Any] = Field(default_factory=dict)

    @field_validator("segment_uid")
    @classmethod
    def require_client_generated_segment_uid(cls, value: str) -> str:
        if not value.startswith("seg_"):
            raise ValueError("segment_uid должен начинаться с seg_")
        try:
            UUID(value.removeprefix("seg_"))
        except ValueError as exc:
            raise ValueError("segment_uid должен содержать UUID") from exc
        return value

    @field_validator("block_type")
    @classmethod
    def require_supported_block_type(cls, value: str) -> str:
        if value not in SCENARIO_BLOCK_TYPES:
            raise ValueError("block_type не поддерживается")
        return value


class AcquireScenarioLeaseResponse(BaseModel):
    edit_session_id: int
    lease_token: str
    expires_at: datetime
    revision: int


class LeaseHeartbeatRequest(BaseModel):
    edit_session_id: int
    lease_token: str = Field(min_length=1, max_length=256)


class LeaseHeartbeatResponse(BaseModel):
    ok: bool = True
    expires_at: datetime


class ReleaseScenarioLeaseRequest(LeaseHeartbeatRequest):
    pass


class SaveScenarioRequest(BaseModel):
    base_revision: int = Field(ge=0)
    client_save_id: str = Field(min_length=1, max_length=64)
    edit_session_id: int
    lease_token: str = Field(min_length=1, max_length=256)
    rows: list[ScenarioRowInput] = Field(default_factory=list)

    @field_validator("rows")
    @classmethod
    def require_unique_order_and_segment_uid(cls, rows: list[ScenarioRowInput]) -> list[ScenarioRowInput]:
        segment_uids = [row.segment_uid for row in rows]
        order_indexes = [row.order_index for row in rows]
        if len(segment_uids) != len(set(segment_uids)):
            raise ValueError("segment_uid не должен повторяться")
        if len(order_indexes) != len(set(order_indexes)):
            raise ValueError("order_index не должен повторяться")
        return rows


class SaveScenarioAck(BaseModel):
    ok: bool = True
    client_save_id: str
    revision: int
    saved_at: datetime
