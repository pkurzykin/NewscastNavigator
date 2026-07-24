from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import tomllib

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

from scripts import check_dependency_licenses as policy


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"


def test_backend_inputs_declare_all_direct_dependencies() -> None:
    runtime = set(policy.requirements(BACKEND_ROOT / "requirements.txt"))
    development = set(policy.requirements(BACKEND_ROOT / "requirements-dev.txt"))

    assert {
        "alembic",
        "fastapi",
        "psycopg",
        "pydantic",
        "pydantic-settings",
        "sqlalchemy",
        "uvicorn",
    } <= runtime
    assert {"httpx", "packaging", "pip-tools", "pytest", "pyyaml"} <= development
    assert policy.requirements(BACKEND_ROOT / "requirements-dev.txt")[
        "pip-tools"
    ] == Requirement("pip-tools==7.5.2")


def test_backend_lock_files_are_hash_pinned_and_cover_direct_inputs() -> None:
    runtime_lock = BACKEND_ROOT / "requirements.lock"
    development_lock = BACKEND_ROOT / "requirements-dev.lock"

    assert runtime_lock.is_file()
    assert development_lock.is_file()

    for lock_path in (runtime_lock, development_lock):
        blocks = policy.lock_blocks(lock_path)
        assert blocks
        for block in blocks:
            first_line = block.splitlines()[0]
            assert "==" in first_line, f"not exact-pinned in {lock_path.name}: {first_line}"
            assert "--hash=sha256:" in block, f"missing hash in {lock_path.name}: {first_line}"

    assert set(policy.requirements(BACKEND_ROOT / "requirements.txt")) <= set(
        policy.locked_requirements(runtime_lock)
    )
    assert (
        set(policy.requirements(BACKEND_ROOT / "requirements.txt"))
        | set(policy.requirements(BACKEND_ROOT / "requirements-dev.txt"))
    ) <= set(policy.locked_requirements(development_lock))


def test_direct_specs_and_pyproject_are_reconciled_with_locks() -> None:
    runtime = policy.requirements(BACKEND_ROOT / "requirements.txt")
    development = policy.requirements(BACKEND_ROOT / "requirements-dev.txt")
    runtime_lock = policy.locked_requirements(BACKEND_ROOT / "requirements.lock")
    development_lock = policy.locked_requirements(BACKEND_ROOT / "requirements-dev.lock")
    pyproject = tomllib.loads((BACKEND_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    project_runtime = {
        canonicalize_name(requirement.name): requirement
        for raw in pyproject["project"]["dependencies"]
        for requirement in (Requirement(raw),)
    }

    assert policy.requirement_alignment_errors(runtime, runtime_lock) == []
    assert policy.requirement_alignment_errors(
        runtime | development, development_lock
    ) == []
    assert policy.requirement_set_errors(runtime, project_runtime) == []


def test_runtime_graph_is_identical_in_runtime_and_development_locks() -> None:
    runtime_lock = policy.locked_requirements(BACKEND_ROOT / "requirements.lock")
    development_lock = policy.locked_requirements(BACKEND_ROOT / "requirements-dev.lock")

    assert policy.runtime_lock_consistency_errors(
        runtime_lock,
        development_lock,
    ) == []
    divergent = development_lock | {
        "fastapi": policy.LockedRequirement(version="0.999.0")
    }
    assert policy.runtime_lock_consistency_errors(runtime_lock, divergent) == [
        "runtime lock divergence in development lock: fastapi 0.139.2 != 0.999.0"
    ]


def test_impossible_direct_specifier_is_rejected_against_lock() -> None:
    locked = {"fastapi": policy.LockedRequirement(version="0.139.2")}

    errors = policy.requirement_alignment_errors(
        {"fastapi": Requirement("fastapi>=0.999")},
        locked,
    )

    assert errors == [
        "locked fastapi==0.139.2 does not satisfy direct requirement fastapi>=0.999"
    ]


def test_canonical_install_paths_use_lock_files_and_license_gate() -> None:
    local_dockerfile = (BACKEND_ROOT / "Dockerfile").read_text(encoding="utf-8")
    production_dockerfile = (BACKEND_ROOT / "Dockerfile.prod").read_text(encoding="utf-8")
    workflow = (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    test_compose = (REPO_ROOT / "compose.test.yaml").read_text(encoding="utf-8")

    assert "requirements.lock" in local_dockerfile
    assert "requirements.lock" in production_dockerfile
    assert "requirements.txt" not in local_dockerfile
    assert "requirements.txt" not in production_dockerfile
    assert "requirements-dev.lock" in workflow
    assert "requirements-dev.txt" not in workflow
    assert "scripts/check_dependency_licenses.py --repo-root .." in workflow
    assert "pip install --quiet --require-hashes -r requirements-dev.lock" in test_compose
    assert "requirements.txt" not in test_compose
    assert "requirements-dev.txt" not in test_compose


def test_frontend_lock_covers_declared_dependencies_without_manifest_drift() -> None:
    package = json.loads((REPO_ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    lock = json.loads((REPO_ROOT / "frontend/package-lock.json").read_text(encoding="utf-8"))
    root_package = lock["packages"][""]

    assert lock["lockfileVersion"] == 3
    assert root_package["dependencies"] == package["dependencies"]
    assert root_package["devDependencies"] == package["devDependencies"]


def test_direct_npm_lock_metadata_and_notices_match_exactly() -> None:
    package = json.loads((REPO_ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    package_lock = json.loads(
        (REPO_ROOT / "frontend/package-lock.json").read_text(encoding="utf-8")
    )
    notices = policy.notice_licenses(REPO_ROOT / "docs/THIRD_PARTY_NOTICES.md")

    assert policy.npm_license_errors(package, package_lock, notices) == []


def test_npm_license_gate_rejects_missing_wrong_and_unreviewed_metadata() -> None:
    package = {"dependencies": {"example": "^1.0.0"}, "devDependencies": {}}
    notices = {("npm", "example"): "MIT"}

    assert policy.npm_license_errors(package, {"packages": {"": package}}, notices) == [
        "missing package-lock entry for direct npm dependency example"
    ]

    missing_license = {"packages": {"": package, "node_modules/example": {"version": "1.0.0"}}}
    assert policy.npm_license_errors(package, missing_license, notices) == [
        "direct npm dependency example has no package-lock license metadata"
    ]

    unsupported = deepcopy(missing_license)
    unsupported["packages"]["node_modules/example"]["license"] = "GPL-3.0-only"
    assert policy.npm_license_errors(package, unsupported, notices) == [
        "unreviewed direct npm dependency license: example GPL-3.0-only"
    ]

    mismatch = deepcopy(missing_license)
    mismatch["packages"]["node_modules/example"]["license"] = "Apache-2.0"
    assert policy.npm_license_errors(package, mismatch, notices) == [
        "npm license metadata/notices mismatch: example Apache-2.0 != MIT"
    ]


def test_python_runtime_transitives_and_direct_dev_tools_have_exact_notices() -> None:
    runtime_lock = policy.locked_requirements(BACKEND_ROOT / "requirements.lock")
    development = policy.requirements(BACKEND_ROOT / "requirements-dev.txt")
    development_lock = policy.locked_requirements(BACKEND_ROOT / "requirements-dev.lock")
    notices = policy.notice_licenses(REPO_ROOT / "docs/THIRD_PARTY_NOTICES.md")
    inventory = set(runtime_lock) | set(development)
    inventory_lock = runtime_lock | {
        name: development_lock[name] for name in development if name not in runtime_lock
    }

    assert len(inventory) == 30
    assert policy.python_license_errors(inventory, inventory_lock, notices) == []


def test_python_license_gate_fails_closed_on_missing_metadata_and_notice_mismatch() -> None:
    notices = {("Python", "example"): "MIT"}

    assert policy.python_license_errors(
        {"example"},
        {},
        notices,
        metadata_reader=lambda _name: ("1.0.0", None),
    ) == ["Python dependency has no usable license metadata: example"]
    assert policy.python_license_errors(
        {"example"},
        {},
        notices,
        metadata_reader=lambda _name: ("1.0.0", "Apache-2.0"),
    ) == ["Python license metadata/notices mismatch: example Apache-2.0 != MIT"]


def test_onest_asset_and_ofl_are_hash_bound_to_notice(tmp_path: Path) -> None:
    notices = policy.notice_licenses(REPO_ROOT / "docs/THIRD_PARTY_NOTICES.md")

    assert policy.asset_license_errors(REPO_ROOT, notices) == []
    assert notices[("Asset", "onest")] == "OFL-1.1"

    wrong_font = tmp_path / "frontend/public/fonts/onest/Onest-VariableFont.woff2"
    wrong_font.parent.mkdir(parents=True)
    wrong_font.write_bytes(b"not-onest")
    (wrong_font.parent / "OFL.txt").write_text("not-ofl", encoding="utf-8")
    assert policy.asset_license_errors(tmp_path, notices) == [
        (
            "bundled Onest asset hash mismatch: "
            "frontend/public/fonts/onest/Onest-VariableFont.woff2 "
            "caca622e449653ceb4785fb3e6a19e982dd687bd5ea707443b611174c65ffa56 != "
            "e117f6aee7c97fbc2f7e6514fa08a31ad43e7bd116105aeac15c8c1b8427f7db"
        ),
        (
            "bundled Onest asset hash mismatch: "
            "frontend/public/fonts/onest/OFL.txt "
            "f37829b761424ae50832a914934a1239296d51b01d489155044daea7b5e20475 != "
            "071195d8806e226faeee60259c28ca67b458227af5195a73f5cfcab06e3003bc"
        ),
    ]


def test_dependency_license_checker_and_notices_cover_required_inventory() -> None:
    checker = BACKEND_ROOT / "scripts/check_dependency_licenses.py"
    notices = REPO_ROOT / "docs/THIRD_PARTY_NOTICES.md"

    assert checker.is_file()
    assert notices.is_file()

    notice_text = notices.read_text(encoding="utf-8").casefold()
    required = (
        set(policy.locked_requirements(BACKEND_ROOT / "requirements.lock"))
        | set(policy.requirements(BACKEND_ROOT / "requirements-dev.txt"))
        | {
            canonicalize_name(name)
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
