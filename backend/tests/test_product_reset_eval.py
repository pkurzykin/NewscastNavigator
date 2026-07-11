from __future__ import annotations

import copy
import json
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
            }
            for command_id, command in CP1_REQUIRED_COMMANDS.items()
        ],
    }


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

    assert cp1["passed"] is (cp1["missing"] == [])
    assert cp1["missing"] in ([], ["evidence_commit_binding"])
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
    assert all((repo_root / path).is_file() for path in evidence_paths)

    component_known_failures = (
        repo_root / known_failures["stale_suffix_loss"]["component_test"]
    ).read_text(encoding="utf-8")
    browser_known_failures = (
        repo_root / known_failures["stale_suffix_loss"]["browser_test"]
    ).read_text(encoding="utf-8")
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

    assert result["completed_checkpoints"] == (["CP1"] if cp1["passed"] else [])
    assert result["local_hard_gates_passed"] is False
    assert result["hard_gates_passed"] is False
    assert result["full_eval_passed"] is False


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
    assert any("должен иметь exit_code=0" in error for error in verification.errors)


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


def test_checkpoint_verification_rejects_nonexistent_evaluated_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    nonexistent = "f" * 40
    result["commit"] = nonexistent
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
    result["commit"] = "not-a-git-sha"
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
    nonancestor = "d" * 40
    result["checkpoint_results"]["CP1"]["evidence"]["checkpoint_commits"][
        "commit_1_4"
    ] = nonancestor
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
    assert "CP1 evidence commit_1_4 не является предком eval commit" in verification.errors


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


def test_checkpoint_run_binds_clean_head_and_recomputes_cp1_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result = _checkpoint_only_result()
    result["commit"] = IMPLEMENTATION_BASE_SHA
    result["completed_checkpoints"] = []
    result["checkpoint_results"]["CP1"]["passed"] = False
    result["checkpoint_results"]["CP1"]["missing"] = ["evidence_commit_binding"]
    result_dir = tmp_path / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(json.dumps(result), encoding="utf-8")
    evaluated = "c" * 40
    _install_valid_fake_git(monkeypatch, head=evaluated)
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())

    bound = run_checkpoint(tmp_path, "CP1")

    assert bound["commit"] == evaluated
    assert bound["checkpoint_results"]["CP1"]["passed"] is True
    assert bound["checkpoint_results"]["CP1"]["missing"] == []
    assert bound["completed_checkpoints"] == ["CP1"]
    assert bound["full_eval_passed"] is False
