from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize("ttl_seconds", [0, -1])
def test_captionpanels_token_ttl_must_be_positive(
    ttl_seconds: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("CORS_ORIGINS", "null")
    monkeypatch.setenv("SECRET_KEY", "synthetic-config-test-secret")
    monkeypatch.setenv("CAPTIONPANELS_TOKEN_TTL_SECONDS", str(ttl_seconds))

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
