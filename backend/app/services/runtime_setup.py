from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.services.bootstrap import ensure_runtime_paths, seed_demo_data


BACKEND_ROOT = Path(__file__).resolve().parents[2]


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


def run_migrations() -> None:
    command.upgrade(_build_alembic_config(), "head")


def initialize_runtime(*, seed_demo_records: bool | None = None) -> None:
    settings = get_settings()
    ensure_runtime_paths()
    run_migrations()

    should_seed = settings.seed_demo_data if seed_demo_records is None else seed_demo_records
    if should_seed:
        seed_demo_data(force=True)
