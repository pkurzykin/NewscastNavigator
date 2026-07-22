from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import ActionRef
from app.schemas.stories import UserRef


CorrectionScope = Literal["text", "video", "titles", "voiceover"]
CompletionAction = Literal["none", "video_ready", "titles_ready"]


class CorrectionPartCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: str
    description: str = Field(min_length=1, max_length=2000)
    assignee_user_id: int = Field(ge=1)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Описание правки обязательно")
        return normalized


class CorrectionPackageCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["internal"]
    parts: list[CorrectionPartCreateRequest] = Field(default_factory=list)


class CompleteCorrectionPartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completion_action: CompletionAction


class ReturnCorrectionPartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = ""


class EmptyCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CorrectionActionRef(ActionRef):
    part_id: int | None = None
    part_scope: CorrectionScope | None = None


class CorrectionPartRef(BaseModel):
    id: int
    scope: CorrectionScope
    description: str
    assignee: UserRef
    state: Literal["pending", "done"]
    completed_by: UserRef | None
    completed_at: datetime | None


class CorrectionPackageRef(BaseModel):
    id: int
    source: Literal["internal", "external"]
    created_by: UserRef
    created_at: datetime
    parts: list[CorrectionPartRef]
    all_parts_complete: bool
    awaiting_leadership_review: bool
    closed_by: UserRef | None
    closed_at: datetime | None
    primary_action: CorrectionActionRef | None
    additional_actions: list[CorrectionActionRef]


class CorrectionPackagesResponse(BaseModel):
    story_id: int
    items: list[CorrectionPackageRef]
    assignee_options: list[UserRef]
    create_action: ActionRef | None


class CorrectionSummaryRef(BaseModel):
    href: str
    total_count: int
    open_count: int
    awaiting_leadership_review_count: int
