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
EVAL_RESULT_RELATIVE_PATH = "docs/product-reset/EVAL_RESULT.json"
HISTORICAL_CHECKPOINT_BINDING_COMMITS = {
    "CP1": "57743e197f7c4c8a420673842d67e048c90d63c9",
    "CP2": "ec630cdddcd0e1cdbbde4eca696576636ff22a9a",
    "CP3": "82f5eaa793bf9d90d02997ba43a1742711d4a7fc",
}
HISTORICAL_CHECKPOINT_EVALUATED_COMMITS = {
    "CP1": "ee8efc5b04ebe3672f71f0c6c287ee634d994910",
    "CP2": "60c8f6721bcd3053c11fa2eb2316c8d8e94616fa",
    "CP3": "f867c470e917868e4b039d1d247ba61e8b79b791",
}
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
CP2_REQUIRED_COMMANDS = {
    "backend-full-suite": "cd backend && ./.venv/bin/pytest -q",
    "cp2-schema-seed-bridge-policy-suite": (
        "cd backend && ./.venv/bin/pytest -q tests/test_migration_baseline.py "
        "tests/test_demo_seed_policy.py tests/test_cp2_editor_bridge.py "
        "tests/test_legacy_gate.py tests/test_repository_policy.py"
    ),
    "cp2-clean-schema-upgrade": (
        "cd backend && rm -f /tmp/newscast-cp2-eval.db && ENVIRONMENT=test "
        "DATABASE_URL=sqlite+pysqlite:////tmp/newscast-cp2-eval.db "
        "CORS_ORIGINS=http://127.0.0.1:5173 SECRET_KEY=product-reset-cp2-eval "
        "./.venv/bin/alembic upgrade head && rm -f /tmp/newscast-cp2-eval.db"
    ),
    "frontend-production-build": "cd frontend && npm run build",
}
CP2_COMMAND_COUNT_PATTERNS = {
    "backend-full-suite": re.compile(r"(\d+) passed"),
    "cp2-schema-seed-bridge-policy-suite": re.compile(r"(\d+) passed"),
    "cp2-clean-schema-upgrade": None,
    "frontend-production-build": re.compile(r"(\d+) modules transformed"),
}
CP3_REQUIRED_COMMANDS = {
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
CP3_COMMAND_COUNT_PATTERNS = {
    "backend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-production-build": re.compile(r"(\d+) modules transformed"),
    "browser-scenario-history-chromium-1366": re.compile(r"(\d+) passed"),
    "browser-scenario-chromium-1920": re.compile(r"(\d+) passed"),
}
CP4_REQUIRED_COMMANDS = {
    "backend-full-suite": "cd backend && ./.venv/bin/pytest -q",
    "frontend-full-suite": (
        "cd frontend && NODE_OPTIONS=--no-experimental-webstorage npm test -- --run"
    ),
    "frontend-production-build": "cd frontend && npm run build",
    "browser-production-chromium-1366": (
        "cd frontend && npx playwright test production-workflow.spec.ts "
        "--project=chromium-1366"
    ),
    "frontend-production-denylist": (
        'rg -n "buildProductionGates|getCurrentProductionGate|syncProject.*Text|'
        '_requires_resync" frontend/src'
    ),
}
CP4_COMMAND_COUNT_PATTERNS = {
    "backend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-production-build": re.compile(r"(\d+) modules transformed"),
    "browser-production-chromium-1366": re.compile(r"(\d+) passed"),
    "frontend-production-denylist": re.compile(r"(?m)^.+$"),
}
CP4_EXPECTED_EXIT_CODES = {
    command_id: 1 if command_id == "frontend-production-denylist" else 0
    for command_id in CP4_REQUIRED_COMMANDS
}
CP4_COUNT_RULES = {
    command_id: "zero" if command_id == "frontend-production-denylist" else "positive"
    for command_id in CP4_REQUIRED_COMMANDS
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
CP2_BASELINE_MIGRATION = "backend/migrations/versions/20260710_0001_product_reset.py"
CP2_BRIDGE_PATHS = (
    "backend/app/api/routes/editor.py",
    "backend/app/schemas/editor.py",
    "frontend/src/pages/EditorPage.tsx",
    "frontend/src/features/scenario/legacyBridgeApi.ts",
    "frontend/src/features/scenario/legacyBridgeTypes.ts",
)
CP2_REFERENCED_FILES = (
    CP2_BASELINE_MIGRATION,
    "backend/app/services/demo_seed.py",
    "backend/tests/test_migration_baseline.py",
    "backend/tests/test_demo_seed_policy.py",
    "backend/tests/test_cp2_editor_bridge.py",
    "backend/tests/test_legacy_gate.py",
    *CP2_BRIDGE_PATHS,
)
CP3_REQUIRED_EVIDENCE = {
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
        "removed_bridge_paths": list(CP2_BRIDGE_PATHS),
        "tests": [
            "backend/tests/test_legacy_gate.py",
            "backend/tests/test_repository_policy.py",
        ],
    },
}
CP3_REFERENCED_FILES = tuple(
    dict.fromkeys(
        path
        for section in CP3_REQUIRED_EVIDENCE.values()
        for field in ("sources", "tests", "browser_specs")
        for path in section.get(field, [])
    )
) + ("docs/product-reset/LEGACY_DENYLIST.txt",)
CP4_REQUIRED_EVIDENCE = {
    "editorial_workflow": {
        "outcome": "automated_pass",
        "contracts": [
            "revision_bound_review_request",
            "revision_bound_editorial_mark",
            "revision_bound_proofread_mark",
            "combined_functions_without_self_request",
            "leadership_only_explicit_reproofread_after_late_edit",
        ],
        "sources": [
            "backend/app/api/routes/workflow.py",
            "backend/app/schemas/workflow.py",
            "backend/app/services/workflow_service.py",
            "backend/app/services/action_policy.py",
            "frontend/src/features/workflow/api.ts",
            "frontend/src/features/workflow/types.ts",
            "frontend/src/features/workflow/components/WorkflowSummary.tsx",
            "frontend/src/features/workflow/components/WorkflowActions.tsx",
        ],
        "integration_sources": [
            "backend/app/main.py",
            "backend/app/services/scenario_history.py",
            "backend/app/services/scenario_service.py",
            "backend/app/services/permissions.py",
            "frontend/src/features/scenario/components/ScenarioEditor.tsx",
            "frontend/src/features/scenario/useScenarioAutosave.ts",
            "frontend/src/pages/StoryScenarioPage.tsx",
            "frontend/src/styles/scenario.css",
        ],
        "tests": [
            "backend/tests/test_editorial_workflow.py",
            "frontend/src/features/workflow/WorkflowActions.test.tsx",
        ],
        "integration_tests": [
            "backend/tests/test_permissions.py",
            "frontend/src/features/scenario/ScenarioEditor.autosave.test.tsx",
            "frontend/e2e/scenario-autosave.spec.ts",
        ],
    },
    "production_workflow": {
        "outcome": "automated_pass",
        "contracts": [
            "leadership_assignment_management",
            "all_active_users_add_materials",
            "binary_voiceover_state",
            "video_start_before_text_gates",
            "video_ready_with_open_correction_gate",
            "initial_titles_gate_requires_editorial_proofread_video_approval",
            "late_edit_does_not_block_started_titles",
        ],
        "assignment_kinds": ["proofreader", "video_editor", "designer"],
        "material_mutation_ids": ["material_add"],
        "transition_ids": [
            "voiceover_ready",
            "voiceover_not_ready",
            "video_start",
            "video_ready",
            "video_approve_for_titles",
            "titles_start",
            "titles_ready",
            "titles_accept",
        ],
        "gate_ids": [
            "open_video_correction_blocks_video_ready",
            "editorial_mark_required_for_video_approve_for_titles",
            "proofread_mark_required_for_video_approve_for_titles",
            "video_approval_required_for_titles_start",
            "open_titles_correction_blocks_titles_ready",
        ],
        "sources": [
            "backend/app/api/routes/production.py",
            "backend/app/schemas/production.py",
            "backend/app/services/production_service.py",
            "backend/app/services/action_policy.py",
            "backend/app/services/permissions.py",
        ],
        "integration_sources": [
            "backend/app/main.py",
            "frontend/src/app/AppRouter.tsx",
            "frontend/src/pages/StoryScenarioPage.tsx",
            "frontend/src/styles.css",
            "frontend/src/styles/production.css",
        ],
        "tests": ["backend/tests/test_production_workflow.py"],
        "integration_tests": [
            "backend/tests/test_permissions.py",
            "frontend/e2e/production-workflow.spec.ts",
        ],
    },
    "revision_and_read_markers": {
        "outcome": "automated_pass",
        "current_scenario_revision_binding": True,
        "late_edit_preserves_editorial_and_proofread_marks": True,
        "late_edit_keeps_started_titles_unblocked": True,
        "read_marker_contexts": ["video", "titles"],
        "read_markers_actor_specific": True,
        "production_get_updates_read_markers": False,
        "sources": [
            "backend/app/services/workflow_service.py",
            "backend/app/services/scenario_service.py",
            "backend/app/services/scenario_sessions.py",
            "backend/app/services/production_service.py",
        ],
        "tests": [
            "backend/tests/test_editorial_workflow.py",
            "backend/tests/test_production_workflow.py",
            "backend/tests/test_production_read_model.py",
        ],
    },
    "server_read_model": {
        "outcome": "automated_pass",
        "production_stages_source": "server",
        "production_actions_source": "server",
        "one_primary_action": True,
        "archived_story_read_only": True,
        "sources": [
            "backend/app/schemas/production.py",
            "backend/app/services/production_service.py",
            "backend/app/services/action_policy.py",
        ],
        "tests": ["backend/tests/test_production_read_model.py"],
    },
    "frontend_production": {
        "outcome": "automated_pass",
        "route": "/stories/:id/production",
        "story_tabs": ["scenario", "production", "history"],
        "production_actions_source": "server",
        "scenario_rows_hydrated_for_production_actions": False,
        "frontend_gate_status_calculator": False,
        "forbidden_identifiers": [
            "buildProductionGates",
            "getCurrentProductionGate",
            "syncProject.*Text",
            "_requires_resync",
        ],
        "sources": [
            "frontend/src/app/AppRouter.tsx",
            "frontend/src/features/stories/components/StoryTabs.tsx",
            "frontend/src/pages/StoryProductionPage.tsx",
            "frontend/src/features/production/api.ts",
            "frontend/src/features/production/types.ts",
            "frontend/src/features/production/components/ProductionStages.tsx",
            "frontend/src/features/production/components/ProductionActions.tsx",
            "frontend/src/features/production/components/MaterialsList.tsx",
            "frontend/src/features/production/components/VoiceoverState.tsx",
            "frontend/src/styles/production.css",
        ],
        "tests": ["frontend/src/features/production/ProductionReadModel.test.tsx"],
    },
    "deterministic_tests": {
        "outcome": "automated_pass",
        "backend_tests": [
            "backend/tests/test_product_reset_eval.py",
            "backend/tests/test_repository_policy.py",
            "backend/tests/test_editorial_workflow.py",
            "backend/tests/test_production_workflow.py",
            "backend/tests/test_production_read_model.py",
        ],
        "component_tests": [
            "frontend/src/features/workflow/WorkflowActions.test.tsx",
            "frontend/src/features/production/ProductionReadModel.test.tsx",
        ],
        "browser_specs": ["frontend/e2e/production-workflow.spec.ts"],
        "browser_projects": ["chromium-1366"],
    },
}
CP4_REFERENCED_FILES = tuple(
    dict.fromkeys(
        path
        for section in CP4_REQUIRED_EVIDENCE.values()
        for field in (
            "sources",
            "integration_sources",
            "tests",
            "integration_tests",
            "backend_tests",
            "component_tests",
            "browser_specs",
        )
        for path in section.get(field, [])
    )
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


def _exact_contract_match(value: object, expected: object) -> bool:
    if type(value) is not type(expected):
        return False
    if isinstance(expected, dict):
        return set(value) == set(expected) and all(
            _exact_contract_match(value[key], expected[key]) for key in expected
        )
    if isinstance(expected, list):
        return len(value) == len(expected) and all(
            _exact_contract_match(actual_item, expected_item)
            for actual_item, expected_item in zip(value, expected, strict=True)
        )
    return value == expected


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


def _cp2_schema_errors(
    document: Mapping[str, Any], *, validate_command_results: bool = True
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    cp2 = checkpoint_results.get("CP2") if isinstance(checkpoint_results, dict) else None
    evidence = cp2.get("evidence") if isinstance(cp2, dict) else None
    if not isinstance(evidence, dict):
        return ["checkpoint_results.CP2.evidence должен быть JSON-объектом"]

    errors: list[str] = []
    if evidence.get("schema_version") != 1:
        errors.append("CP2 evidence schema_version должен иметь значение 1")

    if evidence.get("baseline_migration") != {
        "outcome": "automated_pass",
        "path": CP2_BASELINE_MIGRATION,
        "revision": "20260710_0001",
        "test": "backend/tests/test_migration_baseline.py",
    }:
        errors.append("CP2 evidence baseline migration невалиден")

    if evidence.get("synthetic_demo_seed") != {
        "outcome": "automated_pass",
        "service": "backend/app/services/demo_seed.py",
        "test": "backend/tests/test_demo_seed_policy.py",
        "users": 8,
        "active_stories": 30,
        "archived_stories": 5,
    }:
        errors.append("CP2 evidence actual synthetic seed невалиден")

    if evidence.get("clean_schema") != {
        "outcome": "automated_pass",
        "test": "backend/tests/test_migration_baseline.py",
        "empty_database_upgrade": "alembic upgrade head",
    }:
        errors.append("CP2 evidence clean schema невалиден")

    if evidence.get("permitted_editor_bridges") != [
        {
            "id": "story_editor_compatibility_bridge",
            "outcome": "automated_pass",
            "test": "backend/tests/test_cp2_editor_bridge.py",
            "paths": list(CP2_BRIDGE_PATHS),
        }
    ]:
        errors.append("CP2 evidence должен содержать ровно один разрешённый editor bridge")

    commands = evidence.get("commands")
    if not validate_command_results and commands == []:
        return errors
    if not isinstance(commands, list) or not all(isinstance(item, dict) for item in commands):
        errors.append("CP2 evidence commands должен быть списком объектов")
    else:
        command_ids = [item.get("id") for item in commands]
        if len(command_ids) != len(set(command_ids)):
            errors.append("CP2 evidence command IDs должны быть уникальными")
        if set(command_ids) != set(CP2_REQUIRED_COMMANDS):
            errors.append("CP2 evidence commands не покрывает точный обязательный набор")
        for item in commands:
            command_id = item.get("id")
            if command_id not in CP2_REQUIRED_COMMANDS:
                continue
            command = CP2_REQUIRED_COMMANDS[command_id]
            if item.get("command") != command:
                errors.append(f"CP2 evidence command {command_id} не совпадает с contract")
            if not validate_command_results:
                continue
            exit_code = item.get("exit_code")
            count = item.get("count")
            outcome = item.get("outcome")
            reproducibility = item.get("reproducibility")
            if not isinstance(exit_code, int) or isinstance(exit_code, bool):
                errors.append(f"CP2 evidence command {command_id} exit_code должен быть целым")
            if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                errors.append(f"CP2 evidence command {command_id} count должен быть неотрицательным")
            if outcome not in {"automated_pass", "automated_failure"}:
                errors.append(f"CP2 evidence command {command_id}: поле outcome невалидно")
            if exit_code == 0 and (
                outcome != "automated_pass" or not isinstance(count, int) or count < 1
            ):
                errors.append(f"CP2 evidence command {command_id} не подтвердил успешный результат")
            if isinstance(exit_code, int) and exit_code != 0:
                errors.append(f"Команда CP2 {command_id} завершилась с exit_code={exit_code}")
            expected_command_hash = _sha256_text(command)
            if not isinstance(reproducibility, dict) or (
                reproducibility.get("runner") != "product_reset_eval.py"
                or reproducibility.get("evaluated_commit") != cp2.get("evaluated_commit")
                or reproducibility.get("command_sha256") != expected_command_hash
                or not isinstance(reproducibility.get("output_sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", reproducibility.get("output_sha256", ""))
                or not isinstance(reproducibility.get("summary"), str)
                or not reproducibility.get("summary")
                or not isinstance(reproducibility.get("duration_ms"), int)
                or reproducibility.get("duration_ms", -1) < 0
            ):
                errors.append(
                    f"CP2 evidence command {command_id}: метаданные воспроизводимости невалидны"
                )

    if validate_command_results and (
        not isinstance(cp2.get("evaluated_commit"), str)
        or not SHA_RE.fullmatch(cp2.get("evaluated_commit"))
    ):
        errors.append("checkpoint_results.CP2.evaluated_commit должен быть полным Git SHA")
    return errors


def _cp3_schema_errors(
    document: Mapping[str, Any], *, validate_command_results: bool = True
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    cp3 = checkpoint_results.get("CP3") if isinstance(checkpoint_results, dict) else None
    evidence = cp3.get("evidence") if isinstance(cp3, dict) else None
    if not isinstance(evidence, dict):
        return ["checkpoint_results.CP3.evidence должен быть JSON-объектом"]

    errors: list[str] = []
    try:
        serialized = json.dumps(evidence, ensure_ascii=False).casefold()
    except (TypeError, ValueError):
        return ["checkpoint_results.CP3.evidence должен быть сериализуемым JSON"]
    for marker in INVALID_EVIDENCE_MARKERS:
        if marker in serialized:
            errors.append(f"CP3 evidence содержит запрещённый маркер: {marker}")

    expected_keys = {"schema_version", *CP3_REQUIRED_EVIDENCE, "commands"}
    if set(evidence) != expected_keys:
        errors.append("CP3 evidence должен содержать точный структурированный contract")
    if evidence.get("schema_version") != 1:
        errors.append("CP3 evidence schema_version должен иметь значение 1")
    for section, expected in CP3_REQUIRED_EVIDENCE.items():
        if evidence.get(section) != expected:
            errors.append(f"CP3 evidence {section} не совпадает с contract")

    commands = evidence.get("commands")
    if not validate_command_results and commands == []:
        return errors
    if not isinstance(commands, list) or not all(isinstance(item, dict) for item in commands):
        errors.append("CP3 evidence commands должен быть списком объектов")
    else:
        command_ids = [item.get("id") for item in commands]
        if len(command_ids) != len(set(command_ids)):
            errors.append("CP3 evidence command IDs должны быть уникальными")
        if set(command_ids) != set(CP3_REQUIRED_COMMANDS):
            errors.append("CP3 evidence commands не покрывает точный обязательный набор")
        for item in commands:
            command_id = item.get("id")
            if command_id not in CP3_REQUIRED_COMMANDS:
                continue
            command = CP3_REQUIRED_COMMANDS[command_id]
            if item.get("command") != command:
                errors.append(f"CP3 evidence command {command_id} не совпадает с contract")
            if not validate_command_results:
                continue
            exit_code = item.get("exit_code")
            count = item.get("count")
            outcome = item.get("outcome")
            reproducibility = item.get("reproducibility")
            if not isinstance(exit_code, int) or isinstance(exit_code, bool):
                errors.append(f"CP3 evidence command {command_id} exit_code должен быть целым")
            if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                errors.append(f"CP3 evidence command {command_id} count должен быть неотрицательным")
            if outcome not in {"automated_pass", "automated_failure"}:
                errors.append(f"CP3 evidence command {command_id}: поле outcome невалидно")
            if exit_code == 0 and (
                outcome != "automated_pass" or not isinstance(count, int) or count < 1
            ):
                errors.append(f"CP3 evidence command {command_id} не подтвердил успешный результат")
            if isinstance(exit_code, int) and exit_code != 0:
                errors.append(f"Команда CP3 {command_id} завершилась с exit_code={exit_code}")
            expected_command_hash = _sha256_text(command)
            if not isinstance(reproducibility, dict) or (
                reproducibility.get("runner") != "product_reset_eval.py"
                or reproducibility.get("evaluated_commit") != cp3.get("evaluated_commit")
                or reproducibility.get("command_sha256") != expected_command_hash
                or not isinstance(reproducibility.get("output_sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", reproducibility.get("output_sha256", ""))
                or not isinstance(reproducibility.get("summary"), str)
                or not reproducibility.get("summary")
                or not isinstance(reproducibility.get("duration_ms"), int)
                or isinstance(reproducibility.get("duration_ms"), bool)
                or reproducibility.get("duration_ms", -1) < 0
            ):
                errors.append(
                    f"CP3 evidence command {command_id}: метаданные воспроизводимости невалидны"
                )

    if validate_command_results and (
        not isinstance(cp3.get("evaluated_commit"), str)
        or not SHA_RE.fullmatch(cp3.get("evaluated_commit"))
    ):
        errors.append("checkpoint_results.CP3.evaluated_commit должен быть полным Git SHA")
    return errors


def _cp4_schema_errors(
    document: Mapping[str, Any], *, validate_command_results: bool = True
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    cp4 = checkpoint_results.get("CP4") if isinstance(checkpoint_results, dict) else None
    evidence = cp4.get("evidence") if isinstance(cp4, dict) else None
    if not isinstance(evidence, dict):
        return ["checkpoint_results.CP4.evidence должен быть JSON-объектом"]

    errors: list[str] = []
    try:
        serialized = json.dumps(evidence, ensure_ascii=False).casefold()
    except (TypeError, ValueError):
        return ["checkpoint_results.CP4.evidence должен быть сериализуемым JSON"]
    for marker in INVALID_EVIDENCE_MARKERS:
        if marker in serialized:
            errors.append(f"CP4 evidence содержит запрещённый маркер: {marker}")

    expected_keys = {"schema_version", *CP4_REQUIRED_EVIDENCE, "commands"}
    if set(evidence) != expected_keys:
        errors.append("CP4 evidence должен содержать точный структурированный contract")
    if type(evidence.get("schema_version")) is not int or evidence.get("schema_version") != 1:
        errors.append("CP4 evidence schema_version должен иметь значение 1")
    for section, expected in CP4_REQUIRED_EVIDENCE.items():
        if not _exact_contract_match(evidence.get(section), expected):
            errors.append(f"CP4 evidence {section} не совпадает с contract")

    commands = evidence.get("commands")
    if not validate_command_results and commands == []:
        return errors
    if not isinstance(commands, list) or not all(isinstance(item, dict) for item in commands):
        errors.append("CP4 evidence commands должен быть списком объектов")
    else:
        command_ids = [item.get("id") for item in commands]
        ids_are_strings = all(isinstance(command_id, str) for command_id in command_ids)
        if not ids_are_strings or len(command_ids) != len(set(command_ids)):
            errors.append("CP4 evidence command IDs должны быть уникальными строками")
        unknown_ids = [
            command_id
            for command_id in command_ids
            if not isinstance(command_id, str) or command_id not in CP4_REQUIRED_COMMANDS
        ]
        for command_id in unknown_ids:
            errors.append(f"CP4 evidence содержит неизвестный command ID: {command_id}")
        if command_ids != list(CP4_REQUIRED_COMMANDS):
            errors.append("CP4 evidence commands должны идти в точном порядке contract")

        expected_record_keys = {
            "id",
            "command",
            "expected_exit_code",
            "exit_code",
            "count",
            "outcome",
            "reproducibility",
        }
        expected_reproducibility_keys = {
            "runner",
            "evaluated_commit",
            "command_sha256",
            "output_sha256",
            "summary",
            "duration_ms",
        }
        for item in commands:
            command_id = item.get("id")
            if set(item) != expected_record_keys:
                errors.append(f"CP4 evidence command {command_id}: запись должна иметь точные поля")
            if not isinstance(command_id, str) or command_id not in CP4_REQUIRED_COMMANDS:
                continue

            command = CP4_REQUIRED_COMMANDS[command_id]
            expected_exit_code = CP4_EXPECTED_EXIT_CODES[command_id]
            count_rule = CP4_COUNT_RULES[command_id]
            if item.get("command") != command:
                errors.append(f"CP4 evidence command {command_id} не совпадает с contract")
            recorded_expected_exit_code = item.get("expected_exit_code")
            if (
                not isinstance(recorded_expected_exit_code, int)
                or isinstance(recorded_expected_exit_code, bool)
                or recorded_expected_exit_code != expected_exit_code
            ):
                errors.append(
                    f"CP4 evidence command {command_id}: expected_exit_code не совпадает с contract"
                )
            if not validate_command_results:
                continue

            exit_code = item.get("exit_code")
            count = item.get("count")
            outcome = item.get("outcome")
            if not isinstance(exit_code, int) or isinstance(exit_code, bool):
                errors.append(f"CP4 evidence command {command_id}: exit_code должен быть целым")
            if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                errors.append(
                    f"CP4 evidence command {command_id}: count должен быть неотрицательным"
                )
            count_is_valid = (
                isinstance(count, int)
                and not isinstance(count, bool)
                and (
                    (count_rule == "positive" and count >= 1)
                    or (count_rule == "zero" and count == 0)
                )
            )
            command_passed = (
                isinstance(exit_code, int)
                and not isinstance(exit_code, bool)
                and exit_code == expected_exit_code
                and count_is_valid
            )
            if outcome not in {"automated_pass", "automated_failure"}:
                errors.append(f"CP4 evidence command {command_id}: поле outcome невалидно")
            if not command_passed or outcome != "automated_pass":
                errors.append(
                    f"CP4 evidence command {command_id} не подтвердил expected exit/count contract"
                )

            reproducibility = item.get("reproducibility")
            expected_command_hash = _sha256_text(command)
            if not isinstance(reproducibility, dict) or (
                set(reproducibility) != expected_reproducibility_keys
                or reproducibility.get("runner") != "product_reset_eval.py"
                or reproducibility.get("evaluated_commit") != cp4.get("evaluated_commit")
                or reproducibility.get("command_sha256") != expected_command_hash
                or not isinstance(reproducibility.get("output_sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", reproducibility.get("output_sha256", ""))
                or not isinstance(reproducibility.get("summary"), str)
                or not reproducibility.get("summary")
                or not isinstance(reproducibility.get("duration_ms"), int)
                or isinstance(reproducibility.get("duration_ms"), bool)
                or reproducibility.get("duration_ms", -1) < 0
            ):
                errors.append(
                    f"CP4 evidence command {command_id}: метаданные воспроизводимости невалидны"
                )

    if validate_command_results and (
        not isinstance(cp4.get("evaluated_commit"), str)
        or not SHA_RE.fullmatch(cp4.get("evaluated_commit"))
    ):
        errors.append("checkpoint_results.CP4.evaluated_commit должен быть полным Git SHA")
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


def _git_file_at_commit(repo_root: Path, commit: str, path: str) -> str | None:
    completed = _git_run(repo_root, "show", f"{commit}:{path}")
    return completed.stdout if completed.returncode == 0 else None


def _historical_checkpoint_binding_errors(
    document: Mapping[str, Any], repo_root: Path
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    if not isinstance(checkpoint_results, dict):
        return ["checkpoint_results должен быть JSON-объектом для pinned historical evidence"]

    errors: list[str] = []
    for checkpoint, binding_commit in HISTORICAL_CHECKPOINT_BINDING_COMMITS.items():
        expected_evaluated_commit = HISTORICAL_CHECKPOINT_EVALUATED_COMMITS[checkpoint]
        if not _git_commit_exists(repo_root, binding_commit):
            errors.append(f"{checkpoint} pinned binding commit недоступен: {binding_commit}")
            continue

        serialized_binding = _git_file_at_commit(
            repo_root,
            binding_commit,
            EVAL_RESULT_RELATIVE_PATH,
        )
        if serialized_binding is None:
            errors.append(
                f"{checkpoint} pinned binding evidence недоступен в commit {binding_commit}"
            )
            continue
        try:
            binding_document = json.loads(serialized_binding)
        except json.JSONDecodeError:
            errors.append(f"{checkpoint} pinned binding evidence содержит невалидный JSON")
            continue
        if not isinstance(binding_document, dict):
            errors.append(f"{checkpoint} pinned binding evidence должен быть JSON-объектом")
            continue

        binding_results = binding_document.get("checkpoint_results")
        pinned_result = (
            binding_results.get(checkpoint) if isinstance(binding_results, dict) else None
        )
        current_result = checkpoint_results.get(checkpoint)
        if not isinstance(pinned_result, dict):
            errors.append(f"{checkpoint} subtree отсутствует в pinned binding evidence")
            continue
        if pinned_result.get("evaluated_commit") != expected_evaluated_commit:
            errors.append(
                f"{checkpoint} pinned binding evaluated_commit не совпадает с registry"
            )
        if not isinstance(current_result, dict):
            errors.append(f"{checkpoint} evidence отсутствует в текущем eval result")
            continue
        if current_result.get("evaluated_commit") != expected_evaluated_commit:
            errors.append(
                f"{checkpoint}.evaluated_commit не совпадает с pinned evaluated commit"
            )
        if not _exact_contract_match(current_result, pinned_result):
            errors.append(f"{checkpoint} evidence не совпадает с pinned binding")
    return errors


def _git_paths_at_commit(repo_root: Path, commit: str, path: str) -> set[str] | None:
    completed = _git_run(repo_root, "ls-tree", "-r", "--name-only", commit, "--", path)
    if completed.returncode != 0:
        return None
    return {item for item in completed.stdout.splitlines() if item}


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


def _cp2_git_errors(document: Mapping[str, Any], repo_root: Path) -> list[str]:
    errors: list[str] = []
    checkpoint_results = document.get("checkpoint_results")
    cp1 = checkpoint_results.get("CP1") if isinstance(checkpoint_results, dict) else None
    cp2 = checkpoint_results.get("CP2") if isinstance(checkpoint_results, dict) else None
    checkpoint_commit = cp2.get("evaluated_commit") if isinstance(cp2, dict) else None
    latest_commit = document.get("commit")
    if (
        not isinstance(checkpoint_commit, str)
        or not SHA_RE.fullmatch(checkpoint_commit)
        or not _git_commit_exists(repo_root, checkpoint_commit)
    ):
        return ["checkpoint_results.CP2.evaluated_commit не существует как Git commit"]
    if (
        not isinstance(latest_commit, str)
        or not SHA_RE.fullmatch(latest_commit)
        or not _git_commit_exists(repo_root, latest_commit)
    ):
        return ["eval commit не существует как Git commit"]
    if not _git_is_ancestor(repo_root, latest_commit, _git_head(repo_root)):
        errors.append("eval commit не является предком текущего HEAD")
    if not _git_is_ancestor(repo_root, checkpoint_commit, latest_commit):
        errors.append("CP2 evaluated_commit не является предком eval commit")

    cp1_commit = cp1.get("evaluated_commit") if isinstance(cp1, dict) else None
    if (
        not isinstance(cp1_commit, str)
        or not SHA_RE.fullmatch(cp1_commit)
        or not _git_commit_exists(repo_root, cp1_commit)
        or not _git_is_ancestor(repo_root, cp1_commit, checkpoint_commit)
    ):
        errors.append("CP1 evaluated_commit не является предком CP2 evaluated_commit")

    for label in ("ANALYZED_PRODUCT_BASE_SHA", "IMPLEMENTATION_BASE_SHA"):
        base = document.get(label)
        if (
            not isinstance(base, str)
            or not SHA_RE.fullmatch(base)
            or not _git_commit_exists(repo_root, base)
            or not _git_is_ancestor(repo_root, base, checkpoint_commit)
        ):
            errors.append(f"{label} не является предком CP2 evaluated_commit")

    for path in CP2_REFERENCED_FILES:
        if not _git_path_exists_at_commit(repo_root, checkpoint_commit, path):
            errors.append(f"CP2 evidence path отсутствует в CP2 evaluated_commit: {path}")

    migration_paths = _git_paths_at_commit(
        repo_root, checkpoint_commit, "backend/migrations/versions"
    )
    if migration_paths is None or {path for path in migration_paths if path.endswith(".py")} != {
        CP2_BASELINE_MIGRATION
    }:
        errors.append("CP2 evaluated_commit должен содержать ровно одну baseline migration")
    errors.extend(_cp2_historical_bridge_errors(repo_root, checkpoint_commit))
    return errors


def _cp2_historical_bridge_errors(repo_root: Path, checkpoint_commit: str) -> list[str]:
    errors: list[str] = []
    denylist = _git_file_at_commit(
        repo_root, checkpoint_commit, "docs/product-reset/LEGACY_DENYLIST.txt"
    )
    if denylist is None:
        return ["CP2 evaluated_commit не содержит legacy denylist"]
    sections: dict[str, set[str]] = {}
    current_section: set[str] | None = None
    for raw_line in denylist.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            current_section = sections.setdefault(line[1:-1], set())
            continue
        if current_section is None:
            return ["CP2 legacy denylist имеет entry вне section"]
        current_section.add(line)
    if sections.get("allowed_until_cp3") != set(CP2_BRIDGE_PATHS):
        errors.append("CP2 historical denylist не содержит точный единственный bridge allowlist")

    legacy_gate = _git_file_at_commit(
        repo_root, checkpoint_commit, "backend/tests/test_legacy_gate.py"
    )
    if legacy_gate is None or not all(
        marker in legacy_gate
        for marker in (
            "test_cp2_denylist_allows_only_exact_bridge_files_until_cp3",
            "test_cp2_bridge_types_are_not_imported_outside_the_exact_allowlist",
        )
    ):
        errors.append("CP2 historical legacy gate не подтверждает bridge policy")

    frontend_paths = _git_paths_at_commit(repo_root, checkpoint_commit, "frontend/src")
    if frontend_paths is None:
        return [*errors, "CP2 evaluated_commit не содержит frontend source tree"]
    allowed_type_importers = {
        "frontend/src/pages/EditorPage.tsx",
        "frontend/src/features/scenario/legacyBridgeApi.ts",
        "frontend/src/features/scenario/legacyBridgeTypes.ts",
    }
    for path in frontend_paths:
        if not path.endswith((".ts", ".tsx")) or "/__tests__/" in path:
            continue
        if path.endswith((".test.ts", ".test.tsx")):
            continue
        source = _git_file_at_commit(repo_root, checkpoint_commit, path)
        if source is not None and "legacyBridgeTypes" in source and path not in allowed_type_importers:
            errors.append(f"CP2 historical bridge import outside allowlist: {path}")
    return errors


def _cp3_git_errors(document: Mapping[str, Any], repo_root: Path) -> list[str]:
    errors: list[str] = []
    checkpoint_results = document.get("checkpoint_results")
    cp2 = checkpoint_results.get("CP2") if isinstance(checkpoint_results, dict) else None
    cp3 = checkpoint_results.get("CP3") if isinstance(checkpoint_results, dict) else None
    cp2_commit = cp2.get("evaluated_commit") if isinstance(cp2, dict) else None
    cp3_commit = cp3.get("evaluated_commit") if isinstance(cp3, dict) else None
    latest_commit = document.get("commit")

    if (
        not isinstance(cp3_commit, str)
        or not SHA_RE.fullmatch(cp3_commit)
        or not _git_commit_exists(repo_root, cp3_commit)
    ):
        return ["checkpoint_results.CP3.evaluated_commit не существует как Git commit"]
    if (
        not isinstance(latest_commit, str)
        or not SHA_RE.fullmatch(latest_commit)
        or not _git_commit_exists(repo_root, latest_commit)
    ):
        return ["eval commit не существует как Git commit"]
    if not _git_is_ancestor(repo_root, latest_commit, _git_head(repo_root)):
        errors.append("eval commit не является предком текущего HEAD")
    if not _git_is_ancestor(repo_root, cp3_commit, latest_commit):
        errors.append("CP3 evaluated_commit не является предком eval commit")
    if (
        not isinstance(cp2_commit, str)
        or not SHA_RE.fullmatch(cp2_commit)
        or not _git_commit_exists(repo_root, cp2_commit)
        or not _git_is_ancestor(repo_root, cp2_commit, cp3_commit)
    ):
        errors.append("CP2 evaluated_commit не является предком CP3 evaluated_commit")

    for label in ("ANALYZED_PRODUCT_BASE_SHA", "IMPLEMENTATION_BASE_SHA"):
        base = document.get(label)
        if (
            not isinstance(base, str)
            or not SHA_RE.fullmatch(base)
            or not _git_commit_exists(repo_root, base)
            or not _git_is_ancestor(repo_root, base, cp3_commit)
        ):
            errors.append(f"{label} не является предком CP3 evaluated_commit")

    for path in CP3_REFERENCED_FILES:
        if not _git_path_exists_at_commit(repo_root, cp3_commit, path):
            errors.append(f"CP3 evidence path отсутствует в CP3 evaluated_commit: {path}")
    for path in CP2_BRIDGE_PATHS:
        if _git_path_exists_at_commit(repo_root, cp3_commit, path):
            errors.append(f"CP2 bridge path существует в CP3 evaluated_commit: {path}")

    denylist = _git_file_at_commit(repo_root, cp3_commit, "docs/product-reset/LEGACY_DENYLIST.txt")
    if denylist is None:
        errors.append("CP3 evaluated_commit не содержит legacy denylist")
    else:
        sections: dict[str, set[str]] = {}
        current_section: set[str] | None = None
        for raw_line in denylist.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("[") and line.endswith("]"):
                current_section = sections.setdefault(line[1:-1], set())
                continue
            if current_section is None:
                errors.append("CP3 legacy denylist имеет entry вне section")
                break
            current_section.add(line)
        if sections.get("allowed_until_cp3") != set():
            errors.append("CP3 legacy denylist allowed_until_cp3 должен быть пустым")
        if not set(CP2_BRIDGE_PATHS).issubset(sections.get("forbidden_now", set())):
            errors.append("CP3 legacy denylist не запрещает все удалённые bridge paths")

    cp2_schema_errors = _cp2_schema_errors(document)
    if cp2_schema_errors:
        errors.extend(f"Историческая CP2 evidence: {error}" for error in cp2_schema_errors)
    else:
        errors.extend(_cp2_git_errors(document, repo_root))
    return errors


def _cp4_git_errors(document: Mapping[str, Any], repo_root: Path) -> list[str]:
    errors: list[str] = []
    checkpoint_results = document.get("checkpoint_results")
    cp3 = checkpoint_results.get("CP3") if isinstance(checkpoint_results, dict) else None
    cp4 = checkpoint_results.get("CP4") if isinstance(checkpoint_results, dict) else None
    cp3_commit = cp3.get("evaluated_commit") if isinstance(cp3, dict) else None
    cp4_commit = cp4.get("evaluated_commit") if isinstance(cp4, dict) else None
    latest_commit = document.get("commit")

    if (
        not isinstance(cp4_commit, str)
        or not SHA_RE.fullmatch(cp4_commit)
        or not _git_commit_exists(repo_root, cp4_commit)
    ):
        return ["checkpoint_results.CP4.evaluated_commit не существует как Git commit"]
    errors.extend(_historical_checkpoint_binding_errors(document, repo_root))
    for checkpoint, binding_commit in HISTORICAL_CHECKPOINT_BINDING_COMMITS.items():
        if _git_commit_exists(repo_root, binding_commit) and not _git_is_ancestor(
            repo_root, binding_commit, cp4_commit
        ):
            errors.append(
                f"{checkpoint} pinned binding commit не является предком CP4 evaluated_commit"
            )
    if (
        not isinstance(latest_commit, str)
        or not SHA_RE.fullmatch(latest_commit)
        or not _git_commit_exists(repo_root, latest_commit)
    ):
        return ["eval commit не существует как Git commit"]
    if not _git_is_ancestor(repo_root, latest_commit, _git_head(repo_root)):
        errors.append("eval commit не является предком текущего HEAD")
    if not _git_is_ancestor(repo_root, cp4_commit, latest_commit):
        errors.append("CP4 evaluated_commit не является предком eval commit")
    if (
        not isinstance(cp3_commit, str)
        or not SHA_RE.fullmatch(cp3_commit)
        or not _git_commit_exists(repo_root, cp3_commit)
        or not _git_is_ancestor(repo_root, cp3_commit, cp4_commit)
    ):
        errors.append("CP3 evaluated_commit не является предком CP4 evaluated_commit")

    for label in ("ANALYZED_PRODUCT_BASE_SHA", "IMPLEMENTATION_BASE_SHA"):
        base = document.get(label)
        if (
            not isinstance(base, str)
            or not SHA_RE.fullmatch(base)
            or not _git_commit_exists(repo_root, base)
            or not _git_is_ancestor(repo_root, base, cp4_commit)
        ):
            errors.append(f"{label} не является предком CP4 evaluated_commit")

    for path in CP4_REFERENCED_FILES:
        if not _git_path_exists_at_commit(repo_root, cp4_commit, path):
            errors.append(f"CP4 evidence path отсутствует в CP4 evaluated_commit: {path}")

    historical_validators = (
        ("CP1", _cp1_schema_errors, _cp1_git_errors),
        ("CP2", _cp2_schema_errors, _cp2_git_errors),
        ("CP3", _cp3_schema_errors, _cp3_git_errors),
    )
    for checkpoint, schema_validator, git_validator in historical_validators:
        schema_errors = schema_validator(document)
        if schema_errors:
            errors.extend(
                f"Историческая {checkpoint} evidence: {error}" for error in schema_errors
            )
        else:
            errors.extend(git_validator(document, repo_root))
    return errors


def _checkpoint_evidence_errors(
    document: Mapping[str, Any], checkpoint: str, repo_root: Path | None = None
) -> list[str]:
    if checkpoint == "CP1":
        errors = _cp1_schema_errors(document)
        if repo_root is not None and not errors:
            errors.extend(_cp1_git_errors(document, repo_root))
        return errors
    if checkpoint == "CP2":
        errors = _cp2_schema_errors(document)
        if repo_root is not None and not errors:
            errors.extend(_cp2_git_errors(document, repo_root))
        return errors
    if checkpoint == "CP3":
        errors = _cp3_schema_errors(document)
        if repo_root is not None and not errors:
            errors.extend(_cp3_git_errors(document, repo_root))
        return errors
    if checkpoint == "CP4":
        errors = _cp4_schema_errors(document)
        if repo_root is not None and not errors:
            errors.extend(_cp4_git_errors(document, repo_root))
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


def _command_count(
    command_id: str,
    output: str,
    exit_code: int,
    patterns: Mapping[str, re.Pattern[str] | None],
) -> int:
    if exit_code != 0 and not (
        command_id == "frontend-production-denylist" and exit_code == 1
    ):
        return 0
    pattern = patterns[command_id]
    if pattern is None:
        return 1
    matches = pattern.findall(output)
    if not matches:
        return 0
    if pattern.groups == 0:
        return len(matches)
    return int(matches[-1])


def _command_result_record(
    *,
    command_id: str,
    command: str,
    completed: subprocess.CompletedProcess[str],
    evaluated_commit: str,
    duration_ms: int,
    count_patterns: Mapping[str, re.Pattern[str] | None],
    expected_exit_code: int | None = None,
    count_rule: Literal["positive", "zero"] = "positive",
) -> dict[str, Any]:
    combined_output = f"{completed.stdout or ''}\n{completed.stderr or ''}"
    count = _command_count(command_id, combined_output, completed.returncode, count_patterns)
    effective_expected_exit_code = 0 if expected_exit_code is None else expected_exit_code
    count_is_valid = count >= 1 if count_rule == "positive" else count == 0
    passed = completed.returncode == effective_expected_exit_code and count_is_valid
    summary = (
        (
            f"ожидаемый_код_выхода={effective_expected_exit_code}; количество={count}"
            if effective_expected_exit_code != 0
            else f"успешно; количество={count}"
        )
        if passed
        else f"код_выхода={completed.returncode}; количество={count}"
    )
    record = {
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
    if expected_exit_code is not None:
        record["expected_exit_code"] = expected_exit_code
    return record


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
        result = _command_result_record(
            command_id=command_id,
            command=command,
            completed=completed,
            evaluated_commit=evaluated_commit,
            duration_ms=duration_ms,
            count_patterns=CP1_COMMAND_COUNT_PATTERNS,
        )
        results.append(result)
        print(
            f"Команда CP1 завершена: {command_id}; код={completed.returncode}; "
            f"количество={result['count']}",
            flush=True,
        )
    return results


def _run_cp2_commands(
    repo_root: Path,
    evaluated_commit: str,
    command_executor: CommandExecutor,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for command_id, command in CP2_REQUIRED_COMMANDS.items():
        command_spec: dict[str, object] = {"id": command_id, "command": command}
        print(f"Старт команды CP2: {command_id}", flush=True)
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
            raise ValueError("HEAD изменился во время выполнения команд CP2")
        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        result = _command_result_record(
            command_id=command_id,
            command=command,
            completed=completed,
            evaluated_commit=evaluated_commit,
            duration_ms=duration_ms,
            count_patterns=CP2_COMMAND_COUNT_PATTERNS,
        )
        results.append(result)
        print(
            f"Команда CP2 завершена: {command_id}; код={completed.returncode}; "
            f"количество={result['count']}",
            flush=True,
        )
    return results


def _run_cp3_commands(
    repo_root: Path,
    evaluated_commit: str,
    command_executor: CommandExecutor,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for command_id, command in CP3_REQUIRED_COMMANDS.items():
        if _git_head(repo_root) != evaluated_commit:
            raise ValueError(f"HEAD изменился до команды CP3 {command_id}")
        dirty_before = _git_dirty_paths(repo_root)
        if dirty_before:
            raise ValueError(
                f"дерево исходников загрязнено до команды CP3 {command_id}: "
                + ", ".join(sorted(dirty_before))
            )

        command_spec: dict[str, object] = {"id": command_id, "command": command}
        print(f"Старт команды CP3: {command_id}", flush=True)
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
            raise ValueError(f"HEAD изменился после команды CP3 {command_id}")
        dirty_after = _git_dirty_paths(repo_root)
        if dirty_after:
            raise ValueError(
                f"каноническая команда CP3 {command_id} изменила дерево исходников: "
                + ", ".join(sorted(dirty_after))
            )

        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        result = _command_result_record(
            command_id=command_id,
            command=command,
            completed=completed,
            evaluated_commit=evaluated_commit,
            duration_ms=duration_ms,
            count_patterns=CP3_COMMAND_COUNT_PATTERNS,
        )
        results.append(result)
        print(
            f"Команда CP3 завершена: {command_id}; код={completed.returncode}; "
            f"количество={result['count']}",
            flush=True,
        )
    return results


def _run_cp4_commands(
    repo_root: Path,
    evaluated_commit: str,
    command_executor: CommandExecutor,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for command_id, command in CP4_REQUIRED_COMMANDS.items():
        if _git_head(repo_root) != evaluated_commit:
            raise ValueError(f"HEAD изменился до команды CP4 {command_id}")
        dirty_before = _git_dirty_paths(repo_root)
        if dirty_before:
            raise ValueError(
                f"дерево исходников загрязнено до команды CP4 {command_id}: "
                + ", ".join(sorted(dirty_before))
            )

        command_spec: dict[str, object] = {"id": command_id, "command": command}
        print(f"Старт команды CP4: {command_id}", flush=True)
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
            raise ValueError(f"HEAD изменился после команды CP4 {command_id}")
        dirty_after = _git_dirty_paths(repo_root)
        if dirty_after:
            raise ValueError(
                f"каноническая команда CP4 {command_id} изменила дерево исходников: "
                + ", ".join(sorted(dirty_after))
            )

        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        result = _command_result_record(
            command_id=command_id,
            command=command,
            completed=completed,
            evaluated_commit=evaluated_commit,
            duration_ms=duration_ms,
            count_patterns=CP4_COMMAND_COUNT_PATTERNS,
            expected_exit_code=CP4_EXPECTED_EXIT_CODES[command_id],
            count_rule=CP4_COUNT_RULES[command_id],
        )
        results.append(result)
        print(
            f"Команда CP4 завершена: {command_id}; код={completed.returncode}; "
            f"количество={result['count']}",
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

        if checkpoint == "CP2":
            template_errors = _cp2_schema_errors(document, validate_command_results=False)
            if template_errors:
                raise ValueError("Шаблон evidence CP2 невалиден: " + "; ".join(template_errors))
            evidence = checkpoint_result.get("evidence")
            if not isinstance(evidence, dict):
                raise ValueError("checkpoint_results.CP2.evidence должен быть JSON-объектом")
            command_results = _run_cp2_commands(
                repo_root,
                str(document["commit"]),
                command_executor or _default_command_executor,
            )
            post_command_dirty_paths = _git_dirty_paths(repo_root)
            if post_command_dirty_paths:
                raise ValueError(
                    "канонические команды CP2 изменили дерево исходников: "
                    + ", ".join(sorted(post_command_dirty_paths))
                )
            evidence["commands"] = command_results

        if checkpoint == "CP3":
            template_errors = _cp3_schema_errors(document, validate_command_results=False)
            if template_errors:
                raise ValueError("Шаблон evidence CP3 невалиден: " + "; ".join(template_errors))
            evidence = checkpoint_result.get("evidence")
            if not isinstance(evidence, dict):
                raise ValueError("checkpoint_results.CP3.evidence должен быть JSON-объектом")
            evidence["commands"] = _run_cp3_commands(
                repo_root,
                str(document["commit"]),
                command_executor or _default_command_executor,
            )

        if checkpoint == "CP4":
            template_errors = _cp4_schema_errors(document, validate_command_results=False)
            if template_errors:
                raise ValueError("Шаблон evidence CP4 невалиден: " + "; ".join(template_errors))
            evidence = checkpoint_result.get("evidence")
            if not isinstance(evidence, dict):
                raise ValueError("checkpoint_results.CP4.evidence должен быть JSON-объектом")
            evidence["commands"] = _run_cp4_commands(
                repo_root,
                str(document["commit"]),
                command_executor or _default_command_executor,
            )

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
