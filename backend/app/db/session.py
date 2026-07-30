from __future__ import annotations

from collections.abc import Generator
from fnmatch import fnmatch
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


settings = get_settings()


def _validate_database_backend(database_url: str, environment: str) -> str:
    backend = make_url(database_url).get_backend_name()
    normalized_environment = environment.strip().casefold()
    if backend == "postgresql":
        return backend
    if backend == "sqlite" and normalized_environment in {"test", "testing", "test-double"}:
        return backend
    raise RuntimeError(
        "Рабочая база данных должна использовать PostgreSQL; "
        "SQLite разрешена только как изолированный test double"
    )


def _safe_sqlite_test_database_path(
    database_url: str,
    *,
    environment: str,
    allowed_roots: tuple[Path, ...],
) -> Path | None:
    try:
        database = make_url(database_url)
    except Exception as exc:
        raise RuntimeError("Некорректный SQLite URL тестовой базы") from exc
    if environment.strip().casefold() != "test" or database.get_backend_name() != "sqlite":
        raise RuntimeError("Удаление SQLite разрешено только для изолированной test-среды")
    if not database.database or database.database == ":memory:":
        return None
    database_path = Path(database.database).expanduser().resolve()
    if not fnmatch(database_path.name, "newscast-*.db"):
        raise RuntimeError("Имя удаляемой SQLite базы должно соответствовать newscast-*.db")
    resolved_roots = tuple(root.expanduser().resolve() for root in allowed_roots)
    if not any(database_path.is_relative_to(root) for root in resolved_roots):
        raise RuntimeError("SQLite база находится вне разрешённого временного каталога")
    return database_path


def _reset_sqlite_test_database(
    database_url: str,
    *,
    environment: str,
    allowed_roots: tuple[Path, ...],
) -> Path | None:
    database_path = _safe_sqlite_test_database_path(
        database_url,
        environment=environment,
        allowed_roots=allowed_roots,
    )
    if database_path is not None and database_path.exists():
        database_path.unlink()
    return database_path


def _validate_postgresql_test_reset_target(
    database_url: str,
    *,
    environment: str,
) -> tuple[str, int]:
    try:
        database = make_url(database_url)
        port = database.port or 5432
    except Exception as exc:
        raise RuntimeError("Некорректный PostgreSQL URL тестовой базы") from exc
    host = (database.host or "").casefold()
    if (
        environment.strip().casefold() != "test"
        or database.get_backend_name() != "postgresql"
        or database.query
        or database.database != "newscast_product_reset_test"
        or database.username != "product_reset_test"
        or host not in {"db", "localhost", "127.0.0.1", "::1"}
        or not 1 <= port <= 65_535
    ):
        raise RuntimeError("Сброс PostgreSQL разрешён только для изолированной локальной test-базы")
    return host, port


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

database_backend = _validate_database_backend(settings.database_url, settings.environment)
normalized_database_url = _normalize_database_url(settings.database_url)

engine_options: dict[str, object] = {
    "pool_pre_ping": True,
    "future": True,
}
if database_backend == "sqlite":
    engine_options["connect_args"] = {"check_same_thread": False}

engine = create_engine(
    normalized_database_url,
    **engine_options,
)


if database_backend == "sqlite":
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=Session,
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
