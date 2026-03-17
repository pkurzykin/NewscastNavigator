from __future__ import annotations

import json
from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Newscast Navigator API"
    environment: str = "development"
    database_url: str = Field(validation_alias="DATABASE_URL")
    cors_origins: str = Field(validation_alias="CORS_ORIGINS")
    seed_demo_data: bool = False
    session_secret: str = Field(
        validation_alias=AliasChoices("SECRET_KEY", "SESSION_SECRET")
    )
    session_token_ttl_seconds: int = 7 * 24 * 60 * 60
    storage_root: str = Field(
        validation_alias=AliasChoices("STORAGE_PATH", "STORAGE_ROOT")
    )
    export_root: str = Field(
        validation_alias=AliasChoices("EXPORT_PATH", "EXPORT_ROOT")
    )
    max_upload_size_mb: int = 512
    allowed_upload_extensions: str = (
        ".mp4,.mov,.mxf,.mp3,.wav,.m4a,.aac,.jpg,.jpeg,.png,.webp,.pdf,.docx,.txt"
    )

    @property
    def cors_origins_list(self) -> list[str]:
        raw_value = (self.cors_origins or "").strip()
        if not raw_value:
            return []

        if raw_value.startswith("["):
            try:
                decoded = json.loads(raw_value)
                if isinstance(decoded, list):
                    return [str(item).strip() for item in decoded if str(item).strip()]
            except Exception:
                pass

        return [item.strip() for item in raw_value.split(",") if item.strip()]

    @property
    def allowed_upload_extensions_set(self) -> set[str]:
        return {
            item.strip().lower()
            for item in (self.allowed_upload_extensions or "").split(",")
            if item.strip()
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
