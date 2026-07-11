from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.product_reset_eval import (
    ANALYZED_PRODUCT_BASE_SHA,
    IMPLEMENTATION_BASE_SHA,
    compute_full_eval_passed,
    evaluate_verification,
    load_eval_result,
    run_checkpoint,
)


def _checkpoint_only_result() -> dict[str, object]:
    return {
        "schema_version": 1,
        "ANALYZED_PRODUCT_BASE_SHA": ANALYZED_PRODUCT_BASE_SHA,
        "IMPLEMENTATION_BASE_SHA": IMPLEMENTATION_BASE_SHA,
        "commit": IMPLEMENTATION_BASE_SHA,
        "checkpoint": "CP1",
        "completed_checkpoints": ["CP1"],
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
