from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


settings = get_settings()


def _prepare_database_path() -> None:
    db_url = make_url(settings.database_url)
    if db_url.get_backend_name() != "sqlite":
        return

    database = db_url.database or ""
    if not database or database == ":memory:":
        return

    db_path = Path(database).expanduser()
    if not db_path.is_absolute():
        db_path = Path.cwd() / db_path

    db_path.parent.mkdir(parents=True, exist_ok=True)


_prepare_database_path()

engine = create_engine(
    settings.database_url,
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
