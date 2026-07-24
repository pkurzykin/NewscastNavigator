from __future__ import annotations

import json
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]

REQUIRED_SKELETON_PATHS = {
    "docs/product-reset/PROGRESS.md",
    "docs/product-reset/EVAL_RESULT.json",
    "docs/product-reset/EVAL_COMMANDS.json",
    "docs/product-reset/RISK_REGISTER_RU.md",
    "docs/product-reset/ARCHITECTURE_INVENTORY_RU.md",
    "docs/product-reset/OPERATIONS_INVENTORY_RU.md",
    "docs/product-reset/LEGACY_DENYLIST.txt",
    "backend/app/services/product_reset_eval.py",
    "backend/scripts/product_reset_eval.py",
    "compose.test.yaml",
}

ALLOWED_UNTIL_CP3: set[str] = set()

REMOVED_CP2_LEGACY_PATHS = {
    "backend/app/api/routes/projects.py",
    "backend/app/api/routes/revisions.py",
    "backend/app/api/routes/workspace.py",
    "backend/app/api/routes/exports.py",
    "backend/app/schemas/project.py",
    "backend/app/schemas/project_text_state.py",
    "backend/app/schemas/revisions.py",
    "backend/app/schemas/workspace.py",
    "backend/app/schemas/story_exchange.py",
    "backend/app/services/export_service.py",
    "backend/tests/test_api_smoke.py",
}

REQUIRED_OPERATIONS_CLASSIFICATIONS = {
    "frontend/nginx.prod.conf": "ADAPT",
    "docs/DEPLOYMENT_UBUNTU_RU.md": "ADAPT",
    "docs/LEGACY_DATA_MIGRATION_RU.md": "DELETE",
    "docs/WEB_SMOKE_CHECKLIST_RU.md": "ADAPT",
    "backend/tests/fixtures/synthetic_demo_contract.json": "KEEP",
    "backend/tests/synthetic_data_policy.py": "KEEP",
    "backend/tests/test_demo_seed_policy.py": "KEEP",
}


def _denylist_sections(path: Path) -> dict[str, set[str]]:
    sections: dict[str, set[str]] = {}
    current: set[str] | None = None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            current = sections.setdefault(line[1:-1], set())
            continue
        assert current is not None, f"denylist entry outside section: {line}"
        current.add(line)
    return sections


def _operations_inventory_classifications(path: Path) -> dict[str, str]:
    classifications: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        cells = [cell.strip() for cell in raw_line.strip().strip("|").split("|")]
        if len(cells) != 3 or not cells[0].startswith("`") or not cells[0].endswith("`"):
            continue
        classifications[cells[0].strip("`")] = cells[1]
    return classifications


def test_product_reset_skeleton_paths_exist() -> None:
    missing = sorted(path for path in REQUIRED_SKELETON_PATHS if not (REPO_ROOT / path).is_file())
    assert missing == []


def test_eval_documents_have_machine_readable_schema() -> None:
    result = json.loads((REPO_ROOT / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8"))
    commands = json.loads((REPO_ROOT / "docs/product-reset/EVAL_COMMANDS.json").read_text(encoding="utf-8"))

    assert result["schema_version"] == 1
    assert {
        "ANALYZED_PRODUCT_BASE_SHA",
        "IMPLEMENTATION_BASE_SHA",
        "commit",
        "checkpoint",
        "completed_checkpoints",
        "checkpoint_results",
        "local_hard_gates_passed",
        "hard_gates_passed",
        "full_eval_passed",
        "failed_gates",
    } <= result.keys()
    assert isinstance(result["checkpoint_results"], dict)
    assert isinstance(result["failed_gates"], list)
    assert all(isinstance(result[field], bool) for field in (
        "local_hard_gates_passed",
        "hard_gates_passed",
        "full_eval_passed",
    ))
    assert commands["schema_version"] == 2
    assert isinstance(commands["commands"], list)
    assert commands["commands"]
    command_ids: list[str] = []
    for command in commands["commands"]:
        assert {"id", "execution_group", "scope", "command", "expected_exit_code"} <= command.keys()
        assert command["execution_group"] in {"cp1_runner", "cp7_ux", "meta"}
        assert command["scope"] in {"checkpoint", "final"}
        if command["scope"] == "checkpoint":
            assert isinstance(command.get("checkpoint"), str)
        else:
            assert command.get("checkpoint") is None
        assert isinstance(command["expected_exit_code"], int)
        assert not isinstance(command["expected_exit_code"], bool)
        assert isinstance(command["command"], str) and command["command"].strip()
        command_ids.append(command["id"])
    assert len(command_ids) == len(set(command_ids))


def test_legacy_denylist_forbids_bridge_after_cp3_transition() -> None:
    sections = _denylist_sections(REPO_ROOT / "docs/product-reset/LEGACY_DENYLIST.txt")

    assert set(sections) == {"forbidden_now", "allowed_until_cp3", "test_evidence_only"}
    assert sections["forbidden_now"]
    assert sections["allowed_until_cp3"] == ALLOWED_UNTIL_CP3
    assert {
        "backend/app/api/routes/editor.py",
        "backend/app/schemas/editor.py",
        "frontend/src/pages/EditorPage.tsx",
        "frontend/src/features/scenario/legacyBridgeApi.ts",
        "frontend/src/features/scenario/legacyBridgeTypes.ts",
    } <= sections["forbidden_now"]
    assert sections["test_evidence_only"]


def test_cp2_project_runtime_paths_are_physically_removed() -> None:
    removed = set(REMOVED_CP2_LEGACY_PATHS)
    removed.update(
        path.relative_to(REPO_ROOT).as_posix()
        for path in (REPO_ROOT / "backend/app/services").glob("project_*.py")
    )
    assert all(not (REPO_ROOT / path).exists() for path in removed)


def test_product_reset_artifacts_are_ignored() -> None:
    gitignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "artifacts/product-reset/" in gitignore


def test_operations_inventory_classifies_all_cp1_operational_artifacts() -> None:
    classifications = _operations_inventory_classifications(
        REPO_ROOT / "docs/product-reset/OPERATIONS_INVENTORY_RU.md"
    )

    assert {
        path: classifications.get(path)
        for path in REQUIRED_OPERATIONS_CLASSIFICATIONS
    } == REQUIRED_OPERATIONS_CLASSIFICATIONS


def test_ci_runs_isolated_product_reset_checks() -> None:
    workflow = yaml.safe_load((REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"))
    backend_steps = workflow["jobs"]["backend"]["steps"]
    run_commands = [step["run"] for step in backend_steps if step.get("run")]

    focused_commands = [
        command
        for command in run_commands
        if "compose.test.yaml" in command
        and "tests/test_product_reset_eval.py" in command
        and "tests/test_repository_policy.py" in command
    ]
    cleanup_steps = [
        step
        for step in backend_steps
        if step.get("run")
        and "compose.test.yaml" in step["run"]
        and "down -v" in step["run"]
    ]

    assert focused_commands
    assert cleanup_steps
    assert any(step.get("if") in {"always()", "${{ always() }}"} for step in cleanup_steps)
