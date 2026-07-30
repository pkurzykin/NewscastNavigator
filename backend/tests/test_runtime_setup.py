from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.core.security import verify_password
from app.db.models import Story, User
from app.db.session import (
    SessionLocal,
    _reset_sqlite_test_database,
    _safe_sqlite_test_database_path,
    _validate_database_backend,
    _validate_postgresql_test_reset_target,
)
from app.services.runtime_setup import (
    UnsafeRuntimeConfigurationError,
    _find_unsafe_active_demo_users,
    _validate_runtime_settings,
    initialize_runtime,
)
from conftest import SQLITE_TEST_ALLOWED_ROOTS
import scripts.bootstrap_admin as bootstrap_admin


BACKEND_ROOT = Path(__file__).resolve().parents[1]


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
        session_cookie_secure=True,
        allow_null_cors_origin=False,
        cors_origins="https://example.invalid",
    )
    base.update(overrides)
    return _SettingsStub(**base)


def test_runtime_uses_explicit_product_reset_scripts() -> None:
    assert (BACKEND_ROOT / "scripts/bootstrap_admin.py").is_file()
    assert (BACKEND_ROOT / "scripts/seed_demo.py").is_file()
    assert not (BACKEND_ROOT / "scripts/bootstrap_runtime.py").exists()


def test_bootstrap_admin_hashes_the_exact_password_environment_value(
    monkeypatch,
) -> None:
    exact_password = "  Bootstrap-Spaces-2026!  "
    monkeypatch.setenv("BOOTSTRAP_ADMIN_USERNAME", "bootstrap-spaces")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_DISPLAY_NAME", "  Администратор  ")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_POSITION", "  Начальник  ")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", exact_password)

    assert bootstrap_admin.main() == 0

    with SessionLocal() as db:
        user = db.execute(
            select(User).where(User.username == "bootstrap-spaces")
        ).scalar_one()
        assert user.display_name == "Администратор"
        assert user.position == "Начальник"
        assert verify_password(exact_password, user.password_hash) is True
        assert verify_password(exact_password.strip(), user.password_hash) is False


def test_sqlite_reset_guard_uses_actual_engine_path_and_is_order_independent(tmp_path: Path) -> None:
    database_path = tmp_path / "newscast-fixed.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    unrelated = tmp_path / "unrelated.db"
    unrelated.write_text("do not delete", encoding="utf-8")

    for content in ("first run", "second run"):
        database_path.write_text(content, encoding="utf-8")
        reset_path = _reset_sqlite_test_database(
            database_url,
            environment="test",
            allowed_roots=(tmp_path,),
        )
        assert reset_path == database_path.resolve()
        assert not database_path.exists()
        assert unrelated.read_text(encoding="utf-8") == "do not delete"


def test_sqlite_fixed_ci_path_is_accepted_from_the_explicit_tmp_root() -> None:
    fixed_path = Path("/tmp/newscast-ci.db").resolve()

    assert _safe_sqlite_test_database_path(
        f"sqlite:////{fixed_path.as_posix().lstrip('/')}",
        environment="test",
        allowed_roots=SQLITE_TEST_ALLOWED_ROOTS,
    ) == fixed_path


@pytest.mark.parametrize(
    ("database_url", "environment", "root"),
    [
        ("sqlite:////tmp/newscast-safe.db", "development", Path("/tmp")),
        ("sqlite:////tmp/arbitrary.db", "test", Path("/tmp")),
        ("sqlite:////var/tmp/newscast-safe.db", "test", Path("/tmp")),
    ],
)
def test_sqlite_reset_guard_rejects_unsafe_targets_without_touching_them(
    database_url: str,
    environment: str,
    root: Path,
) -> None:
    with pytest.raises(RuntimeError, match="SQLite"):
        _safe_sqlite_test_database_path(
            database_url,
            environment=environment,
            allowed_roots=(root,),
        )


def test_postgresql_reset_guard_accepts_only_isolated_local_compose_target() -> None:
    target = _validate_postgresql_test_reset_target(
        "postgresql+psycopg://product_reset_test:password@db:5432/newscast_product_reset_test",
        environment="test",
    )
    assert target == ("db", 5432)


@pytest.mark.parametrize(
    "query",
    [
        "host=remote.example.invalid",
        "hostaddr=203.0.113.10",
        "port=6543",
        "dbname=other_database",
        "service=remote_service",
        "options=-c%20search_path%3Dother_schema",
        "host=db&host=remote.example.invalid",
        "host=db%2Cremote.example.invalid",
    ],
)
def test_postgresql_reset_guard_rejects_driver_connection_overrides(query: str) -> None:
    database_url = (
        "postgresql+psycopg://product_reset_test:password@db:5432/"
        f"newscast_product_reset_test?{query}"
    )

    with pytest.raises(RuntimeError, match="PostgreSQL"):
        _validate_postgresql_test_reset_target(database_url, environment="test")


@pytest.mark.parametrize(
    ("database_url", "environment"),
    [
        (
            "postgresql+psycopg://product_reset_test:password@db:5432/newscast_product_reset_test",
            "development",
        ),
        (
            "postgresql+psycopg://wrong:password@db:5432/newscast_product_reset_test",
            "test",
        ),
        (
            "postgresql+psycopg://product_reset_test:password@db:5432/wrong_database",
            "test",
        ),
        (
            "postgresql+psycopg://product_reset_test:password@remote.example.invalid:5432/newscast_product_reset_test",
            "test",
        ),
        (
            "postgresql+psycopg://product_reset_test:password@db:70000/newscast_product_reset_test",
            "test",
        ),
    ],
)
def test_postgresql_reset_guard_rejects_unsafe_targets_without_connecting(
    database_url: str,
    environment: str,
) -> None:
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        _validate_postgresql_test_reset_target(database_url, environment=environment)


@pytest.mark.parametrize("environment", ["development", "production"])
def test_database_backend_allows_postgresql_in_operational_environments(environment: str) -> None:
    assert _validate_database_backend("postgresql+psycopg://user:pass@db/app", environment) == "postgresql"


@pytest.mark.parametrize("environment", ["test", "testing", "test-double"])
def test_database_backend_allows_sqlite_only_as_test_double(environment: str) -> None:
    assert _validate_database_backend("sqlite+pysqlite:///:memory:", environment) == "sqlite"


@pytest.mark.parametrize(
    ("database_url", "environment"),
    [
        ("sqlite+pysqlite:///:memory:", "development"),
        ("sqlite+pysqlite:///runtime.db", "production"),
        ("mysql+pymysql://user:pass@db/app", "test"),
    ],
)
def test_database_backend_rejects_non_postgresql_operational_dialects(
    database_url: str, environment: str
) -> None:
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        _validate_database_backend(database_url, environment)


def test_validate_runtime_settings_allows_safe_production_config(monkeypatch) -> None:
    monkeypatch.setattr("app.services.runtime_setup.get_settings", lambda: _build_settings())
    _validate_runtime_settings()


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"seed_demo_data": True}, "SEED_DEMO_DATA"),
        ({"session_secret": "change-this-session-secret"}, "SECRET_KEY/SESSION_SECRET"),
        (
            {
                "database_url": "postgresql+psycopg://newscast:change-this@db:5432/newscast"
            },
            "DATABASE_URL",
        ),
        (
            {
                "database_url": "postgresql+psycopg://newscast:newscast-dev-only@db:5432/newscast"
            },
            "DATABASE_URL",
        ),
        (
            {
                "database_url": "postgresql+psycopg://newscast:newscast%2Ddev%2Donly@db:5432/newscast"
            },
            "DATABASE_URL",
        ),
        ({"database_url": "sqlite+pysqlite:///prod.db"}, "PostgreSQL"),
        ({"cors_origins": "https://example.invalid,*"}, "CORS_ORIGINS"),
        ({"cors_origins": "http://localhost:5173"}, "CORS_ORIGINS"),
    ],
)
def test_validate_runtime_settings_rejects_unsafe_production_configuration(
    monkeypatch, overrides: dict[str, object], message: str
) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(**overrides),
    )
    with pytest.raises(UnsafeRuntimeConfigurationError, match=message):
        _validate_runtime_settings()


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "null",
        "not-a-url",
        "http://example.invalid",
        "https://localhost",
        "https://service.localhost:443",
        "https://127.0.0.1",
        "https://[::1]",
        "https://0.0.0.0",
        "https://[::]",
        "https://user:pass@example.invalid",
        "https://example.invalid/path",
        "https://example.invalid?query=1",
        "https://example.invalid#fragment",
        "https://example.invalid:bad-port",
        "https://example.invalid:",
        "https://exa%mple.invalid",
        "https://example.invalid\\evil",
        "https://bad..example.invalid",
    ],
)
def test_production_rejects_non_origin_or_local_cors_values(monkeypatch, origin: str) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(cors_origins=origin),
    )
    with pytest.raises(UnsafeRuntimeConfigurationError, match="CORS_ORIGINS"):
        _validate_runtime_settings()


@pytest.mark.parametrize(
    "origin",
    [
        "https://example.invalid",
        "https://subdomain.example.invalid:8443",
        "https://[2001:db8::1]",
    ],
)
def test_production_accepts_canonical_https_cors_origins(monkeypatch, origin: str) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(cors_origins=origin),
    )
    _validate_runtime_settings()


def test_production_allows_exact_null_origin_only_with_explicit_opt_in(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.runtime_setup.get_settings",
        lambda: _build_settings(cors_origins="https://example.invalid,null", allow_null_cors_origin=True),
    )
    _validate_runtime_settings()


def test_find_unsafe_active_demo_users_detects_default_seed_password() -> None:
    from app.core.security import hash_password

    users = [
        User(
            username="astra",
            display_name="Астра",
            position="Начальник",
            password_hash=hash_password("Synthetic-Demo-2026!"),
            is_active=True,
        )
    ]

    assert _find_unsafe_active_demo_users(users) == [
        "astra: активен синтетический демонстрационный пароль"
    ]


def test_initialize_runtime_is_idempotent_and_seed_is_explicit() -> None:
    initialize_runtime(seed_demo_records=False)
    initialize_runtime(seed_demo_records=False)
    with SessionLocal() as db:
        assert db.scalar(select(func.count(Story.id))) == 0

    initialize_runtime(seed_demo_records=True)
    initialize_runtime(seed_demo_records=True)
    with SessionLocal() as db:
        assert db.scalar(select(func.count(Story.id))) == 35
