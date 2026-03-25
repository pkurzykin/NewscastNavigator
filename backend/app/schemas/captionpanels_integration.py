from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CaptionPanelsIntegrationBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class CaptionPanelsProjectChoice(CaptionPanelsIntegrationBaseModel):
    project_id: int = Field(serialization_alias="projectId")
    story_uid: str = Field(serialization_alias="storyUid")
    title: str
    rubric: str | None = None
    planned_duration: str | None = Field(default=None, serialization_alias="plannedDuration")
    status: str
    author_username: str | None = Field(default=None, serialization_alias="authorUsername")
    segment_count: int = Field(default=0, serialization_alias="segmentCount")
    sync_segment_count: int = Field(default=0, serialization_alias="syncSegmentCount")
    created_at: datetime | None = Field(default=None, serialization_alias="createdAt")
    status_changed_at: datetime | None = Field(default=None, serialization_alias="statusChangedAt")


class CaptionPanelsProjectChoiceListResponse(CaptionPanelsIntegrationBaseModel):
    items: list[CaptionPanelsProjectChoice] = Field(default_factory=list)
    total: int = 0
