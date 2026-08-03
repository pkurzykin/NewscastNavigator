from __future__ import annotations

import json
import tomllib
from pathlib import Path

from app.core.version import FALLBACK_APP_VERSION


ROOT = Path(__file__).resolve().parents[2]


def test_application_version_is_consistent() -> None:
    pyproject = tomllib.loads((ROOT / "backend/pyproject.toml").read_text())
    package = json.loads((ROOT / "frontend/package.json").read_text())
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text())

    assert {
        pyproject["project"]["version"],
        FALLBACK_APP_VERSION,
        package["version"],
        lock["version"],
        lock["packages"][""]["version"],
    } == {"1.0.2"}
