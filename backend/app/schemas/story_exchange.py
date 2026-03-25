from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class StoryExchangeBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class StoryExchangeSource(StoryExchangeBaseModel):
    system: str
    version: str


class StoryExchangeProject(StoryExchangeBaseModel):
    id: int
    title: str
    rubric: str
    planned_duration: str = Field(serialization_alias="plannedDuration")
    status: str


class StoryExchangeSpeaker(StoryExchangeBaseModel):
    speaker_id: str = Field(serialization_alias="speakerId")
    name: str
    job: str


class StoryExchangeSegmentFile(StoryExchangeBaseModel):
    name: str
    tc_in: str = Field(serialization_alias="tcIn")
    tc_out: str = Field(serialization_alias="tcOut")


class StoryExchangeSegmentNotes(StoryExchangeBaseModel):
    on_screen: str = Field(serialization_alias="onScreen")


class StoryExchangeSegment(StoryExchangeBaseModel):
    segment_uid: str = Field(serialization_alias="segmentUid")
    order: int
    block_type: str = Field(serialization_alias="blockType")
    semantic_type: str = Field(serialization_alias="semanticType")
    text: str
    text_lines: list[str] = Field(default_factory=list, serialization_alias="textLines")
    geo: str | None = None
    speaker_id: str | None = Field(default=None, serialization_alias="speakerId")
    file: StoryExchangeSegmentFile
    notes: StoryExchangeSegmentNotes


class StoryExchangeDocument(StoryExchangeBaseModel):
    schema_version: int = Field(serialization_alias="schemaVersion")
    story_uid: str = Field(serialization_alias="storyUid")
    generated_at: str = Field(serialization_alias="generatedAt")
    source: StoryExchangeSource
    project: StoryExchangeProject
    speakers: list[StoryExchangeSpeaker] = Field(default_factory=list)
    segments: list[StoryExchangeSegment] = Field(default_factory=list)
