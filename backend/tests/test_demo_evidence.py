from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

from app.services import product_reset_eval as eval_service


APP_SHA = "35cd8902258587e77a36e0885ee5b8f6db0154db"
RELEASE_TAG = "v1.0.1"
VERIFIED_AT = "2026-07-31T00:15:58Z"
PUBLIC_URL = "https://ncastnav.ru"
PERMISSION_REFERENCE = (
    "codex-thread-019f502e-78c0-7781-aad9-384296db58d9:"
    "v1.0.1-production-deploy:2026-07-30"
)


@pytest.fixture(autouse=True)
def _bind_release_history_for_isolated_repositories(
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if "tmp_path" not in request.fixturenames:
        return
    original_commit_exists = eval_service._git_commit_exists
    original_tag_target = eval_service._git_tag_target
    monkeypatch.setattr(
        eval_service,
        "_git_commit_exists",
        lambda repo_root, sha: (
            True if sha == APP_SHA else original_commit_exists(repo_root, sha)
        ),
    )
    monkeypatch.setattr(
        eval_service,
        "_git_tag_target",
        lambda repo_root, tag: (
            APP_SHA if tag == RELEASE_TAG else original_tag_target(repo_root, tag)
        ),
    )


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_authorized_demo_template_binds_permission_and_exact_application_sha() -> None:
    evidence_path = _repo_root() / "docs/product-reset/DEMO_EVIDENCE.json"

    assert evidence_path.is_file()

    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))

    assert evidence["schema_version"] == 2
    assert evidence["external_demo"] == {
        "permission_status": "granted",
        "permission_reference": PERMISSION_REFERENCE,
        "status": "passed",
        "app_sha": APP_SHA,
        "deployed_app_sha": APP_SHA,
        "release_tag": RELEASE_TAG,
        "verified_at": VERIFIED_AT,
        "public_url": PUBLIC_URL,
    }
    assert evidence["checks"] == {
        "redacted_dataset_validation": {
            "status": "passed",
            "dataset_id": "demo_dataset_20260726",
            "report_sha256": "59a1fce6c9d61c1d0374af77bc77063573d7697517e94593b4ee1ddbfafecd73",
        },
        "backup": {
            "status": "passed",
            "artifact_sha256": "835340d2a767cacacf91db70f7b7e15d7ba079a2f7665def716a17f1ff2c4f76",
            "restore_list_valid": True,
        },
        "public_health": {"status": "passed", "expected_status": 200},
        "unauthenticated_request": {"status": "passed", "expected_status": 401},
        "default_credentials": {"status": "passed", "rejected": True},
        "authenticated_story_read": {"status": "passed", "story_id": "story_demo_002"},
        "desktop_viewports": {"1366x768": "passed", "1920x1080": "passed"},
        "captionpanels_latest_scenario": {"status": "passed", "scenario_id": "scenario_demo_002"},
        "cache_policy": {
            "status": "passed",
            "html_revalidated": True,
            "hashed_asset_immutable": True,
            "missing_asset_status": 404,
            "missing_asset_no_store": True,
        },
        "admin_user_management": {
            "status": "passed",
            "existing_admin_authenticated": True,
            "admin_password_hash_preserved": True,
            "rename_login": True,
            "delete_unused": True,
            "delete_self_rejected": True,
            "temporary_users_removed": True,
        },
        "runtime_continuity": {
            "status": "passed",
            "database_container_preserved": True,
            "gateway_container_preserved": True,
            "rollback_ready": True,
        },
        "untracked_artifacts": {
            "status": "passed",
            "artifact_count": 3,
            "dataset_sha256": "e9d4f8ade030b6d33ceb8a2441b2d87ff3eb32b58577c59cf3684911db8e8be7",
            "screenshots": {
                "1366x768": "60a937412ea7c4183f6f09480631fcb96d6b6893e1751e68a545a9d2e7bcadd2",
                "1920x1080": "d5df12492b285526285982d9a95f2d81edf0297e8720513642b25ab9efaa3ae2",
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
        "schema_version": 2,
        "external_demo": {
            "permission_status": "granted",
            "permission_reference": PERMISSION_REFERENCE,
            "status": "passed",
            "app_sha": APP_SHA,
            "deployed_app_sha": APP_SHA,
            "release_tag": RELEASE_TAG,
            "verified_at": VERIFIED_AT,
            "public_url": PUBLIC_URL,
        },
        "checks": {
            "redacted_dataset_validation": {
                "status": "passed",
                "dataset_id": "demo_dataset_20260726",
                "report_sha256": "a" * 64,
            },
            "backup": {
                "status": "passed",
                "artifact_sha256": "b" * 64,
                "restore_list_valid": True,
            },
            "public_health": {"status": "passed", "expected_status": 200},
            "unauthenticated_request": {"status": "passed", "expected_status": 401},
            "default_credentials": {"status": "passed", "rejected": True},
            "authenticated_story_read": {"status": "passed", "story_id": "story_demo_001"},
            "desktop_viewports": {"1366x768": "passed", "1920x1080": "passed"},
            "captionpanels_latest_scenario": {
                "status": "passed",
                "scenario_id": "scenario_demo_001",
            },
            "cache_policy": {
                "status": "passed",
                "html_revalidated": True,
                "hashed_asset_immutable": True,
                "missing_asset_status": 404,
                "missing_asset_no_store": True,
            },
            "admin_user_management": {
                "status": "passed",
                "existing_admin_authenticated": True,
                "admin_password_hash_preserved": True,
                "rename_login": True,
                "delete_unused": True,
                "delete_self_rejected": True,
                "temporary_users_removed": True,
            },
            "runtime_continuity": {
                "status": "passed",
                "database_container_preserved": True,
                "gateway_container_preserved": True,
                "rollback_ready": True,
            },
            "untracked_artifacts": {
                "status": "passed",
                "artifact_count": 3,
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
        (("schema_version",), 2.0, "schema_version"),
        (("external_demo", "deployed_app_sha"), None, "exact deployed SHA"),
        (("external_demo", "release_tag"), "v1.0.0", "release_tag"),
        (("external_demo", "verified_at"), "2026-99-99T99:99:99Z", "verified_at"),
        (("external_demo", "public_url"), "http://127.0.0.1", "public_url"),
        (("checks", "redacted_dataset_validation", "dataset_id"), None, "dataset_id"),
        (("checks", "redacted_dataset_validation", "report_sha256"), None, "report_sha256"),
        (("checks", "backup", "artifact_sha256"), None, "artifact_sha256"),
        (("checks", "backup", "restore_list_valid"), False, "restore_list_valid"),
        (("checks", "public_health", "expected_status"), 503, "public_health"),
        (("checks", "public_health", "expected_status"), 200.0, "public_health"),
        (("checks", "unauthenticated_request", "expected_status"), 200, "ожидать 401"),
        (("checks", "default_credentials", "rejected"), False, "rejected"),
        (("checks", "authenticated_story_read", "story_id"), None, "story_id"),
        (("checks", "desktop_viewports", "1366x768"), "pending", "desktop_viewports"),
        (("checks", "desktop_viewports", "1920x1080"), "pending", "desktop_viewports"),
        (("checks", "captionpanels_latest_scenario", "scenario_id"), None, "scenario_id"),
        (("checks", "cache_policy", "html_revalidated"), False, "cache_policy"),
        (("checks", "cache_policy", "missing_asset_status"), 404.0, "cache_policy"),
        (
            ("checks", "admin_user_management", "admin_password_hash_preserved"),
            False,
            "admin_user_management",
        ),
        (
            ("checks", "admin_user_management", "admin_password_hash_preserved"),
            1,
            "admin_user_management",
        ),
        (
            ("checks", "runtime_continuity", "database_container_preserved"),
            False,
            "runtime_continuity",
        ),
        (("checks", "untracked_artifacts", "status"), "pending", "untracked_artifacts"),
        (("checks", "untracked_artifacts", "artifact_count"), 2, "artifact_count"),
        (("checks", "untracked_artifacts", "artifact_count"), 3.0, "artifact_count"),
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


def test_final_demo_fails_closed_when_deployed_sha_is_unavailable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_demo_evidence(tmp_path, _passed_demo_evidence())
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: False)

    errors = eval_service._external_demo_final_errors(
        _passed_final_eval_result(),
        tmp_path,
    )

    assert f"deployed SHA {APP_SHA} недоступен в Git истории" in errors


def test_final_demo_fails_closed_when_release_tag_does_not_match(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_demo_evidence(tmp_path, _passed_demo_evidence())
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_git_tag_target", lambda *_args: "0" * 40)

    errors = eval_service._external_demo_final_errors(
        _passed_final_eval_result(),
        tmp_path,
    )

    assert f"release tag {RELEASE_TAG} не указывает на exact deployed SHA" in errors


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
