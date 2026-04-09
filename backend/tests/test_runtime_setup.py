from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.runtime_setup import (
    UnsafeRuntimeConfigurationError,
    _validate_runtime_settings,
)


def _build_settings(**overrides: object) -> SimpleNamespace:
    base: dict[str, object] = dict(
        environment="production",
        database_url="postgresql+psycopg://newscast:strong-db-password@db:5432/newscast",
        seed_demo_data=False,
        session_secret="strong-production-session-secret-123456",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_validate_runtime_settings_allows_safe_production_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(),
    )

    _validate_runtime_settings()


def test_validate_runtime_settings_rejects_demo_seed_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(seed_demo_data=True),
    )

    with pytest.raises(UnsafeRuntimeConfigurationError, match="SEED_DEMO_DATA"):
        _validate_runtime_settings()


def test_validate_runtime_settings_rejects_placeholder_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(session_secret="change-this-session-secret"),
    )

    with pytest.raises(UnsafeRuntimeConfigurationError, match="SECRET_KEY/SESSION_SECRET"):
        _validate_runtime_settings()


def test_validate_runtime_settings_rejects_placeholder_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(
            database_url="postgresql+psycopg://newscast:change-this-db-password@db:5432/newscast"
        ),
    )

    with pytest.raises(UnsafeRuntimeConfigurationError, match="DATABASE_URL"):
        _validate_runtime_settings()
