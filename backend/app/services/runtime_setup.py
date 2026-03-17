from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import get_settings
from app.services.bootstrap import ensure_runtime_paths, seed_demo_data


BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _build_alembic_config() -> Config:
    settings = get_settings()
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
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
