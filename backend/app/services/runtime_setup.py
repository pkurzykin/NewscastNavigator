from __future__ import annotations

from ipaddress import ip_address
from pathlib import Path
from urllib.parse import urlsplit

from alembic import command
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import verify_password
from app.db.models import User
from app.db.session import SessionLocal
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data


BACKEND_ROOT = Path(__file__).resolve().parents[2]
UNSAFE_PRODUCTION_SECRET_MARKERS = ("change-this", "change-me", "changeme", "example", "test-")
UNSAFE_PRODUCTION_DB_URL_MARKERS = (
    "change-this",
    "change-me",
    "changeme",
    "newscast-dev-only",
)
class UnsafeRuntimeConfigurationError(RuntimeError):
    pass


def _build_alembic_config() -> Config:
    settings = get_settings()
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    return config


def _is_production_environment(environment: str) -> bool:
    return environment.strip().casefold() in {"prod", "production"}


def _contains_marker(value: str, markers: tuple[str, ...]) -> bool:
    normalized = value.strip().casefold()
    return any(marker in normalized for marker in markers)


def _is_safe_production_origin(origin: str, *, allow_null_origin: bool) -> bool:
    if origin == "null":
        return allow_null_origin
    if not origin or origin != origin.strip() or origin == "*":
        return False
    try:
        parsed = urlsplit(origin)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme.casefold() != "https"
        or not parsed.netloc
        or not hostname
        or parsed.netloc.endswith(":")
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or any(character.isspace() for character in parsed.netloc)
    ):
        return False
    normalized_host = hostname.casefold().rstrip(".")
    if normalized_host == "localhost" or normalized_host.endswith(".localhost"):
        return False
    try:
        address = ip_address(normalized_host)
        return not address.is_loopback and not address.is_unspecified
    except ValueError:
        if len(normalized_host) > 253:
            return False
        allowed = frozenset("abcdefghijklmnopqrstuvwxyz0123456789-")
        labels = normalized_host.split(".")
        return all(
            1 <= len(label) <= 63
            and label[0] != "-"
            and label[-1] != "-"
            and all(character in allowed for character in label)
            for label in labels
        )


def _validate_runtime_settings() -> None:
    settings = get_settings()
    if not _is_production_environment(settings.environment):
        return
    issues: list[str] = []
    database_url = make_url(settings.database_url)
    if settings.seed_demo_data:
        issues.append("SEED_DEMO_DATA должен быть отключён в production")
    if database_url.get_backend_name() != "postgresql":
        issues.append("DATABASE_URL должен использовать PostgreSQL в production")
    if len(settings.session_secret.strip()) < 24 or _contains_marker(
        settings.session_secret, UNSAFE_PRODUCTION_SECRET_MARKERS
    ):
        issues.append("SECRET_KEY/SESSION_SECRET должен содержать стойкое непустое значение")
    if not settings.session_cookie_secure:
        issues.append("SESSION_COOKIE_SECURE должен быть включён в production")
    database_credentials = " ".join(
        value for value in (database_url.username, database_url.password) if value
    )
    if _contains_marker(
        settings.database_url, UNSAFE_PRODUCTION_DB_URL_MARKERS
    ) or _contains_marker(database_credentials, UNSAFE_PRODUCTION_DB_URL_MARKERS):
        issues.append("DATABASE_URL не должен содержать пример учётных данных")
    unsafe_origins = [
        origin
        for origin in settings.cors_origins_list
        if not _is_safe_production_origin(
            origin,
            allow_null_origin=settings.allow_null_cors_origin,
        )
    ]
    if unsafe_origins:
        issues.append("CORS_ORIGINS должен содержать только точные внешние HTTPS origin")
    if issues:
        raise UnsafeRuntimeConfigurationError("Небезопасная production-конфигурация: " + "; ".join(issues))


def _find_unsafe_active_demo_users(users: list[User]) -> list[str]:
    unsafe: list[str] = []
    for user in users:
        if user.is_active and verify_password(SYNTHETIC_DEMO_PASSWORD, user.password_hash):
            unsafe.append(f"{user.username}: активен синтетический демонстрационный пароль")
    return unsafe


def _validate_production_user_state(db: Session) -> None:
    if not _is_production_environment(get_settings().environment):
        return
    findings = _find_unsafe_active_demo_users(db.execute(select(User)).scalars().all())
    if findings:
        raise UnsafeRuntimeConfigurationError("Небезопасные production-пользователи: " + "; ".join(findings))


def run_migrations() -> None:
    command.upgrade(_build_alembic_config(), "head")


def initialize_runtime(*, seed_demo_records: bool | None = None) -> None:
    settings = get_settings()
    _validate_runtime_settings()
    run_migrations()
    with SessionLocal() as db:
        _validate_production_user_state(db)
        should_seed = settings.seed_demo_data if seed_demo_records is None else seed_demo_records
        if should_seed:
            if _is_production_environment(settings.environment):
                raise UnsafeRuntimeConfigurationError("Синтетический seed запрещён в production")
            seed_demo_data(db)
