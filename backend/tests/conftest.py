from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

TEST_ROOT = Path(tempfile.mkdtemp(prefix="newscast-api-tests-"))
TEST_DB_PATH = TEST_ROOT / "newscast-api-tests.db"
SQLITE_TEST_ALLOWED_ROOTS = (TEST_ROOT, Path(tempfile.gettempdir()), Path("/tmp"))

os.environ.setdefault("DATABASE_URL", f"sqlite+pysqlite:///{TEST_DB_PATH}")
os.environ.setdefault("SEED_DEMO_DATA", "false")
os.environ.setdefault("CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
os.environ.setdefault("SECRET_KEY", "test-session-secret")
os.environ.setdefault("ENVIRONMENT", "test")

from app.core.config import get_settings

get_settings.cache_clear()

from app.main import app
from app.db.session import (
    _reset_sqlite_test_database,
    _validate_postgresql_test_reset_target,
    engine,
)
from app.services.runtime_setup import initialize_runtime


@pytest.fixture(autouse=True)
def reset_test_database() -> None:
    engine.dispose()
    database_url = make_url(str(engine.url))
    environment = get_settings().environment
    if database_url.get_backend_name() == "sqlite":
        _reset_sqlite_test_database(
            str(engine.url),
            environment=environment,
            allowed_roots=SQLITE_TEST_ALLOWED_ROOTS,
        )
    elif database_url.get_backend_name() == "postgresql":
        _validate_postgresql_test_reset_target(
            str(engine.url),
            environment=environment,
        )
        with engine.begin() as connection:
            connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
    initialize_runtime(seed_demo_records=False)
    yield
    engine.dispose()


@pytest.fixture()
def client(reset_test_database: None) -> TestClient:
    with TestClient(app) as test_client:
        yield test_client
