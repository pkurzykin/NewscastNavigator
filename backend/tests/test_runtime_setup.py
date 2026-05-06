from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.runtime_setup import (
    UnsafeRuntimeConfigurationError,
    _find_unsafe_active_demo_users,
    _validate_runtime_settings,
)
from app.core.security import hash_password
from app.db.models import User


class _SettingsStub(SimpleNamespace):
    @property
    def cors_origins_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


def _build_settings(**overrides: object) -> _SettingsStub:
    base: dict[str, object] = dict(
        environment="production",
        database_url="postgresql+psycopg://newscast:strong-db-password@db:5432/newscast",
        seed_demo_data=False,
        session_secret="strong-production-session-secret-123456",
        cors_origins="https://example.com,null",
    )
    base.update(overrides)
    return _SettingsStub(**base)


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


def test_validate_runtime_settings_rejects_sqlite_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(database_url="sqlite+pysqlite:///prod.db"),
    )

    with pytest.raises(UnsafeRuntimeConfigurationError, match="PostgreSQL"):
        _validate_runtime_settings()


def test_validate_runtime_settings_rejects_wildcard_cors_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(cors_origins="https://example.com,*"),
    )

    with pytest.raises(UnsafeRuntimeConfigurationError, match="CORS_ORIGINS"):
        _validate_runtime_settings()


def test_validate_runtime_settings_rejects_plain_http_cors_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(cors_origins="https://example.com,http://localhost:5173"),
    )

    with pytest.raises(UnsafeRuntimeConfigurationError, match="CORS_ORIGINS"):
        _validate_runtime_settings()


def test_find_unsafe_active_demo_users_rejects_default_credentials() -> None:
    users = [
        User(
            username="admin",
            role="admin",
            password_hash=hash_password("admin123"),
            is_active=True,
        )
    ]

    assert _find_unsafe_active_demo_users(users) == [
        "admin: default demo password is still active"
    ]


def test_find_unsafe_active_demo_users_rejects_active_demo_identity() -> None:
    users = [
        User(
            username="editor",
            full_name="Демо редактор",
            role="editor",
            password_hash=hash_password("StrongEditorPassword123"),
            is_active=True,
        )
    ]

    assert _find_unsafe_active_demo_users(users) == [
        "editor: demo identity is still active"
    ]


def test_find_unsafe_active_demo_users_allows_deactivated_demo_user() -> None:
    users = [
        User(
            username="editor",
            full_name="Демо редактор",
            role="editor",
            password_hash=hash_password("editor123"),
            is_active=False,
        )
    ]

    assert _find_unsafe_active_demo_users(users) == []
