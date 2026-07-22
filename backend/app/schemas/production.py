from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ActionRef
from app.schemas.corrections import CorrectionSummaryRef
from app.schemas.stories import AssignmentRef, CodeLabel, RubricRef, UserRef


class AssignmentRequest(BaseModel):
    user_id: int = Field(ge=1)


class MaterialCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    location: str = Field(max_length=4096)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Название материала обязательно")
        return normalized


class EmptyProductionRequest(BaseModel):
    pass


class RevisionProductionRequest(BaseModel):
    revision: int = Field(ge=0)


class VoiceoverNotReadyRequest(BaseModel):
    description: str = Field(min_length=1, max_length=2000)
    assignee_user_id: int = Field(ge=1)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Описание правки обязательно")
        return normalized


class StoryHeader(BaseModel):
    id: int
    title: str
    priority: CodeLabel
    rubric: RubricRef
    author: UserRef
    situation: CodeLabel
    assignments: list[AssignmentRef]
    created_at: datetime
    aired_at: datetime | None
    archived_at: datetime | None
    primary_action: ActionRef | None
    additional_actions: list[ActionRef]


class MaterialRef(BaseModel):
    id: int
    title: str
    location: str
    added_by: UserRef
    added_at: datetime


class VoiceoverReadState(BaseModel):
    ready: bool
    ready_by: UserRef | None
    ready_at: datetime | None


class VideoReadState(BaseModel):
    started_by: UserRef | None
    started_at: datetime | None
    ready_by: UserRef | None
    ready_at: datetime | None
    approved_for_titles_by: UserRef | None
    approved_for_titles_at: datetime | None
    last_opened_revision: int | None
    has_unseen_scenario_changes: bool


class TitlesReadState(BaseModel):
    initial_gate_satisfied: bool
    started_by: UserRef | None
    started_at: datetime | None
    ready_by: UserRef | None
    ready_at: datetime | None
    accepted_by: UserRef | None
    accepted_at: datetime | None
    last_opened_revision: int | None
    has_unseen_scenario_changes: bool


class AiredRef(BaseModel):
    by: UserRef
    at: datetime


class ProductionStageRef(BaseModel):
    code: str
    state: str
    label: str
    summary: str


class ProductionReadResponse(BaseModel):
    story: StoryHeader
    scenario_revision: int
    assignments: list[AssignmentRef]
    assignee_options: list[UserRef]
    can_manage_assignments: bool
    materials: list[MaterialRef]
    corrections: CorrectionSummaryRef
    voiceover: VoiceoverReadState
    video: VideoReadState
    titles: TitlesReadState
    aired: AiredRef | None
    stages: list[ProductionStageRef]
    primary_action: ActionRef | None
    additional_actions: list[ActionRef]
