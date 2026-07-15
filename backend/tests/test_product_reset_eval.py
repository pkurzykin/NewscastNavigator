from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path

import pytest

from app.services import product_reset_eval as eval_service
from app.services.product_reset_eval import (
    ANALYZED_PRODUCT_BASE_SHA,
    CP1_REQUIRED_COMMANDS,
    IMPLEMENTATION_BASE_SHA,
    compute_full_eval_passed,
    evaluate_verification,
    load_eval_result,
    run_checkpoint,
)


def _valid_cp1_evidence() -> dict[str, object]:
    return {
        "schema_version": 1,
        "bases": {
            "analyzed_product_base_sha": ANALYZED_PRODUCT_BASE_SHA,
            "implementation_base_sha": IMPLEMENTATION_BASE_SHA,
        },
        "checkpoint_commits": {
            "commit_1_1": "94dab351d3c12e2cf670c0bcce2ccc3a87823677",
            "commit_1_2": "58eb74672859b42a8eab000e976c16f079aeb520",
            "commit_1_3": "5b5c5e8f40cb05d9b0a03d7c4eecf805f22bc930",
            "commit_1_4": "791ad373bce6d3388e4645fb0e9ad13d605f45de",
        },
        "eval_and_repository_policy": {
            "outcome": "automated_pass",
            "tests": [
                "backend/tests/test_product_reset_eval.py",
                "backend/tests/test_repository_policy.py",
            ],
            "compose_harness": "compose.test.yaml",
        },
        "frontend_component_harness": {
            "outcome": "automated_pass",
            "runner": "vitest",
            "config": "frontend/vitest.config.ts",
            "round_trip_test": "frontend/src/features/editor-core/serializers.test.ts",
        },
        "browser_harness": {
            "outcome": "automated_pass",
            "runner": "playwright",
            "config": "frontend/playwright.config.ts",
            "desktop_projects": ["chromium-1366", "chromium-1920"],
        },
        "characterization": {
            "backend_editor": {
                "outcome": "automated_pass",
                "test": "backend/tests/characterization/test_editor_contract.py",
            },
            "frontend_editor": {
                "outcome": "automated_pass",
                "component_test": "frontend/src/pages/__tests__/EditorPage.characterization.test.tsx",
                "browser_test": "frontend/e2e/editor-characterization.spec.ts",
            },
            "captionpanels": {
                "outcome": "automated_pass",
                "test": "backend/tests/characterization/test_captionpanels_contract.py",
            },
        },
        "autosave_known_failures": [
            {
                "id": "stale_suffix_loss",
                "outcome": "deterministic_expected_failure",
                "component_test": (
                    "frontend/src/pages/__tests__/EditorPage.autosave.known-failures.test.tsx"
                ),
                "browser_test": "frontend/e2e/editor-autosave-known-failures.spec.ts",
                "expected_text": "Базовый текст до запроса после запроса",
                "observed_text": "Базовый текст до запроса",
            },
            {
                "id": "autosave_layout_movement",
                "outcome": "deterministic_expected_failure",
                "browser_test": "frontend/e2e/editor-autosave-known-failures.spec.ts",
                "metric": "save_status_width_delta_px",
                "observed": 2.5,
                "required_max": 1,
                "assertion": "observed <= required_max",
            },
        ],
        "synthetic_fixture": {
            "outcome": "automated_pass",
            "contract": "backend/tests/fixtures/synthetic_demo_contract.json",
            "validator": "backend/tests/synthetic_data_policy.py",
            "test": "backend/tests/test_demo_seed_policy.py",
        },
        "runtime_editor": {"paths": list(eval_service.CP1_RUNTIME_PATHS)},
        "commands": [
            {
                "id": command_id,
                "command": command,
                "exit_code": 0,
                "count": 1,
                "outcome": "automated_pass",
                "reproducibility": {
                    "runner": "product_reset_eval.py",
                    "evaluated_commit": IMPLEMENTATION_BASE_SHA,
                    "command_sha256": eval_service._sha256_text(command),
                    "output_sha256": "0" * 64,
                    "summary": "count=1",
                    "duration_ms": 0,
                },
            }
            for command_id, command in CP1_REQUIRED_COMMANDS.items()
        ],
    }


def _valid_cp2_evidence() -> dict[str, object]:
    return {
        "schema_version": 1,
        "baseline_migration": {
            "outcome": "automated_pass",
            "path": "backend/migrations/versions/20260710_0001_product_reset.py",
            "revision": "20260710_0001",
            "test": "backend/tests/test_migration_baseline.py",
        },
        "synthetic_demo_seed": {
            "outcome": "automated_pass",
            "service": "backend/app/services/demo_seed.py",
            "test": "backend/tests/test_demo_seed_policy.py",
            "users": 8,
            "active_stories": 30,
            "archived_stories": 5,
        },
        "clean_schema": {
            "outcome": "automated_pass",
            "test": "backend/tests/test_migration_baseline.py",
            "empty_database_upgrade": "alembic upgrade head",
        },
        "permitted_editor_bridges": [
            {
                "id": "story_editor_compatibility_bridge",
                "outcome": "automated_pass",
                "test": "backend/tests/test_cp2_editor_bridge.py",
                "paths": list(eval_service.CP2_BRIDGE_PATHS),
            }
        ],
        "commands": [],
    }


CP3_EXPECTED_COMMANDS = {
    "backend-full-suite": "cd backend && ./.venv/bin/pytest -q",
    "frontend-full-suite": "cd frontend && npm test -- --run",
    "frontend-production-build": "cd frontend && npm run build",
    "browser-scenario-history-chromium-1366": (
        "cd frontend && npx playwright test scenario-autosave.spec.ts "
        "story-history.spec.ts --project=chromium-1366"
    ),
    "browser-scenario-chromium-1920": (
        "cd frontend && npx playwright test scenario-autosave.spec.ts "
        "--project=chromium-1920"
    ),
}


def _valid_cp3_evidence(evaluated_commit: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        "scenario_backend": {
            "outcome": "automated_pass",
            "contracts": [
                "ack_only_save",
                "client_generated_seg_uuid",
                "immutable_revisions",
                "idempotent_retry",
                "owner_lease_90_seconds",
            ],
            "sources": [
                "backend/app/api/routes/scenario.py",
                "backend/app/schemas/scenario.py",
                "backend/app/services/scenario_service.py",
                "backend/app/services/scenario_sessions.py",
                "backend/app/services/scenario_serialization.py",
            ],
            "tests": [
                "backend/tests/test_scenario_autosave.py",
                "backend/tests/test_scenario_lease.py",
            ],
        },
        "autosave": {
            "outcome": "automated_pass",
            "contracts": [
                "local_authoritative_rows",
                "single_flight_latest_snapshot",
                "stable_identity_before_first_save",
                "preserve_input_draft_focus_selection_scroll_layout",
                "retry_recovery_without_text_loss",
            ],
            "sources": [
                "frontend/src/features/scenario/api.ts",
                "frontend/src/features/scenario/types.ts",
                "frontend/src/features/scenario/rowIdentity.ts",
                "frontend/src/features/scenario/draftStorage.ts",
                "frontend/src/features/scenario/useScenarioAutosave.ts",
                "frontend/src/features/scenario/useEditLease.ts",
                "frontend/src/features/scenario/components/ScenarioEditor.tsx",
                "frontend/src/features/scenario/components/ScenarioRow.tsx",
                "frontend/src/features/scenario/components/AutosaveStatus.tsx",
                "frontend/src/features/scenario/components/EditLeaseNotice.tsx",
            ],
            "tests": [
                "frontend/src/features/scenario/useScenarioAutosave.test.tsx",
                "frontend/src/features/scenario/ScenarioEditor.autosave.test.tsx",
                "frontend/src/features/scenario/components/AutosaveStatus.test.tsx",
            ],
            "browser_specs": ["frontend/e2e/scenario-autosave.spec.ts"],
        },
        "session_history": {
            "outcome": "automated_pass",
            "contracts": [
                "one_entry_per_edit_session",
                "persisted_semantic_diff",
                "hide_noop_sessions",
                "leadership_restore_is_append_only",
            ],
            "sources": [
                "backend/app/api/routes/history.py",
                "backend/app/schemas/history.py",
                "backend/app/services/scenario_history.py",
                "backend/app/services/scenario_diff.py",
                "frontend/src/features/history/api.ts",
                "frontend/src/features/history/types.ts",
                "frontend/src/features/history/components/HistoryTimeline.tsx",
                "frontend/src/features/history/components/ScenarioSessionDiff.tsx",
                "frontend/src/features/history/components/RestoreScenarioDialog.tsx",
                "frontend/src/pages/StoryHistoryPage.tsx",
            ],
            "tests": [
                "backend/tests/test_story_history_api.py",
                "backend/tests/test_scenario_diff.py",
                "frontend/src/features/history/HistoryTimeline.test.tsx",
            ],
            "browser_specs": ["frontend/e2e/story-history.spec.ts"],
        },
        "captionpanels": {
            "outcome": "automated_pass",
            "contracts": [
                "always_latest_scenario",
                "stable_mapping_without_text_seq",
                "exact_user_context_opened_marker",
                "server_derived_changed_since_status",
            ],
            "sources": [
                "backend/app/api/routes/captionpanels.py",
                "backend/app/schemas/captionpanels_import.py",
                "backend/app/schemas/captionpanels_integration.py",
                "backend/app/services/captionpanels_export.py",
                "frontend/src/features/scenario/components/CaptionPanelsStatus.tsx",
            ],
            "tests": [
                "backend/tests/test_captionpanels_current_scenario.py",
                "frontend/src/features/scenario/components/CaptionPanelsStatus.test.tsx",
            ],
        },
        "legacy_removal": {
            "outcome": "automated_pass",
            "contracts": [
                "old_editor_get_put_404",
                "runtime_bridge_physically_absent",
            ],
            "denylist": "docs/product-reset/LEGACY_DENYLIST.txt",
            "allowed_until_cp3": [],
            "removed_bridge_paths": [
                "backend/app/api/routes/editor.py",
                "backend/app/schemas/editor.py",
                "frontend/src/pages/EditorPage.tsx",
                "frontend/src/features/scenario/legacyBridgeApi.ts",
                "frontend/src/features/scenario/legacyBridgeTypes.ts",
            ],
            "tests": [
                "backend/tests/test_legacy_gate.py",
                "backend/tests/test_repository_policy.py",
            ],
        },
        "commands": [
            {
                "id": command_id,
                "command": command,
                "exit_code": 0,
                "count": 1,
                "outcome": "automated_pass",
                "reproducibility": {
                    "runner": "product_reset_eval.py",
                    "evaluated_commit": evaluated_commit,
                    "command_sha256": eval_service._sha256_text(command),
                    "output_sha256": "0" * 64,
                    "summary": "успешно; количество=1",
                    "duration_ms": 0,
                },
            }
            for command_id, command in CP3_EXPECTED_COMMANDS.items()
        ],
    }


def _cp3_checkpoint_result(*, evaluated_commit: str) -> dict[str, object]:
    result = _checkpoint_only_result()
    result["commit"] = evaluated_commit
    result["checkpoint"] = "CP3"
    result["completed_checkpoints"] = ["CP1", "CP3"]
    result["failed_gates"] = ["CP2", "CP4", "CP5", "CP6", "CP7", "external_demo"]
    result["checkpoint_results"]["CP3"] = {
        "passed": True,
        "missing": [],
        "evaluated_commit": evaluated_commit,
        "evidence": _valid_cp3_evidence(evaluated_commit),
    }
    return result


def _checkpoint_only_result() -> dict[str, object]:
    return {
        "schema_version": 1,
        "ANALYZED_PRODUCT_BASE_SHA": ANALYZED_PRODUCT_BASE_SHA,
        "IMPLEMENTATION_BASE_SHA": IMPLEMENTATION_BASE_SHA,
        "commit": IMPLEMENTATION_BASE_SHA,
        "checkpoint": "CP1",
        "completed_checkpoints": ["CP1"],
        "checkpoint_results": {
            "CP1": {
                "passed": True,
                "missing": [],
                "evaluated_commit": IMPLEMENTATION_BASE_SHA,
                "evidence": _valid_cp1_evidence(),
            }
        },
        "local_hard_gates_passed": False,
        "hard_gates_passed": False,
        "failed_gates": ["CP2", "CP3", "CP4", "CP5", "CP6", "CP7", "external_demo"],
        "ux_total": 0,
        "ux_categories": {},
        "legacy_findings": [],
        "operations_findings": [],
        "external_demo": {
            "permission_status": "not_granted",
            "status": "blocked_permission",
            "app_sha": None,
        },
        "full_eval_passed": False,
        "largest_remaining_risk": "Autosave regressions are not fixed yet.",
        "next_action": "Continue with CP2.",
    }


def _cp2_checkpoint_result(*, evaluated_commit: str | None) -> dict[str, object]:
    return {
        "passed": False,
        "missing": ["command evidence is pending"],
        "evaluated_commit": evaluated_commit,
        "evidence": _valid_cp2_evidence(),
    }


def test_checkpoint_verification_is_separate_from_final_verification() -> None:
    result = _checkpoint_only_result()

    checkpoint = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")
    final = evaluate_verification(result, scope="final")

    assert checkpoint.passed is True
    assert final.passed is False
    assert "full_eval_passed имеет значение false" in final.errors


@pytest.mark.parametrize("missing_field", ["ANALYZED_PRODUCT_BASE_SHA", "IMPLEMENTATION_BASE_SHA"])
def test_baseline_sha_fields_are_mandatory(tmp_path: Path, missing_field: str) -> None:
    result = _checkpoint_only_result()
    result.pop(missing_field)
    result_path = tmp_path / "EVAL_RESULT.json"
    result_path.write_text(json.dumps(result), encoding="utf-8")

    with pytest.raises(ValueError, match=missing_field):
        load_eval_result(result_path)


def test_full_eval_passed_cannot_be_forced_manually() -> None:
    result = _checkpoint_only_result()
    result["full_eval_passed"] = True

    verification = evaluate_verification(result, scope="final")

    assert verification.passed is False
    assert "full_eval_passed не соответствует вычисленному финальному состоянию" in verification.errors


@pytest.mark.parametrize("invalid_total", ["90", True, None])
def test_ux_total_must_be_numeric(invalid_total: object) -> None:
    result = _checkpoint_only_result()
    result["ux_categories"] = {f"category-{index}": 9 for index in range(10)}
    result["ux_total"] = invalid_total

    assert compute_full_eval_passed(result) is False


def test_ux_total_must_equal_category_sum() -> None:
    result = _checkpoint_only_result()
    result["ux_categories"] = {f"category-{index}": 9 for index in range(10)}
    result["ux_total"] = 91

    assert compute_full_eval_passed(result) is False


def test_malformed_completed_checkpoints_is_a_controlled_failure() -> None:
    result = _checkpoint_only_result()
    result["completed_checkpoints"] = ["CP1", {"not": "a checkpoint"}]

    assert compute_full_eval_passed(result) is False
    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")
    assert verification.passed is False
    assert "completed_checkpoints должен содержать только строки" in verification.errors


def test_checkpoint_verification_rejects_unknown_checkpoint() -> None:
    result = _checkpoint_only_result()
    result["completed_checkpoints"] = ["CP404"]

    with pytest.raises(ValueError, match="CP404"):
        evaluate_verification(result, scope="checkpoint", checkpoint="CP404")


def test_checkpoint_run_rejects_unknown_checkpoint(tmp_path: Path) -> None:
    repo_root = tmp_path
    result_dir = repo_root / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(
        json.dumps(_checkpoint_only_result()),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="CP404"):
        run_checkpoint(repo_root, "CP404")


def test_cp1_evidence_requires_harness_characterization_known_failures_and_seed_contract() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )

    cp1 = result["checkpoint_results"]["CP1"]
    evidence = cp1["evidence"]

    assert cp1.get("evaluated_commit") is None or isinstance(cp1["evaluated_commit"], str)
    assert cp1["passed"] is (cp1["missing"] == [])
    assert cp1["missing"] in (
        [],
        ["evidence_commit_binding"],
        ["evidence_command_execution"],
    )
    assert evidence["schema_version"] == 1
    assert evidence["bases"] == {
        "analyzed_product_base_sha": "5129e0bd19976bbf74ab01aeda9c29663cf152da",
        "implementation_base_sha": "a540e47704b26afc02272e6c05e311f48b894f85",
    }
    assert evidence["checkpoint_commits"] == {
        "commit_1_1": "94dab351d3c12e2cf670c0bcce2ccc3a87823677",
        "commit_1_2": "58eb74672859b42a8eab000e976c16f079aeb520",
        "commit_1_3": "5b5c5e8f40cb05d9b0a03d7c4eecf805f22bc930",
        "commit_1_4": "791ad373bce6d3388e4645fb0e9ad13d605f45de",
    }

    assert evidence["eval_and_repository_policy"] == {
        "outcome": "automated_pass",
        "tests": [
            "backend/tests/test_product_reset_eval.py",
            "backend/tests/test_repository_policy.py",
        ],
        "compose_harness": "compose.test.yaml",
    }
    assert evidence["frontend_component_harness"] == {
        "outcome": "automated_pass",
        "runner": "vitest",
        "config": "frontend/vitest.config.ts",
        "round_trip_test": "frontend/src/features/editor-core/serializers.test.ts",
    }
    assert evidence["browser_harness"] == {
        "outcome": "automated_pass",
        "runner": "playwright",
        "config": "frontend/playwright.config.ts",
        "desktop_projects": ["chromium-1366", "chromium-1920"],
    }

    characterization = evidence["characterization"]
    assert characterization == {
        "backend_editor": {
            "outcome": "automated_pass",
            "test": "backend/tests/characterization/test_editor_contract.py",
        },
        "frontend_editor": {
            "outcome": "automated_pass",
            "component_test": "frontend/src/pages/__tests__/EditorPage.characterization.test.tsx",
            "browser_test": "frontend/e2e/editor-characterization.spec.ts",
        },
        "captionpanels": {
            "outcome": "automated_pass",
            "test": "backend/tests/characterization/test_captionpanels_contract.py",
        },
    }

    known_failures = {item["id"]: item for item in evidence["autosave_known_failures"]}
    assert known_failures["stale_suffix_loss"] == {
        "id": "stale_suffix_loss",
        "outcome": "deterministic_expected_failure",
        "component_test": "frontend/src/pages/__tests__/EditorPage.autosave.known-failures.test.tsx",
        "browser_test": "frontend/e2e/editor-autosave-known-failures.spec.ts",
        "expected_text": "Базовый текст до запроса после запроса",
        "observed_text": "Базовый текст до запроса",
    }
    layout = known_failures["autosave_layout_movement"]
    assert layout["outcome"] == "deterministic_expected_failure"
    assert layout["browser_test"] == "frontend/e2e/editor-autosave-known-failures.spec.ts"
    assert layout["metric"] == "save_status_width_delta_px"
    assert layout["assertion"] == "observed <= required_max"
    assert isinstance(layout["observed"], (int, float)) and not isinstance(layout["observed"], bool)
    assert layout["required_max"] == 1
    assert layout["observed"] > layout["required_max"]

    assert evidence["synthetic_fixture"] == {
        "outcome": "automated_pass",
        "contract": "backend/tests/fixtures/synthetic_demo_contract.json",
        "validator": "backend/tests/synthetic_data_policy.py",
        "test": "backend/tests/test_demo_seed_policy.py",
    }
    assert evidence["runtime_editor"] == {
        "paths": [
            "frontend/src/pages/EditorPage.tsx",
            "backend/app/api/routes/editor.py",
            "backend/app/api/routes/captionpanels.py",
        ]
    }

    serialized_evidence = json.dumps(evidence, ensure_ascii=False).casefold()
    for forbidden_marker in ("placeholder", "timeout", "manual"):
        assert forbidden_marker not in serialized_evidence

    evidence_paths = {
        *evidence["eval_and_repository_policy"]["tests"],
        evidence["eval_and_repository_policy"]["compose_harness"],
        evidence["frontend_component_harness"]["config"],
        evidence["frontend_component_harness"]["round_trip_test"],
        evidence["browser_harness"]["config"],
        characterization["backend_editor"]["test"],
        characterization["frontend_editor"]["component_test"],
        characterization["frontend_editor"]["browser_test"],
        characterization["captionpanels"]["test"],
        known_failures["stale_suffix_loss"]["component_test"],
        known_failures["stale_suffix_loss"]["browser_test"],
        evidence["synthetic_fixture"]["contract"],
        evidence["synthetic_fixture"]["validator"],
        evidence["synthetic_fixture"]["test"],
        *evidence["runtime_editor"]["paths"],
    }
    evaluated_commit = cp1["evaluated_commit"]
    assert isinstance(evaluated_commit, str)
    assert all(
        eval_service._git_path_exists_at_commit(repo_root, evaluated_commit, path)
        for path in evidence_paths
    )

    def source_at_evaluated_commit(path: str) -> str:
        return subprocess.run(
            ["git", "show", f"{evaluated_commit}:{path}"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    component_known_failures = source_at_evaluated_commit(known_failures["stale_suffix_loss"]["component_test"])
    browser_known_failures = source_at_evaluated_commit(known_failures["stale_suffix_loss"]["browser_test"])
    synthetic_validator = (
        repo_root / evidence["synthetic_fixture"]["validator"]
    ).read_text(encoding="utf-8")

    assert 'it.fails("keeps typing made after an in-flight snapshot' in component_known_failures
    assert browser_known_failures.count("test.fail(true,") == 2
    assert "stale autosave response does not overwrite typing" in browser_known_failures
    assert "autosave status transition keeps visible geometry" in browser_known_failures
    assert ".toBeLessThanOrEqual(1)" in browser_known_failures
    assert "def validate_synthetic_demo_contract" in synthetic_validator
    assert "def validate_synthetic_demo_data" in synthetic_validator

    assert ("CP1" in result["completed_checkpoints"]) is cp1["passed"]
    assert ("CP1" in result["failed_gates"]) is not cp1["passed"]
    assert result["local_hard_gates_passed"] is False
    assert result["hard_gates_passed"] is False
    assert result["full_eval_passed"] is False


def test_cp2_evidence_requires_one_baseline_actual_synthetic_seed_clean_schema_and_single_bridge() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )

    cp2 = result["checkpoint_results"]["CP2"]
    evidence = cp2["evidence"]

    template = _valid_cp2_evidence()
    for key, value in template.items():
        if key != "commands":
            assert evidence[key] == value
    assert "verification" not in evidence
    assert result["full_eval_passed"] is False

    if cp2["passed"]:
        assert cp2["missing"] == []
        assert isinstance(cp2["evaluated_commit"], str)
        assert {item["id"] for item in evidence["commands"]} == set(
            eval_service.CP2_REQUIRED_COMMANDS
        )
        verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP2")
        assert verification.passed is True
    else:
        assert "CP2" not in result["completed_checkpoints"]
        assert "CP2" in result["failed_gates"]
        if cp2["evaluated_commit"] is None:
            assert cp2["missing"] == ["command_evidence_pending"]
            assert evidence["commands"] == []
        else:
            assert isinstance(cp2["evaluated_commit"], str)
            assert {item["id"] for item in evidence["commands"]} == set(
                eval_service.CP2_REQUIRED_COMMANDS
            )
            assert any(item["outcome"] == "automated_failure" for item in evidence["commands"])


def test_cp2_binding_remains_valid_when_eval_document_moves_to_descendant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    checkpoint_commit = "c" * 40
    descendant_commit = "d" * 40
    result = _checkpoint_only_result()
    result["commit"] = descendant_commit
    result["checkpoint"] = "CP2"
    result["completed_checkpoints"] = ["CP1", "CP2"]
    result["failed_gates"] = ["CP3", "CP4", "CP5", "CP6", "CP7", "external_demo"]
    cp2 = _cp2_checkpoint_result(evaluated_commit=checkpoint_commit)
    cp2["passed"] = True
    cp2["missing"] = []
    cp2["evidence"]["commands"] = [
        {
            "id": command_id,
            "command": command,
            "exit_code": 0,
            "count": 1,
            "outcome": "automated_pass",
            "reproducibility": {
                "runner": "product_reset_eval.py",
                "evaluated_commit": checkpoint_commit,
                "command_sha256": eval_service._sha256_text(command),
                "output_sha256": "0" * 64,
                "summary": "успешно; количество=1",
                "duration_ms": 0,
            },
        }
        for command_id, command in eval_service.CP2_REQUIRED_COMMANDS.items()
    ]
    result["checkpoint_results"]["CP2"] = cp2

    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "e" * 40)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda repo_root, ancestor, descendant: True,
    )
    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", lambda *args: True)
    monkeypatch.setattr(
        eval_service,
        "_cp2_historical_bridge_errors",
        lambda repo_root, checkpoint_commit: [],
    )
    monkeypatch.setattr(
        eval_service,
        "_git_run",
        lambda repo_root, *args: subprocess.CompletedProcess(
            ["git", *args],
            0,
            stdout="backend/migrations/versions/20260710_0001_product_reset.py\n",
            stderr="",
        ),
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP2",
        repo_root=tmp_path,
    )

    assert verification.passed is True


def test_cp2_run_overwrites_stale_command_records_and_binds_clean_head(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    result["checkpoint"] = "CP2"
    result["checkpoint_results"]["CP2"] = _cp2_checkpoint_result(evaluated_commit=None)
    result_dir = tmp_path / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(json.dumps(result), encoding="utf-8")
    evaluated = "c" * 40
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp2_git_errors", lambda document, repo_root: [])

    def successful_executor(
        repo_root: Path, command_spec: dict[str, object]
    ) -> subprocess.CompletedProcess[str]:
        command_id = str(command_spec["id"])
        output = (
            "17 passed"
            if command_id.endswith("suite")
            else "121 modules transformed"
            if command_id == "frontend-production-build"
            else "alembic upgrade complete"
        )
        return subprocess.CompletedProcess(["sh"], 0, stdout=output, stderr="")

    bound = run_checkpoint(tmp_path, "CP2", command_executor=successful_executor)

    commands = bound["checkpoint_results"]["CP2"]["evidence"]["commands"]
    assert {command["id"] for command in commands} == set(eval_service.CP2_REQUIRED_COMMANDS)
    assert all(command["exit_code"] == 0 for command in commands)
    assert all(command["reproducibility"]["evaluated_commit"] == evaluated for command in commands)
    assert bound["checkpoint_results"]["CP2"]["evaluated_commit"] == evaluated
    assert bound["checkpoint_results"]["CP2"]["passed"] is True
    assert bound["checkpoint_results"]["CP2"]["missing"] == []


def test_cp2_clean_schema_command_uses_isolated_synthetic_runtime_settings() -> None:
    command = eval_service.CP2_REQUIRED_COMMANDS["cp2-clean-schema-upgrade"]

    assert "ENVIRONMENT=test" in command
    assert "DATABASE_URL=sqlite+pysqlite:////tmp/newscast-cp2-eval.db" in command
    assert "CORS_ORIGINS=http://127.0.0.1:5173" in command
    assert "SECRET_KEY=product-reset-cp2-eval" in command
    assert "rm -f /tmp/newscast-cp2-eval.db" in command
    assert command.endswith("rm -f /tmp/newscast-cp2-eval.db")


def test_cp3_verification_rejects_generic_nonempty_evidence() -> None:
    result = _cp3_checkpoint_result(evaluated_commit=IMPLEMENTATION_BASE_SHA)
    result["checkpoint_results"]["CP3"]["evidence"] = {"outcome": "automated_pass"}

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP3")

    assert verification.passed is False
    assert any("CP3 evidence" in error for error in verification.errors)


def test_cp3_verification_accepts_exact_structured_runner_owned_evidence() -> None:
    result = _cp3_checkpoint_result(evaluated_commit="c" * 40)

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP3")

    assert verification.passed is True
    assert eval_service.CP3_REQUIRED_COMMANDS == CP3_EXPECTED_COMMANDS


@pytest.mark.parametrize(
    ("mutation", "expected_error"),
    [
        ("arbitrary_boolean", "scenario_backend"),
        ("placeholder_marker", "запрещённый маркер"),
        ("timeout_marker", "запрещённый маркер"),
        ("manual_marker", "запрещённый маркер"),
        ("duplicate_command_id", "command IDs должны быть уникальными"),
        ("wrong_command", "не совпадает с contract"),
        ("nonzero_exit", "exit_code=1"),
        ("zero_count", "не подтвердил успешный результат"),
        ("wrong_commit_binding", "метаданные воспроизводимости невалидны"),
    ],
)
def test_cp3_verification_rejects_unstructured_or_unowned_results(
    mutation: str, expected_error: str
) -> None:
    result = _cp3_checkpoint_result(evaluated_commit="c" * 40)
    evidence = result["checkpoint_results"]["CP3"]["evidence"]
    commands = evidence["commands"]

    if mutation == "arbitrary_boolean":
        evidence["scenario_backend"] = {"outcome": True}
    elif mutation.endswith("_marker"):
        commands[0]["reproducibility"]["summary"] = mutation.removesuffix("_marker")
    elif mutation == "duplicate_command_id":
        commands[1]["id"] = commands[0]["id"]
    elif mutation == "wrong_command":
        commands[0]["command"] = "cd backend && pytest"
    elif mutation == "nonzero_exit":
        commands[0]["exit_code"] = 1
    elif mutation == "zero_count":
        commands[0]["count"] = 0
    elif mutation == "wrong_commit_binding":
        commands[0]["reproducibility"]["evaluated_commit"] = "d" * 40

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP3")

    assert verification.passed is False
    assert any(expected_error in error for error in verification.errors)


def test_cp3_source_template_is_structured_but_unbound() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    cp3 = result["checkpoint_results"]["CP3"]

    assert cp3["passed"] is False
    assert cp3["evaluated_commit"] is None
    assert cp3["missing"] == ["command_evidence_pending"]
    assert cp3["evidence"]["commands"] == []
    assert eval_service._cp3_schema_errors(result, validate_command_results=False) == []


def test_checkpoint_verification_rejects_checkpoint_result_passed_false() -> None:
    result = _checkpoint_only_result()
    result["checkpoint_results"] = {
        "CP1": {"passed": False, "missing": [], "evidence": {}}
    }

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert "checkpoint_results.CP1.passed должен иметь значение true" in verification.errors


def test_checkpoint_verification_rejects_nonempty_missing_evidence() -> None:
    result = _checkpoint_only_result()
    result["checkpoint_results"] = {
        "CP1": {
            "passed": True,
            "missing": ["evidence_commit_binding"],
            "evidence": {},
        }
    }

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert "checkpoint_results.CP1.missing должен быть точным пустым списком" in verification.errors


def test_full_eval_requires_valid_checkpoint_results_not_only_completed_names() -> None:
    result = _checkpoint_only_result()
    result.update(
        {
            "completed_checkpoints": [*([f"CP{number}" for number in range(1, 8)]), "EXT-DEMO"],
            "local_hard_gates_passed": True,
            "hard_gates_passed": True,
            "failed_gates": [],
            "ux_categories": {f"category-{index}": 9 for index in range(10)},
            "ux_total": 90,
            "legacy_findings": [],
            "operations_findings": [],
            "external_demo": {
                "permission_status": "granted",
                "status": "passed",
                "app_sha": IMPLEMENTATION_BASE_SHA,
            },
        }
    )

    assert compute_full_eval_passed(result) is False


@pytest.mark.parametrize("malformed_evidence", [None, [], {}])
def test_checkpoint_verification_rejects_absent_or_malformed_cp1_evidence(
    malformed_evidence: object,
) -> None:
    result = _checkpoint_only_result()
    result["checkpoint_results"]["CP1"]["evidence"] = malformed_evidence

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert any("CP1 evidence" in error or "CP1.evidence" in error for error in verification.errors)


def test_checkpoint_verification_rejects_duplicate_autosave_ids() -> None:
    result = _checkpoint_only_result()
    evidence = result["checkpoint_results"]["CP1"]["evidence"]
    evidence["autosave_known_failures"][1]["id"] = "stale_suffix_loss"

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert "CP1 evidence autosave IDs должны быть уникальными" in verification.errors


def test_checkpoint_verification_rejects_duplicate_checkpoint_commit_shas() -> None:
    result = _checkpoint_only_result()
    commits = result["checkpoint_results"]["CP1"]["evidence"]["checkpoint_commits"]
    commits["commit_1_4"] = commits["commit_1_3"]

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert "CP1 evidence checkpoint SHAs должны быть уникальными" in verification.errors


def test_checkpoint_verification_rejects_unique_but_unapproved_checkpoint_shas() -> None:
    result = _checkpoint_only_result()
    commits = result["checkpoint_results"]["CP1"]["evidence"]["checkpoint_commits"]
    commits["commit_1_4"] = "a" * 40

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert (
        "CP1 evidence checkpoint SHAs не совпадают с утверждённой идентичностью"
        in verification.errors
    )


def test_checkpoint_verification_rejects_duplicate_command_ids() -> None:
    result = _checkpoint_only_result()
    commands = result["checkpoint_results"]["CP1"]["evidence"]["commands"]
    commands[1]["id"] = commands[0]["id"]

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert "CP1 evidence command IDs должны быть уникальными" in verification.errors


def test_checkpoint_verification_rejects_nonzero_required_command_exit() -> None:
    result = _checkpoint_only_result()
    commands = result["checkpoint_results"]["CP1"]["evidence"]["commands"]
    commands[0]["exit_code"] = 1

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert any("завершилась с exit_code=1" in error for error in verification.errors)


def _install_valid_fake_git(monkeypatch: pytest.MonkeyPatch, *, head: str) -> None:
    monkeypatch.setattr(eval_service, "CP1_REFERENCED_FILES", ())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: head)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda repo_root, ancestor, descendant: True,
    )
    monkeypatch.setattr(
        eval_service,
        "_git_diff_is_empty",
        lambda repo_root, base, commit, paths: True,
    )


def _set_evaluated_commit(result: dict[str, object], commit: str) -> None:
    result["commit"] = commit


def test_cp1_remains_valid_when_top_level_commit_moves_to_future_descendant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    future_commit = "e" * 40
    result["commit"] = future_commit
    _install_valid_fake_git(monkeypatch, head="f" * 40)

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP1",
        repo_root=tmp_path,
    )

    assert verification.passed is True


def test_cp1_rejects_command_metadata_bound_to_top_level_instead_of_checkpoint_commit() -> None:
    result = _checkpoint_only_result()
    future_commit = "e" * 40
    result["commit"] = future_commit
    result["checkpoint_results"]["CP1"]["evidence"]["commands"][0]["reproducibility"][
        "evaluated_commit"
    ] = future_commit

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert any("метаданные воспроизводимости" in error for error in verification.errors)


def test_checkpoint_verification_rejects_nonexistent_evaluated_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    nonexistent = "f" * 40
    _set_evaluated_commit(result, nonexistent)
    _install_valid_fake_git(monkeypatch, head="e" * 40)
    monkeypatch.setattr(
        eval_service,
        "_git_commit_exists",
        lambda repo_root, sha: sha != nonexistent,
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP1",
        repo_root=tmp_path,
    )

    assert verification.passed is False
    assert "eval commit не существует как Git commit" in verification.errors


def test_checkpoint_verification_rejects_malformed_evaluated_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    _set_evaluated_commit(result, "not-a-git-sha")
    _install_valid_fake_git(monkeypatch, head="e" * 40)

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP1",
        repo_root=tmp_path,
    )

    assert verification.passed is False
    assert "eval commit не существует как Git commit" in verification.errors


def test_checkpoint_verification_rejects_nonancestor_evaluated_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    head = "e" * 40
    evaluated = result["commit"]
    _install_valid_fake_git(monkeypatch, head=head)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda repo_root, ancestor, descendant: not (
            ancestor == evaluated and descendant == head
        ),
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP1",
        repo_root=tmp_path,
    )

    assert verification.passed is False
    assert "eval commit не является предком текущего HEAD" in verification.errors


def test_checkpoint_verification_rejects_nonancestor_checkpoint_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    head = "e" * 40
    evaluated = result["commit"]
    nonancestor = result["checkpoint_results"]["CP1"]["evidence"]["checkpoint_commits"][
        "commit_1_4"
    ]
    _install_valid_fake_git(monkeypatch, head=head)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda repo_root, ancestor, descendant: not (
            ancestor == nonancestor and descendant == evaluated
        ),
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP1",
        repo_root=tmp_path,
    )

    assert verification.passed is False
    assert (
        "CP1 evidence commit_1_4 не является предком CP1 evaluated_commit"
        in verification.errors
    )


def test_checkpoint_verification_rejects_runtime_editor_diff(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    _install_valid_fake_git(monkeypatch, head="e" * 40)
    monkeypatch.setattr(
        eval_service,
        "_git_diff_is_empty",
        lambda repo_root, base, commit, paths: False,
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP1",
        repo_root=tmp_path,
    )

    assert verification.passed is False
    assert (
        "runtime editor/CaptionPanels отличается от IMPLEMENTATION_BASE_SHA"
        in verification.errors
    )


def test_layout_evidence_accepts_numeric_failure_above_gate_without_exact_measurement() -> None:
    result = _checkpoint_only_result()
    layout = result["checkpoint_results"]["CP1"]["evidence"]["autosave_known_failures"][1]
    layout["observed"] = 2.25

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is True


def test_checkpoint_verification_rejects_passed_checkpoint_still_in_failed_gates() -> None:
    result = _checkpoint_only_result()
    result["failed_gates"] = ["CP1", *result["failed_gates"]]

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP1")

    assert verification.passed is False
    assert "checkpoint CP1 не может одновременно быть passed и failed" in verification.errors


def test_checkpoint_run_rejects_dirty_source_tree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result_dir = tmp_path / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(
        json.dumps(_checkpoint_only_result()), encoding="utf-8"
    )
    monkeypatch.setattr(
        eval_service,
        "_git_dirty_paths",
        lambda repo_root: {"backend/app/services/product_reset_eval.py"},
    )

    with pytest.raises(ValueError, match="чистый committed source tree"):
        run_checkpoint(tmp_path, "CP1")


def test_checkpoint_run_rejects_dirty_eval_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result_dir = tmp_path / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(
        json.dumps(_checkpoint_only_result()), encoding="utf-8"
    )
    monkeypatch.setattr(
        eval_service,
        "_git_dirty_paths",
        lambda repo_root: {"docs/product-reset/EVAL_RESULT.json"},
    )

    with pytest.raises(ValueError, match="чистый committed source tree"):
        run_checkpoint(tmp_path, "CP1")


def test_git_dirty_paths_requests_all_untracked_nonignored_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[tuple[str, ...]] = []

    def fake_git_run(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        calls.append(args)
        return subprocess.CompletedProcess(
            ["git", *args],
            0,
            stdout="?? backend/app/services/untracked_guard.py\n",
            stderr="",
        )

    monkeypatch.setattr(eval_service, "_git_run", fake_git_run)

    dirty_paths = eval_service._git_dirty_paths(tmp_path)

    assert calls == [("status", "--porcelain", "--untracked-files=all")]
    assert dirty_paths == {"backend/app/services/untracked_guard.py"}
    assert not any(path.startswith("artifacts/") for path in dirty_paths)


def test_cp1_evidence_paths_are_read_from_evaluated_commit_not_current_worktree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    checkpoint_commit = result["checkpoint_results"]["CP1"]["evaluated_commit"]
    result["commit"] = "e" * 40
    _install_valid_fake_git(monkeypatch, head="f" * 40)
    monkeypatch.setattr(eval_service, "CP1_REFERENCED_FILES", ("deleted-after-cp1.ts",))
    checked_path_commits: list[str] = []
    checked_diff_commits: list[str] = []

    def path_exists(repo_root: Path, commit: str, path: str) -> bool:
        checked_path_commits.append(commit)
        return True

    def diff_is_empty(repo_root: Path, base: str, commit: str, paths: tuple[str, ...]) -> bool:
        checked_diff_commits.append(commit)
        return True

    monkeypatch.setattr(
        eval_service,
        "_git_path_exists_at_commit",
        path_exists,
        raising=False,
    )
    monkeypatch.setattr(eval_service, "_git_diff_is_empty", diff_is_empty)

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP1",
        repo_root=tmp_path,
    )

    assert verification.passed is True
    assert checked_path_commits and set(checked_path_commits) == {checkpoint_commit}
    assert checked_diff_commits and set(checked_diff_commits) == {checkpoint_commit}


def test_cp1_playwright_config_starts_vite_and_expected_failures_follow_preconditions() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    config = (repo_root / "frontend/playwright.config.ts").read_text(encoding="utf-8")
    result = json.loads((repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8"))
    evaluated_commit = result["checkpoint_results"]["CP1"]["evaluated_commit"]
    assert isinstance(evaluated_commit, str)
    known_failures = subprocess.run(
        ["git", "show", f"{evaluated_commit}:frontend/e2e/editor-autosave-known-failures.spec.ts"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    assert "webServer:" in config
    assert 'command: "npm run dev -- --host 127.0.0.1 --port 5173"' in config
    assert 'url: "http://127.0.0.1:5173"' in config
    for test_name in (
        "stale autosave response does not overwrite typing",
        "autosave status transition keeps visible geometry",
    ):
        test_source = known_failures.split(f'test("{test_name}', 1)[1].split("\ntest(", 1)[0]
        assert test_source.index("await expect(editor).toContainText") < test_source.index(
            "test.fail(true,"
        )
    stale_source = known_failures.split('test("stale autosave response', 1)[1].split("\ntest(", 1)[0]
    layout_source = known_failures.split('test("autosave status transition', 1)[1]
    assert stale_source.index("deferredSave.route.fulfill") < stale_source.index("test.fail(true,")
    assert layout_source.index("expect(during).not.toBeNull()") < layout_source.index(
        "test.fail(true,"
    )


def _successful_command_executor(
    repo_root: Path, command_spec: dict[str, object]
) -> subprocess.CompletedProcess[str]:
    output_by_id = {
        "backend-full-suite": "140 passed",
        "frontend-full-suite": "5 passed",
        "frontend-production-build": "121 modules transformed",
        "browser-cp1-pair-chromium-1366": "5 passed",
        "root-compose-config": "configuration valid",
        "test-compose-config": "configuration valid",
        "compose-focused-evaluator-policy": "34 passed",
    }
    command_id = str(command_spec["id"])
    return subprocess.CompletedProcess(
        ["sh", "-lc", str(command_spec["command"])],
        0,
        stdout=output_by_id[command_id],
        stderr="",
    )


def _write_pending_checkpoint_result(tmp_path: Path) -> None:
    result = _checkpoint_only_result()
    result["completed_checkpoints"] = []
    result["failed_gates"] = ["CP1", *result["failed_gates"]]
    cp1 = result["checkpoint_results"]["CP1"]
    cp1["passed"] = False
    cp1["missing"] = ["evidence_command_execution"]
    cp1["evaluated_commit"] = None
    for command in cp1["evidence"]["commands"]:
        command.update(
            {
                "exit_code": 99,
                "count": 999,
                "outcome": "automated_pass",
            }
        )
    result_dir = tmp_path / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(json.dumps(result), encoding="utf-8")


def test_checkpoint_run_overwrites_prefilled_command_results_and_syncs_gates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_checkpoint_result(tmp_path)
    evaluated = "c" * 40
    _install_valid_fake_git(monkeypatch, head=evaluated)
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())

    bound = run_checkpoint(
        tmp_path,
        "CP1",
        command_executor=_successful_command_executor,
    )

    commands = bound["checkpoint_results"]["CP1"]["evidence"]["commands"]
    assert all(command["count"] != 999 for command in commands)
    assert all(command["exit_code"] == 0 for command in commands)
    assert all(command["outcome"] == "automated_pass" for command in commands)
    assert all(command["reproducibility"]["evaluated_commit"] == evaluated for command in commands)
    assert bound["checkpoint_results"]["CP1"]["evaluated_commit"] == evaluated
    assert bound["checkpoint_results"]["CP1"]["passed"] is True
    assert bound["checkpoint_results"]["CP1"]["missing"] == []
    assert bound["completed_checkpoints"] == ["CP1"]
    assert "CP1" not in bound["failed_gates"]


def test_checkpoint_run_records_nonzero_command_and_keeps_cp1_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_checkpoint_result(tmp_path)
    evaluated = "c" * 40
    _install_valid_fake_git(monkeypatch, head=evaluated)
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())

    def failing_executor(
        repo_root: Path, command_spec: dict[str, object]
    ) -> subprocess.CompletedProcess[str]:
        completed = _successful_command_executor(repo_root, command_spec)
        if command_spec["id"] == "frontend-production-build":
            return subprocess.CompletedProcess(completed.args, 1, stdout="build failed", stderr="")
        return completed

    bound = run_checkpoint(tmp_path, "CP1", command_executor=failing_executor)

    failed = next(
        command
        for command in bound["checkpoint_results"]["CP1"]["evidence"]["commands"]
        if command["id"] == "frontend-production-build"
    )
    assert failed["exit_code"] == 1
    assert failed["outcome"] == "automated_failure"
    assert bound["checkpoint_results"]["CP1"]["passed"] is False
    assert any("frontend-production-build" in item for item in bound["checkpoint_results"]["CP1"]["missing"])
    assert "CP1" not in bound["completed_checkpoints"]
    assert "CP1" in bound["failed_gates"]


def test_checkpoint_run_rejects_source_mutation_created_by_commands(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_checkpoint_result(tmp_path)
    evaluated = "c" * 40
    _install_valid_fake_git(monkeypatch, head=evaluated)
    dirty_checks = iter((set(), {"backend/app/services/generated_source.py"}))
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: next(dirty_checks))

    with pytest.raises(ValueError, match="канонические команды CP1 изменили дерево исходников"):
        run_checkpoint(
            tmp_path,
            "CP1",
            command_executor=_successful_command_executor,
        )


def test_checkpoint_run_rejects_head_change_between_canonical_commands(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_checkpoint_result(tmp_path)
    evaluated = "c" * 40
    future = "d" * 40
    _install_valid_fake_git(monkeypatch, head=evaluated)
    heads = iter((evaluated, future))
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: next(heads))
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())

    with pytest.raises(ValueError, match="HEAD изменился во время выполнения команд CP1"):
        run_checkpoint(
            tmp_path,
            "CP1",
            command_executor=_successful_command_executor,
        )


def test_eval_commands_document_matches_runner_registry_and_meta_commands() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    document = json.loads(
        (repo_root / "docs/product-reset/EVAL_COMMANDS.json").read_text(encoding="utf-8")
    )
    runner_commands = {
        item["id"]: item
        for item in document["commands"]
        if item.get("execution_group") == "cp1_runner"
    }
    assert set(runner_commands) == set(eval_service.CP1_REQUIRED_COMMANDS)
    for command_id, command in eval_service.CP1_REQUIRED_COMMANDS.items():
        assert runner_commands[command_id]["command"] == command
        assert runner_commands[command_id]["expected_exit_code"] == 0

    meta = {
        item["id"]: item
        for item in document["commands"]
        if item.get("execution_group") == "meta"
    }
    assert set(meta) == set(eval_service.CP1_META_COMMANDS)
    for command_id, command_spec in eval_service.CP1_META_COMMANDS.items():
        assert meta[command_id]["command"] == command_spec["command"]
        assert meta[command_id]["expected_exit_code"] == command_spec["expected_exit_code"]


def test_checkpoint_run_binds_clean_head_and_recomputes_cp1_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    result["commit"] = IMPLEMENTATION_BASE_SHA
    result["completed_checkpoints"] = []
    result["checkpoint_results"]["CP1"]["passed"] = False
    result["checkpoint_results"]["CP1"]["missing"] = ["evidence_commit_binding"]
    result["checkpoint_results"]["CP1"]["evaluated_commit"] = None
    result_dir = tmp_path / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(json.dumps(result), encoding="utf-8")
    evaluated = "c" * 40
    _install_valid_fake_git(monkeypatch, head=evaluated)
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())

    bound = run_checkpoint(
        tmp_path,
        "CP1",
        command_executor=_successful_command_executor,
    )

    assert bound["commit"] == evaluated
    assert bound["checkpoint_results"]["CP1"]["evaluated_commit"] == evaluated
    assert bound["checkpoint_results"]["CP1"]["passed"] is True
    assert bound["checkpoint_results"]["CP1"]["missing"] == []
    assert bound["completed_checkpoints"] == ["CP1"]
    assert bound["full_eval_passed"] is False


def _write_pending_cp3_result(tmp_path: Path) -> None:
    result = _cp3_checkpoint_result(evaluated_commit="c" * 40)
    result["commit"] = IMPLEMENTATION_BASE_SHA
    result["checkpoint"] = "CP2"
    result["completed_checkpoints"] = ["CP1"]
    result["failed_gates"] = ["CP2", "CP3", "CP4", "CP5", "CP6", "CP7", "external_demo"]
    cp3 = result["checkpoint_results"]["CP3"]
    cp3["passed"] = False
    cp3["missing"] = ["command_evidence_pending"]
    cp3["evaluated_commit"] = None
    cp3["evidence"]["commands"] = []
    result_dir = tmp_path / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(json.dumps(result), encoding="utf-8")


def _successful_cp3_command_executor(
    repo_root: Path, command_spec: dict[str, object]
) -> subprocess.CompletedProcess[str]:
    output_by_id = {
        "backend-full-suite": "225 passed, 2 skipped",
        "frontend-full-suite": "Tests 26 passed",
        "frontend-production-build": "178 modules transformed",
        "browser-scenario-history-chromium-1366": "4 passed",
        "browser-scenario-chromium-1920": "2 passed",
    }
    command_id = str(command_spec["id"])
    return subprocess.CompletedProcess(
        ["sh", "-lc", str(command_spec["command"])],
        0,
        stdout=output_by_id[command_id],
        stderr="",
    )


def test_cp3_run_overwrites_template_binds_head_and_syncs_checkpoint_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_cp3_result(tmp_path)
    evaluated = "d" * 40
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp3_git_errors", lambda document, repo_root: [])

    bound = run_checkpoint(
        tmp_path,
        "CP3",
        command_executor=_successful_cp3_command_executor,
    )

    cp3 = bound["checkpoint_results"]["CP3"]
    commands = cp3["evidence"]["commands"]
    assert [item["id"] for item in commands] == list(CP3_EXPECTED_COMMANDS)
    assert [item["count"] for item in commands] == [225, 26, 178, 4, 2]
    assert all(item["exit_code"] == 0 for item in commands)
    assert all(item["outcome"] == "automated_pass" for item in commands)
    assert all(
        item["reproducibility"]["evaluated_commit"] == evaluated for item in commands
    )
    assert cp3["evaluated_commit"] == evaluated
    assert cp3["passed"] is True
    assert cp3["missing"] == []
    assert bound["completed_checkpoints"] == ["CP1", "CP3"]
    assert "CP3" not in bound["failed_gates"]
    assert bound["local_hard_gates_passed"] is False
    assert bound["hard_gates_passed"] is False
    assert bound["full_eval_passed"] is False


def test_cp3_run_keeps_checkpoint_failed_when_count_parser_finds_no_tests(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_cp3_result(tmp_path)
    evaluated = "d" * 40
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp3_git_errors", lambda document, repo_root: [])

    def executor(
        repo_root: Path, command_spec: dict[str, object]
    ) -> subprocess.CompletedProcess[str]:
        completed = _successful_cp3_command_executor(repo_root, command_spec)
        if command_spec["id"] == "frontend-full-suite":
            return subprocess.CompletedProcess(completed.args, 0, stdout="no tests", stderr="")
        return completed

    bound = run_checkpoint(tmp_path, "CP3", command_executor=executor)

    cp3 = bound["checkpoint_results"]["CP3"]
    failed = next(item for item in cp3["evidence"]["commands"] if item["id"] == "frontend-full-suite")
    assert failed["count"] == 0
    assert failed["outcome"] == "automated_failure"
    assert cp3["passed"] is False
    assert any("frontend-full-suite" in item for item in cp3["missing"])
    assert "CP3" not in bound["completed_checkpoints"]
    assert "CP3" in bound["failed_gates"]


def test_cp3_run_rejects_source_side_effect_immediately_after_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_cp3_result(tmp_path)
    evaluated = "d" * 40
    dirty_checks = iter(
        (
            set(),
            set(),
            {"backend/app/services/generated_source.py"},
        )
    )
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: next(dirty_checks))
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)

    with pytest.raises(ValueError, match="каноническая команда CP3.*изменила дерево исходников"):
        run_checkpoint(
            tmp_path,
            "CP3",
            command_executor=_successful_cp3_command_executor,
        )


def test_cp3_run_checks_head_before_and_after_each_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_cp3_result(tmp_path)
    evaluated = "d" * 40
    future = "e" * 40
    heads = iter((evaluated, evaluated, future))
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: next(heads))

    with pytest.raises(ValueError, match="HEAD изменился.*команды CP3"):
        run_checkpoint(
            tmp_path,
            "CP3",
            command_executor=_successful_cp3_command_executor,
        )


def test_cp3_run_refuses_to_rebind_immutable_evaluated_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_pending_cp3_result(tmp_path)
    result_path = tmp_path / "docs/product-reset/EVAL_RESULT.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))
    result["checkpoint_results"]["CP3"]["evaluated_commit"] = "c" * 40
    result_path.write_text(json.dumps(result), encoding="utf-8")
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "d" * 40)

    with pytest.raises(ValueError, match="evaluated_commit неизменяем"):
        run_checkpoint(
            tmp_path,
            "CP3",
            command_executor=_successful_cp3_command_executor,
        )


def test_cp3_git_contract_uses_immutable_commit_and_requires_bridge_absence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cp3_commit = "c" * 40
    result = _cp3_checkpoint_result(evaluated_commit=cp3_commit)
    result["commit"] = "d" * 40
    result["checkpoint_results"]["CP2"] = {"evaluated_commit": "b" * 40}
    checked_paths: list[tuple[str, str]] = []
    historical_checks: list[str] = []
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "e" * 40)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(eval_service, "_git_is_ancestor", lambda *args: True)
    monkeypatch.setattr(eval_service, "_cp2_schema_errors", lambda document: [])
    monkeypatch.setattr(
        eval_service,
        "_cp2_git_errors",
        lambda document, repo_root: historical_checks.append("CP2") or [],
    )

    def path_exists(repo_root: Path, commit: str, path: str) -> bool:
        checked_paths.append((commit, path))
        return path not in eval_service.CP2_BRIDGE_PATHS

    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", path_exists)
    monkeypatch.setattr(
        eval_service,
        "_git_file_at_commit",
        lambda repo_root, commit, path: (
            "[forbidden_now]\n"
            + "\n".join(eval_service.CP2_BRIDGE_PATHS)
            + "\n[allowed_until_cp3]\n"
        ),
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP3",
        repo_root=tmp_path,
    )

    assert verification.passed is True
    assert historical_checks == ["CP2"]
    assert checked_paths
    cp3_contract_paths = set(eval_service.CP3_REFERENCED_FILES) | set(
        eval_service.CP2_BRIDGE_PATHS
    )
    cp3_checks = [(commit, path) for commit, path in checked_paths if path in cp3_contract_paths]
    paths_checked_at_cp3 = {path for commit, path in cp3_checks if commit == cp3_commit}
    assert cp3_contract_paths.issubset(paths_checked_at_cp3)


def test_cp3_git_contract_rejects_cp2_not_ancestor_of_cp3(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cp2_commit = "b" * 40
    cp3_commit = "c" * 40
    result = _cp3_checkpoint_result(evaluated_commit=cp3_commit)
    result["checkpoint_results"]["CP2"] = {"evaluated_commit": cp2_commit}
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "d" * 40)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda repo_root, ancestor, descendant: not (
            ancestor == cp2_commit and descendant == cp3_commit
        ),
    )
    monkeypatch.setattr(eval_service, "_cp2_schema_errors", lambda document: [])
    monkeypatch.setattr(eval_service, "_cp2_git_errors", lambda document, repo_root: [])
    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", lambda *args: True)
    monkeypatch.setattr(
        eval_service,
        "_git_file_at_commit",
        lambda repo_root, commit, path: (
            "[forbidden_now]\n"
            + "\n".join(eval_service.CP2_BRIDGE_PATHS)
            + "\n[allowed_until_cp3]\n"
        ),
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP3",
        repo_root=tmp_path,
    )

    assert verification.passed is False
    assert "CP2 evaluated_commit не является предком CP3 evaluated_commit" in verification.errors
