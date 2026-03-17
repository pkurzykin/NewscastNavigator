from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


settings = get_settings()


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

normalized_database_url = _normalize_database_url(settings.database_url)

engine = create_engine(
    normalized_database_url,
    pool_pre_ping=True,
    future=True,
)

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
