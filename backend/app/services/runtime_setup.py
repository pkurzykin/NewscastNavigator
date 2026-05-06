from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import verify_password
from app.db.models import User
from app.db.session import SessionLocal
from app.services.bootstrap import ensure_runtime_paths, seed_demo_data


BACKEND_ROOT = Path(__file__).resolve().parents[2]
UNSAFE_PRODUCTION_SECRET_MARKERS = (
    "change-this",
    "changeme",
    "example",
    "test-session-secret",
)
UNSAFE_PRODUCTION_DB_URL_MARKERS = (
    "change-this",
    "changeme",
)
UNSAFE_PRODUCTION_CORS_ORIGINS = {
    "*",
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:5173",
    "http://0.0.0.0",
}
DEMO_USER_PASSWORDS = {
    "admin": "admin123",
    "editor": "editor123",
    "author": "author123",
    "proofreader": "proof123",
}
DEMO_USER_IDENTITIES = {
    "editor": "Демо редактор",
    "author": "Демо корреспондент",
    "proofreader": "Демо корректор",
}


class UnsafeRuntimeConfigurationError(RuntimeError):
    pass


def _normalize_database_url(database_url: str) -> str:
    db_url = make_url(database_url)
    if db_url.get_backend_name() != "sqlite":
        return database_url

    database = db_url.database or ""
    if not database or database == ":memory:":
        return database_url

    db_path = Path(database).expanduser()
    if not db_path.is_absolute():
        db_path = (Path.cwd() / db_path).resolve()

    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_url.set(database=str(db_path)).render_as_string(hide_password=False)


def _build_alembic_config() -> Config:
    settings = get_settings()
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", _normalize_database_url(settings.database_url))
    return config


def _is_production_environment(environment: str) -> bool:
    return environment.strip().lower() in {"prod", "production"}


def _contains_marker(value: str, markers: tuple[str, ...]) -> bool:
    normalized = value.strip().lower()
    return any(marker in normalized for marker in markers)


def _validate_runtime_settings() -> None:
    settings = get_settings()
    if not _is_production_environment(settings.environment):
        return

    issues: list[str] = []
    database_url = make_url(settings.database_url)

    if settings.seed_demo_data:
        issues.append("SEED_DEMO_DATA must stay false in production")

    if database_url.get_backend_name() == "sqlite":
        issues.append("DATABASE_URL must use PostgreSQL in production")

    session_secret = settings.session_secret.strip()
    if len(session_secret) < 24 or _contains_marker(
        session_secret,
        UNSAFE_PRODUCTION_SECRET_MARKERS,
    ):
        issues.append(
            "SECRET_KEY/SESSION_SECRET must be replaced with a strong non-placeholder value"
        )

    if _contains_marker(settings.database_url, UNSAFE_PRODUCTION_DB_URL_MARKERS):
        issues.append(
            "DATABASE_URL must not contain placeholder credentials like change-this-*"
        )

    unsafe_cors_origins = [
        origin
        for origin in settings.cors_origins_list
        if origin.strip().lower() in UNSAFE_PRODUCTION_CORS_ORIGINS
        or origin.strip().lower().startswith("http://")
    ]
    if unsafe_cors_origins:
        issues.append(
            "CORS_ORIGINS must not include wildcard, dev, or plain HTTP origins in production"
        )

    if issues:
        raise UnsafeRuntimeConfigurationError(
            "Unsafe production configuration: " + "; ".join(issues)
        )


def _find_unsafe_active_demo_users(users: list[User]) -> list[str]:
    unsafe_users: list[str] = []
    for user in users:
        if not user.is_active:
            continue

        username = (user.username or "").strip().lower()
        default_password = DEMO_USER_PASSWORDS.get(username)
        if default_password and verify_password(default_password, user.password_hash):
            unsafe_users.append(f"{user.username}: default demo password is still active")
            continue

        demo_full_name = DEMO_USER_IDENTITIES.get(username)
        if demo_full_name and (user.full_name or "").strip() == demo_full_name:
            unsafe_users.append(f"{user.username}: demo identity is still active")

    return unsafe_users


def _validate_production_user_state(db: Session) -> None:
    settings = get_settings()
    if not _is_production_environment(settings.environment):
        return

    users = db.execute(select(User)).scalars().all()
    unsafe_users = _find_unsafe_active_demo_users(users)
    if unsafe_users:
        raise UnsafeRuntimeConfigurationError(
            "Unsafe production users: " + "; ".join(unsafe_users)
        )


def run_migrations() -> None:
    command.upgrade(_build_alembic_config(), "head")


def initialize_runtime(*, seed_demo_records: bool | None = None) -> None:
    settings = get_settings()
    _validate_runtime_settings()
    ensure_runtime_paths()
    run_migrations()

    with SessionLocal() as db:
        _validate_production_user_state(db)

    should_seed = settings.seed_demo_data if seed_demo_records is None else seed_demo_records
    if should_seed:
        seed_demo_data(force=True)
