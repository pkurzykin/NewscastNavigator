from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

TEST_ROOT = Path(tempfile.mkdtemp(prefix="newscast-api-tests-"))
TEST_DB_PATH = TEST_ROOT / "test.db"
TEST_STORAGE_ROOT = TEST_ROOT / "storage"
TEST_EXPORT_ROOT = TEST_ROOT / "exports"

os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{TEST_DB_PATH}"
os.environ["SEED_DEMO_DATA"] = "true"
os.environ["CORS_ORIGINS"] = "http://127.0.0.1:5173,http://localhost:5173"
os.environ["STORAGE_PATH"] = str(TEST_STORAGE_ROOT)
os.environ["EXPORT_PATH"] = str(TEST_EXPORT_ROOT)
os.environ["SECRET_KEY"] = "test-session-secret"
os.environ["ENVIRONMENT"] = "test"

from app.core.config import get_settings

get_settings.cache_clear()

from app.main import app
from app.db.session import engine
from app.services.runtime_setup import initialize_runtime


@pytest.fixture(autouse=True)
def reset_test_database() -> None:
    engine.dispose()
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    if TEST_STORAGE_ROOT.exists():
        shutil.rmtree(TEST_STORAGE_ROOT)
    TEST_STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    if TEST_EXPORT_ROOT.exists():
        shutil.rmtree(TEST_EXPORT_ROOT)
    TEST_EXPORT_ROOT.mkdir(parents=True, exist_ok=True)
    initialize_runtime(seed_demo_records=True)
    yield
    engine.dispose()


@pytest.fixture()
def client(reset_test_database: None) -> TestClient:
    with TestClient(app) as test_client:
        yield test_client
