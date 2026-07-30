from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

from app.services import product_reset_eval as eval_service


APP_SHA = "c4a097eb5cee226c884adadf0ac79958b8a71e53"
PERMISSION_REFERENCE = "codex-thread-019f502e-78c0-7781-aad9-384296db58d9:ext-demo:2026-07-26"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_authorized_demo_template_binds_permission_and_exact_application_sha() -> None:
    evidence_path = _repo_root() / "docs/product-reset/DEMO_EVIDENCE.json"

    assert evidence_path.is_file()

    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))

    assert evidence["schema_version"] == 1
    assert evidence["external_demo"] == {
        "permission_status": "granted",
        "permission_reference": PERMISSION_REFERENCE,
        "status": "passed",
        "app_sha": APP_SHA,
        "deployed_app_sha": APP_SHA,
    }
    assert evidence["checks"] == {
        "redacted_dataset_validation": {
            "status": "passed",
            "dataset_id": "demo_dataset_20260726",
            "report_sha256": "59a1fce6c9d61c1d0374af77bc77063573d7697517e94593b4ee1ddbfafecd73",
        },
        "backup": {
            "status": "passed",
            "artifact_sha256": "22ffc47e0244b969d904d383c3e0994300d17d2de4bc848ab2a5fd59f8f176ba",
        },
        "unauthenticated_request": {"status": "passed", "expected_status": 401},
        "default_credentials": {"status": "passed", "rejected": True},
        "authenticated_story_read": {"status": "passed", "story_id": "story_demo_002"},
        "desktop_viewports": {"1366x768": "passed", "1920x1080": "passed"},
        "captionpanels_latest_scenario": {"status": "passed", "scenario_id": "scenario_demo_002"},
        "untracked_artifacts": {
            "status": "passed",
            "dataset_sha256": "e9d4f8ade030b6d33ceb8a2441b2d87ff3eb32b58577c59cf3684911db8e8be7",
            "screenshots": {
                "1366x768": "6ef50d51dae94ed628779289810a19134ed30e79aed080f282b85f8032d72182",
                "1920x1080": "169bdf0f485de91fc31a2f0cc6a34283b07410130f69bef93cc8b182773d88eb",
            },
        },
    }


def test_recorded_demo_evidence_closes_the_external_final_gate() -> None:
    repo_root = _repo_root()
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )

    errors = eval_service._external_demo_final_errors(result, repo_root)

    assert errors == []


def test_demo_evidence_rejects_a_dataset_path_instead_of_a_redacted_identifier(
    tmp_path: Path,
) -> None:
    repo_root = _repo_root()
    evidence = json.loads(
        (repo_root / "docs/product-reset/DEMO_EVIDENCE.json").read_text(encoding="utf-8")
    )
    evidence["checks"]["redacted_dataset_validation"]["dataset_id"] = "/private/demo.json"
    evidence_path = tmp_path / "docs/product-reset/DEMO_EVIDENCE.json"
    evidence_path.parent.mkdir(parents=True)
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")

    _, errors = eval_service._demo_evidence_schema_errors(tmp_path)

    assert "dataset_id должен быть redacted identifier" in errors


def _passed_demo_evidence() -> dict[str, object]:
    return {
        "schema_version": 1,
        "external_demo": {
            "permission_status": "granted",
            "permission_reference": PERMISSION_REFERENCE,
            "status": "passed",
            "app_sha": APP_SHA,
            "deployed_app_sha": APP_SHA,
        },
        "checks": {
            "redacted_dataset_validation": {
                "status": "passed",
                "dataset_id": "demo_dataset_20260726",
                "report_sha256": "a" * 64,
            },
            "backup": {"status": "passed", "artifact_sha256": "b" * 64},
            "unauthenticated_request": {"status": "passed", "expected_status": 401},
            "default_credentials": {"status": "passed", "rejected": True},
            "authenticated_story_read": {"status": "passed", "story_id": "story_demo_001"},
            "desktop_viewports": {"1366x768": "passed", "1920x1080": "passed"},
            "captionpanels_latest_scenario": {
                "status": "passed",
                "scenario_id": "scenario_demo_001",
            },
            "untracked_artifacts": {
                "status": "passed",
                "dataset_sha256": "c" * 64,
                "screenshots": {"1366x768": "d" * 64, "1920x1080": "e" * 64},
            },
        },
    }


def _write_demo_evidence(repo_root: Path, evidence: dict[str, object]) -> None:
    evidence_path = repo_root / "docs/product-reset/DEMO_EVIDENCE.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")


def _initialize_git_repo(repo_root: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=repo_root, check=True)
    (repo_root / "tracked-control.txt").write_text("different content", encoding="utf-8")
    subprocess.run(["git", "add", "tracked-control.txt"], cwd=repo_root, check=True)


def _passed_final_eval_result() -> dict[str, object]:
    result = json.loads(
        (_repo_root() / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    result["external_demo"] = {
        "permission_status": "granted",
        "status": "passed",
        "app_sha": APP_SHA,
    }
    result["completed_checkpoints"].append("EXT-DEMO")
    result["failed_gates"] = []
    result["hard_gates_passed"] = True
    result["full_eval_passed"] = True
    return result


def test_passed_demo_evidence_can_close_final_eval_without_mutating_cp7(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _initialize_git_repo(tmp_path)
    _write_demo_evidence(tmp_path, _passed_demo_evidence())
    result = _passed_final_eval_result()
    monkeypatch.setattr(
        eval_service,
        "_all_local_checkpoint_results_valid",
        lambda _document, _repo_root: True,
    )

    assert result["local_hard_gates_passed"] is True
    assert result["hard_gates_passed"] is True
    assert result["full_eval_passed"] is True
    assert result["failed_gates"] == []
    assert eval_service._cp7_schema_errors(result) == []
    assert eval_service._external_demo_final_errors(result, tmp_path) == []
    assert eval_service.compute_full_eval_passed(result, repo_root=tmp_path) is True
    assert eval_service.evaluate_verification(result, scope="final", repo_root=tmp_path).passed is True


@pytest.mark.parametrize(
    ("path", "invalid_value", "expected_error"),
    [
        (("external_demo", "deployed_app_sha"), None, "exact deployed SHA"),
        (("checks", "redacted_dataset_validation", "dataset_id"), None, "dataset_id"),
        (("checks", "redacted_dataset_validation", "report_sha256"), None, "report_sha256"),
        (("checks", "backup", "artifact_sha256"), None, "artifact_sha256"),
        (("checks", "unauthenticated_request", "expected_status"), 200, "ожидать 401"),
        (("checks", "default_credentials", "rejected"), False, "rejected"),
        (("checks", "authenticated_story_read", "story_id"), None, "story_id"),
        (("checks", "desktop_viewports", "1366x768"), "pending", "desktop_viewports"),
        (("checks", "desktop_viewports", "1920x1080"), "pending", "desktop_viewports"),
        (("checks", "captionpanels_latest_scenario", "scenario_id"), None, "scenario_id"),
        (("checks", "untracked_artifacts", "status"), "pending", "untracked_artifacts"),
        (("checks", "untracked_artifacts", "dataset_sha256"), None, "dataset_sha256"),
        (("checks", "untracked_artifacts", "screenshots", "1366x768"), None, "1366x768"),
        (("checks", "untracked_artifacts", "screenshots", "1920x1080"), None, "1920x1080"),
    ],
)
def test_passed_demo_evidence_rejects_incomplete_external_gate(
    tmp_path: Path,
    path: tuple[str, ...],
    invalid_value: object,
    expected_error: str,
) -> None:
    evidence = copy.deepcopy(_passed_demo_evidence())
    target: dict[str, object] = evidence
    for key in path[:-1]:
        target = target[key]  # type: ignore[assignment,index]
    target[path[-1]] = invalid_value
    _write_demo_evidence(tmp_path, evidence)

    errors = eval_service._external_demo_final_errors(_passed_final_eval_result(), tmp_path)

    assert any(expected_error in error for error in errors)


def test_final_demo_rejects_a_tracked_file_with_declared_artifact_hash(
    tmp_path: Path,
) -> None:
    _initialize_git_repo(tmp_path)
    artifact_content = b"external demo dataset bytes"
    tracked_artifact = tmp_path / "tracked-artifact.bin"
    tracked_artifact.write_bytes(artifact_content)
    subprocess.run(["git", "add", "tracked-artifact.bin"], cwd=tmp_path, check=True)
    evidence = _passed_demo_evidence()
    evidence["checks"]["untracked_artifacts"]["dataset_sha256"] = hashlib.sha256(
        artifact_content
    ).hexdigest()
    _write_demo_evidence(tmp_path, evidence)

    errors = eval_service._external_demo_final_errors(_passed_final_eval_result(), tmp_path)

    assert "untracked artifact hash совпадает с Git-tracked file" in errors


def test_final_demo_uses_staged_blob_when_worktree_bytes_change(
    tmp_path: Path,
) -> None:
    _initialize_git_repo(tmp_path)
    staged_content = b"staged external demo screenshot bytes"
    tracked_artifact = tmp_path / "tracked-artifact.bin"
    tracked_artifact.write_bytes(staged_content)
    subprocess.run(["git", "add", "tracked-artifact.bin"], cwd=tmp_path, check=True)
    tracked_artifact.write_bytes(b"different untracked worktree bytes")
    evidence = _passed_demo_evidence()
    evidence["checks"]["untracked_artifacts"]["screenshots"]["1366x768"] = (
        hashlib.sha256(staged_content).hexdigest()
    )
    _write_demo_evidence(tmp_path, evidence)

    errors = eval_service._external_demo_final_errors(_passed_final_eval_result(), tmp_path)

    assert "untracked artifact hash совпадает с Git-tracked file" in errors


def test_final_demo_ignores_matching_untracked_worktree_bytes(
    tmp_path: Path,
) -> None:
    _initialize_git_repo(tmp_path)
    untracked_content = b"untracked external demo screenshot bytes"
    (tmp_path / "untracked-artifact.bin").write_bytes(untracked_content)
    evidence = _passed_demo_evidence()
    evidence["checks"]["untracked_artifacts"]["screenshots"]["1920x1080"] = (
        hashlib.sha256(untracked_content).hexdigest()
    )
    _write_demo_evidence(tmp_path, evidence)

    assert eval_service._external_demo_final_errors(_passed_final_eval_result(), tmp_path) == []


def test_final_demo_uses_head_blob_when_stage_zero_has_replacement(
    tmp_path: Path,
) -> None:
    _initialize_git_repo(tmp_path)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=tmp_path, check=True)
    committed_content = b"committed external demo dataset bytes"
    tracked_artifact = tmp_path / "tracked-artifact.bin"
    tracked_artifact.write_bytes(committed_content)
    subprocess.run(["git", "add", "tracked-artifact.bin"], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-qm", "test blob"], cwd=tmp_path, check=True)
    tracked_artifact.write_bytes(b"replacement staged bytes")
    subprocess.run(["git", "add", "tracked-artifact.bin"], cwd=tmp_path, check=True)
    evidence = _passed_demo_evidence()
    evidence["checks"]["untracked_artifacts"]["dataset_sha256"] = hashlib.sha256(
        committed_content
    ).hexdigest()
    _write_demo_evidence(tmp_path, evidence)

    errors = eval_service._external_demo_final_errors(_passed_final_eval_result(), tmp_path)

    assert "untracked artifact hash совпадает с Git-tracked file" in errors
