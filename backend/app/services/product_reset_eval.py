from __future__ import annotations

import copy
import hashlib
import json
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal, Mapping


ANALYZED_PRODUCT_BASE_SHA = "5129e0bd19976bbf74ab01aeda9c29663cf152da"
IMPLEMENTATION_BASE_SHA = "a540e47704b26afc02272e6c05e311f48b894f85"

REQUIRED_BASELINE_FIELDS = (
    "ANALYZED_PRODUCT_BASE_SHA",
    "IMPLEMENTATION_BASE_SHA",
)
LOCAL_CHECKPOINTS = tuple(f"CP{number}" for number in range(1, 8))
FINAL_CHECKPOINT = "EXT-DEMO"
EXPECTED_UX_CATEGORY_COUNT = 10
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CP1_APPROVED_CHECKPOINT_COMMITS = {
    "commit_1_1": "94dab351d3c12e2cf670c0bcce2ccc3a87823677",
    "commit_1_2": "58eb74672859b42a8eab000e976c16f079aeb520",
    "commit_1_3": "5b5c5e8f40cb05d9b0a03d7c4eecf805f22bc930",
    "commit_1_4": "791ad373bce6d3388e4645fb0e9ad13d605f45de",
}
CP1_COMMIT_KEYS = tuple(CP1_APPROVED_CHECKPOINT_COMMITS)
CP1_RUNTIME_PATHS = (
    "frontend/src/pages/EditorPage.tsx",
    "backend/app/api/routes/editor.py",
    "backend/app/api/routes/captionpanels.py",
)
CP1_REQUIRED_COMMANDS = {
    "backend-full-suite": "cd backend && ./.venv/bin/pytest -q",
    "frontend-full-suite": "cd frontend && npm test -- --run",
    "frontend-production-build": "cd frontend && npm run build",
    "browser-cp1-pair-chromium-1366": (
        "cd frontend && npx playwright test editor-characterization.spec.ts "
        "editor-autosave-known-failures.spec.ts --project=chromium-1366"
    ),
    "root-compose-config": "docker compose --env-file .env.example -f compose.yaml config",
    "test-compose-config": "docker compose -f compose.test.yaml config",
    "compose-focused-evaluator-policy": (
        "docker compose -f compose.test.yaml run --rm backend-tests pytest -q "
        "tests/test_product_reset_eval.py tests/test_repository_policy.py"
    ),
}
CP1_COMMAND_COUNT_PATTERNS = {
    "backend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-production-build": re.compile(r"(\d+) modules transformed"),
    "browser-cp1-pair-chromium-1366": re.compile(r"(\d+) passed"),
    "root-compose-config": None,
    "test-compose-config": None,
    "compose-focused-evaluator-policy": re.compile(r"(\d+) passed"),
}
CP1_META_COMMANDS = {
    "checkpoint-run": {
        "command": (
            "cd backend && ./.venv/bin/python scripts/product_reset_eval.py run "
            "--checkpoint CP1 --repo-root .."
        ),
        "expected_exit_code": 0,
    },
    "checkpoint-verify": {
        "command": (
            "cd backend && ./.venv/bin/python scripts/product_reset_eval.py verify "
            "--scope checkpoint --checkpoint CP1 --repo-root .."
        ),
        "expected_exit_code": 0,
    },
    "final-verify": {
        "command": (
            "cd backend && ./.venv/bin/python scripts/product_reset_eval.py verify "
            "--scope final --repo-root .."
        ),
        "expected_exit_code": 2,
    },
}
CP1_REFERENCED_FILES = (
    "backend/tests/test_product_reset_eval.py",
    "backend/tests/test_repository_policy.py",
    "compose.test.yaml",
    "frontend/vitest.config.ts",
    "frontend/src/features/editor-core/serializers.test.ts",
    "frontend/playwright.config.ts",
    "backend/tests/characterization/test_editor_contract.py",
    "frontend/src/pages/__tests__/EditorPage.characterization.test.tsx",
    "frontend/e2e/editor-characterization.spec.ts",
    "backend/tests/characterization/test_captionpanels_contract.py",
    "frontend/src/pages/__tests__/EditorPage.autosave.known-failures.test.tsx",
    "frontend/e2e/editor-autosave-known-failures.spec.ts",
    "backend/tests/fixtures/synthetic_demo_contract.json",
    "backend/tests/synthetic_data_policy.py",
    "backend/tests/test_demo_seed_policy.py",
    "docs/product-reset/EVAL_COMMANDS.json",
    *CP1_RUNTIME_PATHS,
)
INVALID_EVIDENCE_MARKERS = ("placeholder", "timeout", "manual")


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


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _mapping_with_outcome(value: object, outcome: str) -> bool:
    return isinstance(value, dict) and value.get("outcome") == outcome


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _cp1_schema_errors(
    document: Mapping[str, Any], *, validate_command_results: bool = True
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    cp1 = checkpoint_results.get("CP1") if isinstance(checkpoint_results, dict) else None
    evidence = cp1.get("evidence") if isinstance(cp1, dict) else None
    if not isinstance(evidence, dict):
        return ["checkpoint_results.CP1.evidence должен быть JSON-объектом"]
    checkpoint_evaluated_commit = cp1.get("evaluated_commit") if isinstance(cp1, dict) else None

    errors: list[str] = []
    try:
        serialized = json.dumps(evidence, ensure_ascii=False).casefold()
    except (TypeError, ValueError):
        return ["checkpoint_results.CP1.evidence должен быть сериализуемым JSON"]
    for marker in INVALID_EVIDENCE_MARKERS:
        if marker in serialized:
            errors.append(f"CP1 evidence содержит запрещённый маркер: {marker}")

    if evidence.get("schema_version") != 1:
        errors.append("CP1 evidence schema_version должен иметь значение 1")

    expected_bases = {
        "analyzed_product_base_sha": document.get("ANALYZED_PRODUCT_BASE_SHA"),
        "implementation_base_sha": document.get("IMPLEMENTATION_BASE_SHA"),
    }
    if evidence.get("bases") != expected_bases:
        errors.append("CP1 evidence bases не совпадают с полями eval")

    checkpoint_commits = evidence.get("checkpoint_commits")
    if not isinstance(checkpoint_commits, dict) or set(checkpoint_commits) != set(CP1_COMMIT_KEYS):
        errors.append("CP1 evidence checkpoint_commits должен содержать точные Commit 1.1-1.4")
    elif not all(
        isinstance(checkpoint_commits[key], str) and SHA_RE.fullmatch(checkpoint_commits[key])
        for key in CP1_COMMIT_KEYS
    ):
        errors.append("CP1 evidence checkpoint SHAs должны быть полными Git SHA")
    elif len({checkpoint_commits[key] for key in CP1_COMMIT_KEYS}) != len(CP1_COMMIT_KEYS):
        errors.append("CP1 evidence checkpoint SHAs должны быть уникальными")
    elif checkpoint_commits != CP1_APPROVED_CHECKPOINT_COMMITS:
        errors.append("CP1 evidence checkpoint SHAs не совпадают с утверждённой идентичностью")

    eval_policy = evidence.get("eval_and_repository_policy")
    if not _mapping_with_outcome(eval_policy, "automated_pass"):
        errors.append("CP1 evidence evaluator/repository-policy outcome должен быть automated_pass")
    elif eval_policy.get("tests") != [
        "backend/tests/test_product_reset_eval.py",
        "backend/tests/test_repository_policy.py",
    ] or eval_policy.get("compose_harness") != "compose.test.yaml":
        errors.append("CP1 evidence evaluator/repository-policy paths не совпадают с contract")

    component = evidence.get("frontend_component_harness")
    if not _mapping_with_outcome(component, "automated_pass"):
        errors.append("CP1 evidence component harness outcome должен быть automated_pass")
    elif (
        component.get("runner") != "vitest"
        or component.get("config") != "frontend/vitest.config.ts"
        or component.get("round_trip_test")
        != "frontend/src/features/editor-core/serializers.test.ts"
    ):
        errors.append("CP1 evidence component harness contract не совпадает")

    browser = evidence.get("browser_harness")
    if not _mapping_with_outcome(browser, "automated_pass"):
        errors.append("CP1 evidence browser harness outcome должен быть automated_pass")
    elif (
        browser.get("runner") != "playwright"
        or browser.get("config") != "frontend/playwright.config.ts"
        or browser.get("desktop_projects") != ["chromium-1366", "chromium-1920"]
    ):
        errors.append("CP1 evidence browser harness contract не совпадает")

    characterization = evidence.get("characterization")
    required_characterization = {
        "backend_editor": "backend/tests/characterization/test_editor_contract.py",
        "captionpanels": "backend/tests/characterization/test_captionpanels_contract.py",
    }
    if not isinstance(characterization, dict):
        errors.append("CP1 evidence characterization должен быть JSON-объектом")
    else:
        for key, path in required_characterization.items():
            item = characterization.get(key)
            if not _mapping_with_outcome(item, "automated_pass") or item.get("test") != path:
                errors.append(f"CP1 evidence characterization.{key} невалиден")
        frontend_editor = characterization.get("frontend_editor")
        if not _mapping_with_outcome(frontend_editor, "automated_pass") or (
            frontend_editor.get("component_test")
            != "frontend/src/pages/__tests__/EditorPage.characterization.test.tsx"
            or frontend_editor.get("browser_test")
            != "frontend/e2e/editor-characterization.spec.ts"
        ):
            errors.append("CP1 evidence characterization.frontend_editor невалиден")

    known_failures = evidence.get("autosave_known_failures")
    if not isinstance(known_failures, list) or not all(isinstance(item, dict) for item in known_failures):
        errors.append("CP1 evidence autosave_known_failures должен быть списком объектов")
    else:
        ids = [item.get("id") for item in known_failures]
        if len(ids) != len(set(ids)):
            errors.append("CP1 evidence autosave IDs должны быть уникальными")
        if set(ids) != {"stale_suffix_loss", "autosave_layout_movement"}:
            errors.append("CP1 evidence должен содержать обе autosave-регрессии")
        by_id = {item.get("id"): item for item in known_failures}
        stale = by_id.get("stale_suffix_loss", {})
        if (
            stale.get("outcome") != "deterministic_expected_failure"
            or stale.get("component_test")
            != "frontend/src/pages/__tests__/EditorPage.autosave.known-failures.test.tsx"
            or stale.get("browser_test") != "frontend/e2e/editor-autosave-known-failures.spec.ts"
            or not isinstance(stale.get("expected_text"), str)
            or not isinstance(stale.get("observed_text"), str)
            or stale.get("expected_text") == stale.get("observed_text")
        ):
            errors.append("CP1 evidence stale suffix expected failure невалиден")
        layout = by_id.get("autosave_layout_movement", {})
        observed = layout.get("observed")
        required_max = layout.get("required_max")
        if (
            layout.get("outcome") != "deterministic_expected_failure"
            or layout.get("browser_test") != "frontend/e2e/editor-autosave-known-failures.spec.ts"
            or layout.get("metric") != "save_status_width_delta_px"
            or layout.get("assertion") != "observed <= required_max"
            or not _is_number(observed)
            or not _is_number(required_max)
            or required_max != 1
            or observed <= required_max
        ):
            errors.append("CP1 evidence layout measurement gate невалиден")

    synthetic = evidence.get("synthetic_fixture")
    if not _mapping_with_outcome(synthetic, "automated_pass") or synthetic != {
        "outcome": "automated_pass",
        "contract": "backend/tests/fixtures/synthetic_demo_contract.json",
        "validator": "backend/tests/synthetic_data_policy.py",
        "test": "backend/tests/test_demo_seed_policy.py",
    }:
        errors.append("CP1 evidence synthetic fixture contract невалиден")

    runtime_editor = evidence.get("runtime_editor")
    if not isinstance(runtime_editor, dict) or runtime_editor.get("paths") != list(CP1_RUNTIME_PATHS):
        errors.append("CP1 evidence runtime editor paths не совпадают с contract")

    commands = evidence.get("commands")
    if not isinstance(commands, list) or not all(isinstance(item, dict) for item in commands):
        errors.append("CP1 evidence commands должен быть списком объектов")
    else:
        command_ids = [item.get("id") for item in commands]
        if len(command_ids) != len(set(command_ids)):
            errors.append("CP1 evidence command IDs должны быть уникальными")
        if set(command_ids) != set(CP1_REQUIRED_COMMANDS):
            errors.append("CP1 evidence commands не покрывает точный обязательный набор")
        for item in commands:
            command_id = item.get("id")
            if command_id not in CP1_REQUIRED_COMMANDS:
                continue
            if item.get("command") != CP1_REQUIRED_COMMANDS[command_id]:
                errors.append(f"CP1 evidence command {command_id} не совпадает с contract")
            if not validate_command_results:
                continue

            exit_code = item.get("exit_code")
            count = item.get("count")
            outcome = item.get("outcome")
            reproducibility = item.get("reproducibility")
            if not isinstance(exit_code, int) or isinstance(exit_code, bool):
                errors.append(f"CP1 evidence command {command_id} exit_code должен быть целым")
            if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                errors.append(f"CP1 evidence command {command_id} count должен быть неотрицательным")
            if outcome not in {"automated_pass", "automated_failure"}:
                errors.append(f"CP1 evidence command {command_id}: поле outcome невалидно")
            if exit_code == 0 and (outcome != "automated_pass" or not isinstance(count, int) or count < 1):
                errors.append(f"CP1 evidence command {command_id} не подтвердил успешный результат")
            if isinstance(exit_code, int) and exit_code != 0:
                errors.append(f"Команда CP1 {command_id} завершилась с exit_code={exit_code}")
            expected_command_hash = _sha256_text(CP1_REQUIRED_COMMANDS[command_id])
            if not isinstance(reproducibility, dict) or (
                reproducibility.get("runner") != "product_reset_eval.py"
                or reproducibility.get("evaluated_commit") != checkpoint_evaluated_commit
                or reproducibility.get("command_sha256") != expected_command_hash
                or not isinstance(reproducibility.get("output_sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", reproducibility.get("output_sha256", ""))
                or not isinstance(reproducibility.get("summary"), str)
                or not reproducibility.get("summary")
                or not isinstance(reproducibility.get("duration_ms"), int)
                or reproducibility.get("duration_ms", -1) < 0
            ):
                errors.append(
                    f"CP1 evidence command {command_id}: метаданные воспроизводимости невалидны"
                )

    if validate_command_results and (
        not isinstance(checkpoint_evaluated_commit, str)
        or not SHA_RE.fullmatch(checkpoint_evaluated_commit)
    ):
        errors.append("checkpoint_results.CP1.evaluated_commit должен быть полным Git SHA")

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


def _git_run(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )


def _git_commit_exists(repo_root: Path, sha: str) -> bool:
    return _git_run(repo_root, "cat-file", "-e", f"{sha}^{{commit}}").returncode == 0


def _git_is_ancestor(repo_root: Path, ancestor: str, descendant: str) -> bool:
    return _git_run(repo_root, "merge-base", "--is-ancestor", ancestor, descendant).returncode == 0


def _git_diff_is_empty(repo_root: Path, base: str, commit: str, paths: tuple[str, ...]) -> bool:
    return _git_run(repo_root, "diff", "--quiet", base, commit, "--", *paths).returncode == 0


def _git_path_exists_at_commit(repo_root: Path, commit: str, path: str) -> bool:
    return _git_run(repo_root, "cat-file", "-e", f"{commit}:{path}").returncode == 0


def _git_dirty_paths(repo_root: Path) -> set[str]:
    completed = _git_run(repo_root, "status", "--porcelain", "--untracked-files=all")
    if completed.returncode != 0:
        raise ValueError(f"не удалось проверить чистоту Git worktree: {completed.stderr.strip()}")
    paths: set[str] = set()
    for line in completed.stdout.splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        paths.add(path)
    return paths


def _cp1_git_errors(document: Mapping[str, Any], repo_root: Path) -> list[str]:
    errors: list[str] = []
    latest_commit = document.get("commit")
    if (
        not isinstance(latest_commit, str)
        or not SHA_RE.fullmatch(latest_commit)
        or not _git_commit_exists(repo_root, latest_commit)
    ):
        return ["eval commit не существует как Git commit"]

    checkpoint_results = document.get("checkpoint_results")
    cp1 = checkpoint_results.get("CP1") if isinstance(checkpoint_results, dict) else None
    checkpoint_commit = cp1.get("evaluated_commit") if isinstance(cp1, dict) else None
    if (
        not isinstance(checkpoint_commit, str)
        or not SHA_RE.fullmatch(checkpoint_commit)
        or not _git_commit_exists(repo_root, checkpoint_commit)
    ):
        return ["checkpoint_results.CP1.evaluated_commit не существует как Git commit"]

    head = _git_head(repo_root)
    if not _git_is_ancestor(repo_root, latest_commit, head):
        errors.append("eval commit не является предком текущего HEAD")
    if not _git_is_ancestor(repo_root, checkpoint_commit, latest_commit):
        errors.append("CP1 evaluated_commit не является предком последнего eval commit")

    analyzed = document.get("ANALYZED_PRODUCT_BASE_SHA")
    implementation = document.get("IMPLEMENTATION_BASE_SHA")
    for label, sha in (
        ("ANALYZED_PRODUCT_BASE_SHA", analyzed),
        ("IMPLEMENTATION_BASE_SHA", implementation),
    ):
        if not isinstance(sha, str) or not SHA_RE.fullmatch(sha) or not _git_commit_exists(repo_root, sha):
            errors.append(f"{label} не существует как Git commit")
        elif not _git_is_ancestor(repo_root, sha, checkpoint_commit):
            errors.append(f"{label} не является предком CP1 evaluated_commit")

    evidence = cp1.get("evidence") if isinstance(cp1, dict) else None
    checkpoint_commits = evidence.get("checkpoint_commits") if isinstance(evidence, dict) else None
    if isinstance(checkpoint_commits, dict):
        previous: str | None = None
        for key in CP1_COMMIT_KEYS:
            sha = checkpoint_commits.get(key)
            if not isinstance(sha, str) or not SHA_RE.fullmatch(sha) or not _git_commit_exists(repo_root, sha):
                errors.append(f"CP1 evidence {key} не существует как Git commit")
                previous = None
                continue
            if not _git_is_ancestor(repo_root, sha, checkpoint_commit):
                errors.append(f"CP1 evidence {key} не является предком CP1 evaluated_commit")
            if previous is not None and not _git_is_ancestor(repo_root, previous, sha):
                errors.append(f"CP1 evidence {key} нарушает порядок ancestry")
            previous = sha

    if (
        isinstance(implementation, str)
        and SHA_RE.fullmatch(implementation)
        and _git_commit_exists(repo_root, implementation)
        and not _git_diff_is_empty(
            repo_root, implementation, checkpoint_commit, CP1_RUNTIME_PATHS
        )
    ):
        errors.append("runtime editor/CaptionPanels отличается от IMPLEMENTATION_BASE_SHA")

    for path in CP1_REFERENCED_FILES:
        if not _git_path_exists_at_commit(repo_root, checkpoint_commit, path):
            errors.append(f"CP1 evidence path отсутствует в CP1 evaluated_commit: {path}")
    return errors


def _checkpoint_evidence_errors(
    document: Mapping[str, Any], checkpoint: str, repo_root: Path | None = None
) -> list[str]:
    if checkpoint == "CP1":
        errors = _cp1_schema_errors(document)
        if repo_root is not None and not errors:
            errors.extend(_cp1_git_errors(document, repo_root))
        return errors

    checkpoint_results = document.get("checkpoint_results")
    checkpoint_result = (
        checkpoint_results.get(checkpoint) if isinstance(checkpoint_results, dict) else None
    )
    evidence = checkpoint_result.get("evidence") if isinstance(checkpoint_result, dict) else None
    if not isinstance(evidence, dict) or not evidence:
        return [f"checkpoint_results.{checkpoint}.evidence должен быть непустым JSON-объектом"]
    return []


def _checkpoint_result_errors(
    document: Mapping[str, Any], checkpoint: str, repo_root: Path | None = None
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    checkpoint_result = (
        checkpoint_results.get(checkpoint) if isinstance(checkpoint_results, dict) else None
    )
    if not isinstance(checkpoint_result, dict):
        return [f"checkpoint_results.{checkpoint} должен быть JSON-объектом"]

    errors: list[str] = []
    evaluated_commit = checkpoint_result.get("evaluated_commit")
    if checkpoint_result.get("passed") is True and (
        not isinstance(evaluated_commit, str) or not SHA_RE.fullmatch(evaluated_commit)
    ):
        errors.append(
            f"checkpoint_results.{checkpoint}.evaluated_commit должен быть полным Git SHA"
        )
    if checkpoint_result.get("passed") is not True:
        errors.append(f"checkpoint_results.{checkpoint}.passed должен иметь значение true")
    if checkpoint_result.get("missing") != []:
        errors.append(f"checkpoint_results.{checkpoint}.missing должен быть точным пустым списком")
    errors.extend(_checkpoint_evidence_errors(document, checkpoint, repo_root))

    failed_gates = document.get("failed_gates")
    if not isinstance(failed_gates, list) or not all(isinstance(item, str) for item in failed_gates):
        errors.append("failed_gates должен содержать только строки")
    else:
        declared_passed = (
            checkpoint_result.get("passed") is True and checkpoint_result.get("missing") == []
        )
        if declared_passed and checkpoint in failed_gates:
            errors.append(f"checkpoint {checkpoint} не может одновременно быть passed и failed")
        if not declared_passed and checkpoint not in failed_gates:
            errors.append(f"незавершённый checkpoint {checkpoint} должен присутствовать в failed_gates")
    return errors


def _all_local_checkpoint_results_valid(
    document: Mapping[str, Any], repo_root: Path | None = None
) -> bool:
    return all(not _checkpoint_result_errors(document, checkpoint, repo_root) for checkpoint in LOCAL_CHECKPOINTS)


def compute_full_eval_passed(
    document: Mapping[str, Any], *, repo_root: Path | None = None
) -> bool:
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
            _all_local_checkpoint_results_valid(document, repo_root),
            FINAL_CHECKPOINT in completed_set,
            external_demo_passed,
        )
    )


def evaluate_verification(
    document: Mapping[str, Any],
    *,
    scope: Literal["checkpoint", "final"],
    checkpoint: str | None = None,
    repo_root: Path | None = None,
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
    computed_full_eval_passed = compute_full_eval_passed(document, repo_root=repo_root)
    if document.get("full_eval_passed") is not computed_full_eval_passed:
        errors.append("full_eval_passed не соответствует вычисленному финальному состоянию")

    if scope == "checkpoint":
        if checkpoint not in completed_set:
            errors.append(f"checkpoint {checkpoint} не завершён")
        errors.extend(_checkpoint_result_errors(document, checkpoint, repo_root))
    elif not computed_full_eval_passed:
        errors.append("full_eval_passed имеет значение false")

    return VerificationResult(
        scope=scope,
        checkpoint=checkpoint,
        passed=not errors,
        errors=tuple(errors),
    )


def _git_head(repo_root: Path) -> str:
    completed = _git_run(repo_root, "rev-parse", "HEAD")
    if completed.returncode != 0:
        raise ValueError(f"не удалось определить Git HEAD: {completed.stderr.strip()}")
    return completed.stdout.strip()


CommandExecutor = Callable[
    [Path, dict[str, object]],
    subprocess.CompletedProcess[str],
]


def _default_command_executor(
    repo_root: Path, command_spec: dict[str, object]
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["/bin/sh", "-lc", str(command_spec["command"])],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )


def _command_count(command_id: str, output: str, exit_code: int) -> int:
    if exit_code != 0:
        return 0
    pattern = CP1_COMMAND_COUNT_PATTERNS[command_id]
    if pattern is None:
        return 1
    matches = pattern.findall(output)
    return int(matches[-1]) if matches else 0


def _run_cp1_commands(
    repo_root: Path,
    evaluated_commit: str,
    command_executor: CommandExecutor,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for command_id, command in CP1_REQUIRED_COMMANDS.items():
        command_spec: dict[str, object] = {"id": command_id, "command": command}
        print(f"Старт команды CP1: {command_id}", flush=True)
        started = time.monotonic()
        try:
            completed = command_executor(repo_root, command_spec)
        except Exception as exc:  # pragma: no cover - defensive boundary around process launch
            completed = subprocess.CompletedProcess(
                ["/bin/sh", "-lc", command],
                125,
                stdout="",
                stderr=f"ошибка запуска команды: {type(exc).__name__}",
            )
        if _git_head(repo_root) != evaluated_commit:
            raise ValueError("HEAD изменился во время выполнения команд CP1")
        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
        combined_output = f"{stdout}\n{stderr}"
        count = _command_count(command_id, combined_output, completed.returncode)
        passed = completed.returncode == 0 and count >= 1
        summary = (
            f"успешно; количество={count}"
            if passed
            else f"код_выхода={completed.returncode}; количество={count}"
        )
        results.append(
            {
                "id": command_id,
                "command": command,
                "exit_code": completed.returncode,
                "count": count,
                "outcome": "automated_pass" if passed else "automated_failure",
                "reproducibility": {
                    "runner": "product_reset_eval.py",
                    "evaluated_commit": evaluated_commit,
                    "command_sha256": _sha256_text(command),
                    "output_sha256": _sha256_text(combined_output),
                    "summary": summary,
                    "duration_ms": duration_ms,
                },
            }
        )
        print(
            f"Команда CP1 завершена: {command_id}; код={completed.returncode}; количество={count}",
            flush=True,
        )
    return results


def _sync_failed_gate(document: dict[str, Any], checkpoint: str, *, failed: bool) -> None:
    failed_gates = document.get("failed_gates")
    if not isinstance(failed_gates, list) or not all(isinstance(item, str) for item in failed_gates):
        raise ValueError("failed_gates должен содержать только строки")
    failed_set = set(failed_gates)
    if failed:
        failed_set.add(checkpoint)
    else:
        failed_set.discard(checkpoint)
    canonical_order = (*LOCAL_CHECKPOINTS, "external_demo")
    document["failed_gates"] = [item for item in canonical_order if item in failed_set] + sorted(
        failed_set - set(canonical_order)
    )


def run_checkpoint(
    repo_root: Path,
    checkpoint: str,
    *,
    command_executor: CommandExecutor | None = None,
) -> dict[str, Any]:
    if checkpoint not in (*LOCAL_CHECKPOINTS, FINAL_CHECKPOINT):
        raise ValueError(f"неизвестный checkpoint: {checkpoint}")
    result_path = repo_root / "docs/product-reset/EVAL_RESULT.json"
    dirty_paths = _git_dirty_paths(repo_root)
    if dirty_paths:
        raise ValueError(
            "checkpoint run требует чистый committed source tree; изменены: "
            + ", ".join(sorted(dirty_paths))
        )

    document = copy.deepcopy(load_eval_result(result_path))
    evaluated_head = _git_head(repo_root)
    document["commit"] = evaluated_head
    document["checkpoint"] = checkpoint

    if checkpoint in LOCAL_CHECKPOINTS:
        checkpoint_results = document.setdefault("checkpoint_results", {})
        if not isinstance(checkpoint_results, dict):
            raise ValueError("checkpoint_results должен быть JSON-объектом")
        checkpoint_result = checkpoint_results.setdefault(checkpoint, {})
        if not isinstance(checkpoint_result, dict):
            raise ValueError(f"checkpoint_results.{checkpoint} должен быть JSON-объектом")
        existing_evaluated_commit = checkpoint_result.get("evaluated_commit")
        if existing_evaluated_commit not in {None, evaluated_head}:
            raise ValueError(
                f"checkpoint_results.{checkpoint}.evaluated_commit неизменяем и уже привязан к "
                f"{existing_evaluated_commit}"
            )
        checkpoint_result["evaluated_commit"] = evaluated_head

        if checkpoint == "CP1":
            template_errors = _cp1_schema_errors(document, validate_command_results=False)
            if template_errors:
                raise ValueError("Шаблон evidence CP1 невалиден: " + "; ".join(template_errors))
            evidence = checkpoint_result.get("evidence")
            if not isinstance(evidence, dict):
                raise ValueError("checkpoint_results.CP1.evidence должен быть JSON-объектом")
            command_results = _run_cp1_commands(
                repo_root,
                str(document["commit"]),
                command_executor or _default_command_executor,
            )
            post_command_dirty_paths = _git_dirty_paths(repo_root)
            if post_command_dirty_paths:
                raise ValueError(
                    "канонические команды CP1 изменили дерево исходников: "
                    + ", ".join(sorted(post_command_dirty_paths))
                )
            evidence["commands"] = command_results

        evidence_errors = _checkpoint_evidence_errors(document, checkpoint, repo_root)
        checkpoint_result["passed"] = not evidence_errors
        checkpoint_result["missing"] = evidence_errors
        _sync_failed_gate(document, checkpoint, failed=bool(evidence_errors))

        completed, completed_is_valid = _completed_checkpoint_set(document)
        if not completed_is_valid:
            completed = set()
        if evidence_errors:
            completed.discard(checkpoint)
        else:
            completed.add(checkpoint)
        document["completed_checkpoints"] = [
            item for item in LOCAL_CHECKPOINTS if item in completed
        ] + ([FINAL_CHECKPOINT] if FINAL_CHECKPOINT in completed else [])

    document["full_eval_passed"] = compute_full_eval_passed(document, repo_root=repo_root)
    if _git_head(repo_root) != evaluated_head:
        raise ValueError("HEAD изменился до записи результата checkpoint")
    result_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return document
