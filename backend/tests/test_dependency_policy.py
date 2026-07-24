from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"


def _requirement_names(path: Path) -> set[str]:
    names: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith(("-", "--")):
            continue
        name = re.split(r"[<>=!~\[]", line, maxsplit=1)[0]
        names.add(name.casefold().replace("_", "-"))
    return names


def _lock_blocks(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    return [
        block
        for block in re.split(r"\n(?=[a-zA-Z0-9])", source)
        if block.strip() and not block.lstrip().startswith(("#", "--"))
    ]


def test_backend_inputs_declare_all_direct_dependencies() -> None:
    runtime = _requirement_names(BACKEND_ROOT / "requirements.txt")
    development = _requirement_names(BACKEND_ROOT / "requirements-dev.txt")

    assert {
        "alembic",
        "fastapi",
        "psycopg",
        "pydantic",
        "pydantic-settings",
        "sqlalchemy",
        "uvicorn",
    } <= runtime
    assert {"httpx", "pytest", "pyyaml"} <= development


def test_backend_lock_files_are_hash_pinned_and_cover_direct_inputs() -> None:
    runtime_lock = BACKEND_ROOT / "requirements.lock"
    development_lock = BACKEND_ROOT / "requirements-dev.lock"

    assert runtime_lock.is_file()
    assert development_lock.is_file()

    for lock_path in (runtime_lock, development_lock):
        blocks = _lock_blocks(lock_path)
        assert blocks
        for block in blocks:
            first_line = block.splitlines()[0]
            assert "==" in first_line, f"not exact-pinned in {lock_path.name}: {first_line}"
            assert "--hash=sha256:" in block, f"missing hash in {lock_path.name}: {first_line}"

    assert _requirement_names(BACKEND_ROOT / "requirements.txt") <= _requirement_names(runtime_lock)
    assert (
        _requirement_names(BACKEND_ROOT / "requirements.txt")
        | _requirement_names(BACKEND_ROOT / "requirements-dev.txt")
    ) <= _requirement_names(development_lock)


def test_canonical_install_paths_use_lock_files_and_license_gate() -> None:
    local_dockerfile = (BACKEND_ROOT / "Dockerfile").read_text(encoding="utf-8")
    production_dockerfile = (BACKEND_ROOT / "Dockerfile.prod").read_text(encoding="utf-8")
    workflow = (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "requirements.lock" in local_dockerfile
    assert "requirements.lock" in production_dockerfile
    assert "requirements.txt" not in local_dockerfile
    assert "requirements.txt" not in production_dockerfile
    assert "requirements-dev.lock" in workflow
    assert "requirements-dev.txt" not in workflow
    assert "scripts/check_dependency_licenses.py --repo-root .." in workflow


def test_frontend_lock_covers_declared_dependencies_without_manifest_drift() -> None:
    package = json.loads((REPO_ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    lock = json.loads((REPO_ROOT / "frontend/package-lock.json").read_text(encoding="utf-8"))
    root_package = lock["packages"][""]

    assert lock["lockfileVersion"] == 3
    assert root_package["dependencies"] == package["dependencies"]
    assert root_package["devDependencies"] == package["devDependencies"]


def test_dependency_license_checker_and_notices_cover_direct_dependencies() -> None:
    checker = BACKEND_ROOT / "scripts/check_dependency_licenses.py"
    notices = REPO_ROOT / "docs/THIRD_PARTY_NOTICES.md"

    assert checker.is_file()
    assert notices.is_file()

    notice_text = notices.read_text(encoding="utf-8").casefold()
    required = (
        _requirement_names(BACKEND_ROOT / "requirements.txt")
        | _requirement_names(BACKEND_ROOT / "requirements-dev.txt")
        | {
            name.casefold()
            for group in ("dependencies", "devDependencies")
            for name in json.loads(
                (REPO_ROOT / "frontend/package.json").read_text(encoding="utf-8")
            )[group]
        }
    )
    missing = sorted(name for name in required if f"`{name}`" not in notice_text)

    assert missing == []
    assert "unknown" not in notice_text
    assert "неизвест" not in notice_text
