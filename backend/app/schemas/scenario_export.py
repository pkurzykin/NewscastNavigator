from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.domain.story_titles import normalize_story_title


class ScenarioDocxExportRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    expected_title: str = Field(min_length=1, max_length=255)
    expected_rubric_id: int | None = Field(default=None, ge=1)
    expected_duration_text: str | None = Field(default=None, max_length=64)

    @field_validator("expected_title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = normalize_story_title(value)
        if not normalized:
            raise ValueError("expected_title не может быть пустым")
        return normalized

    @field_validator("expected_duration_text")
    @classmethod
    def normalize_duration(cls, value: str | None) -> str | None:
        normalized = value.strip() if value is not None else ""
        return normalized or None
