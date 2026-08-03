from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _set_required_settings_env(
    monkeypatch: pytest.MonkeyPatch,
    *,
    ttl_seconds: int,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("CORS_ORIGINS", "http://127.0.0.1:5173")
    monkeypatch.setenv("SECRET_KEY", "synthetic-config-test-secret")
    monkeypatch.setenv("CAPTIONPANELS_TOKEN_TTL_SECONDS", str(ttl_seconds))


@pytest.mark.parametrize("ttl_seconds", [0, -1])
def test_captionpanels_token_ttl_must_be_positive(
    ttl_seconds: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_required_settings_env(monkeypatch, ttl_seconds=ttl_seconds)

    with pytest.raises(ValidationError) as captured:
        Settings(_env_file=None)

    assert any(
        error["loc"] == ("captionpanels_token_ttl_seconds",)
        for error in captured.value.errors()
    )


def test_captionpanels_token_ttl_accepts_one_second(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_required_settings_env(monkeypatch, ttl_seconds=1)

    settings = Settings(_env_file=None)

    assert settings.captionpanels_token_ttl_seconds == 1
