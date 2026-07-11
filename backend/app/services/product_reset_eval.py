from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Mapping


ANALYZED_PRODUCT_BASE_SHA = "5129e0bd19976bbf74ab01aeda9c29663cf152da"
IMPLEMENTATION_BASE_SHA = "a540e47704b26afc02272e6c05e311f48b894f85"

REQUIRED_BASELINE_FIELDS = (
    "ANALYZED_PRODUCT_BASE_SHA",
    "IMPLEMENTATION_BASE_SHA",
)
LOCAL_CHECKPOINTS = tuple(f"CP{number}" for number in range(1, 8))
FINAL_CHECKPOINT = "EXT-DEMO"
EXPECTED_UX_CATEGORY_COUNT = 10


@dataclass(frozen=True)
class VerificationResult:
    scope: Literal["checkpoint", "final"]
    passed: bool
    errors: tuple[str, ...]
    checkpoint: str | None = None


def load_eval_result(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"результат eval не найден: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"результат eval содержит невалидный JSON: {path}: {exc}") from exc

    if not isinstance(document, dict):
        raise ValueError("результат eval должен быть JSON-объектом")

    missing = [field for field in REQUIRED_BASELINE_FIELDS if not document.get(field)]
    if missing:
        raise ValueError(f"отсутствуют обязательные поля eval: {', '.join(missing)}")

    return document


def _baseline_errors(document: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    analyzed_sha = document.get("ANALYZED_PRODUCT_BASE_SHA")
    implementation_sha = document.get("IMPLEMENTATION_BASE_SHA")

    if analyzed_sha != ANALYZED_PRODUCT_BASE_SHA:
        errors.append("ANALYZED_PRODUCT_BASE_SHA не совпадает с утверждённой analyzed base")
    if implementation_sha != IMPLEMENTATION_BASE_SHA:
        errors.append("IMPLEMENTATION_BASE_SHA не совпадает с утверждённой implementation base")
    return errors


def _ux_gate_passed(document: Mapping[str, Any]) -> bool:
    categories = document.get("ux_categories")
    if not isinstance(categories, dict) or len(categories) != EXPECTED_UX_CATEGORY_COUNT:
        return False
    scores = tuple(categories.values())
    if not all(isinstance(score, (int, float)) and not isinstance(score, bool) for score in scores):
        return False
    declared_total = document.get("ux_total")
    if not isinstance(declared_total, (int, float)) or isinstance(declared_total, bool):
        return False
    computed_total = sum(scores)
    return declared_total == computed_total and declared_total >= 90 and all(score >= 8 for score in scores)


def _completed_checkpoint_set(document: Mapping[str, Any]) -> tuple[set[str], bool]:
    completed = document.get("completed_checkpoints")
    if not isinstance(completed, list) or not all(isinstance(item, str) for item in completed):
        return set(), False
    return set(completed), True


def compute_full_eval_passed(document: Mapping[str, Any]) -> bool:
    completed_set, completed_is_valid = _completed_checkpoint_set(document)
    external_demo = document.get("external_demo")
    failed_gates = document.get("failed_gates")
    legacy_findings = document.get("legacy_findings")
    operations_findings = document.get("operations_findings")

    external_demo_passed = (
        isinstance(external_demo, dict)
        and external_demo.get("permission_status") == "granted"
        and external_demo.get("status") == "passed"
        and isinstance(external_demo.get("app_sha"), str)
        and external_demo.get("app_sha") == document.get("commit")
    )

    return all(
        (
            document.get("local_hard_gates_passed") is True,
            document.get("hard_gates_passed") is True,
            completed_is_valid,
            isinstance(failed_gates, list) and not failed_gates,
            isinstance(legacy_findings, list) and not legacy_findings,
            isinstance(operations_findings, list) and not operations_findings,
            _ux_gate_passed(document),
            set(LOCAL_CHECKPOINTS).issubset(completed_set),
            FINAL_CHECKPOINT in completed_set,
            external_demo_passed,
        )
    )


def evaluate_verification(
    document: Mapping[str, Any],
    *,
    scope: Literal["checkpoint", "final"],
    checkpoint: str | None = None,
) -> VerificationResult:
    if scope not in {"checkpoint", "final"}:
        raise ValueError(f"неподдерживаемая область проверки: {scope}")
    if scope == "checkpoint" and not checkpoint:
        raise ValueError("для checkpoint verification требуется --checkpoint")
    if scope == "checkpoint" and checkpoint not in LOCAL_CHECKPOINTS:
        raise ValueError(f"неизвестный checkpoint: {checkpoint}")

    errors = _baseline_errors(document)
    completed_set, completed_is_valid = _completed_checkpoint_set(document)
    if not completed_is_valid:
        errors.append("completed_checkpoints должен содержать только строки")
    computed_full_eval_passed = compute_full_eval_passed(document)
    if document.get("full_eval_passed") is not computed_full_eval_passed:
        errors.append("full_eval_passed не соответствует вычисленному финальному состоянию")

    if scope == "checkpoint":
        if checkpoint not in completed_set:
            errors.append(f"checkpoint {checkpoint} не завершён")
    elif not computed_full_eval_passed:
        errors.append("full_eval_passed имеет значение false")

    return VerificationResult(
        scope=scope,
        checkpoint=checkpoint,
        passed=not errors,
        errors=tuple(errors),
    )


def _git_head(repo_root: Path) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def run_checkpoint(repo_root: Path, checkpoint: str) -> dict[str, Any]:
    if checkpoint not in (*LOCAL_CHECKPOINTS, FINAL_CHECKPOINT):
        raise ValueError(f"неизвестный checkpoint: {checkpoint}")
    result_path = repo_root / "docs/product-reset/EVAL_RESULT.json"
    document = load_eval_result(result_path)
    document["commit"] = _git_head(repo_root)
    document["checkpoint"] = checkpoint
    document["full_eval_passed"] = compute_full_eval_passed(document)
    result_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return document
