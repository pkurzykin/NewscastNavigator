from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class CaptionPanelsImportBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class CaptionPanelsImportMeta(CaptionPanelsImportBaseModel):
    title: str
    rubric: str


class CaptionPanelsImportSpeaker(CaptionPanelsImportBaseModel):
    id: str
    name: str
    job: str


class CaptionPanelsImportSegment(CaptionPanelsImportBaseModel):
    id: str
    type: str
    text: str
    speaker_id: str | None = Field(default=None, alias="speakerId", serialization_alias="speakerId")
    pin: str | None = None


class CaptionPanelsImportDocument(CaptionPanelsImportBaseModel):
    meta: CaptionPanelsImportMeta
    speakers: list[CaptionPanelsImportSpeaker] = Field(default_factory=list)
    segments: list[CaptionPanelsImportSegment] = Field(default_factory=list)
