from __future__ import annotations

import copy
import hashlib
import json
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
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
UX_EVAL_RELATIVE_PATH = "docs/product-reset/UX_EVAL_RU.md"
UX_ARTIFACT_ROOT = PurePosixPath("artifacts/product-reset/CP7/ux")
UX_CATEGORY_LABELS = {
    "overall_hierarchy": "Общая иерархия",
    "list_focus": "Фокус на списке",
    "next_action": "Следующее действие",
    "density": "Плотность",
    "simplicity": "Простота",
    "design_code": "Дизайн-код",
    "consistency": "Согласованность",
    "feedback": "Обратная связь",
    "typography_accessibility": "Типографика и доступность",
    "overall_quality": "Общее качество",
}
UX_REQUIRED_SCREENSHOT_MATRIX = {
    (phase, surface, viewport)
    for phase in ("before", "after")
    for surface in ("stories", "production")
    for viewport in ("1366x768", "1920x1080")
}
UX_REQUIRED_AXE_MATRIX = {
    ("axe", surface, "1366x768")
    for surface in ("stories", "production", "notifications", "dialog")
}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REDACTED_IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
EVAL_RESULT_RELATIVE_PATH = "docs/product-reset/EVAL_RESULT.json"
DEMO_EVIDENCE_RELATIVE_PATH = "docs/product-reset/DEMO_EVIDENCE.json"
DEMO_APPROVED_APP_SHA = "35cd8902258587e77a36e0885ee5b8f6db0154db"
DEMO_PERMISSION_REFERENCE = (
    "codex-thread-019f502e-78c0-7781-aad9-384296db58d9:"
    "v1.0.1-production-deploy:2026-07-30"
)
DEMO_RELEASE_TAG = "v1.0.1"
DEMO_PUBLIC_URL = "https://ncastnav.ru"
CP7_BINDING_COMMIT: str | None = "2194f5986146c3677bc7da794683bf00d164ae30"
DEPLOYMENT_BINDING_COMMIT: str | None = DEMO_APPROVED_APP_SHA
CP7_BINDING_DIFF_ALLOWED_PATHS = {EVAL_RESULT_RELATIVE_PATH}
POST_DEPLOYMENT_EVIDENCE_ALLOWED_PATHS = {
    "backend/app/services/product_reset_eval.py",
    "backend/tests/test_product_reset_eval.py",
    "backend/tests/test_ux_eval_evidence.py",
    "backend/tests/test_demo_evidence.py",
    "docs/product-reset/PROGRESS.md",
    "docs/product-reset/RISK_REGISTER_RU.md",
    DEMO_EVIDENCE_RELATIVE_PATH,
    UX_EVAL_RELATIVE_PATH,
    EVAL_RESULT_RELATIVE_PATH,
}
HISTORICAL_CHECKPOINT_BINDING_COMMITS = {
    "CP1": "57743e197f7c4c8a420673842d67e048c90d63c9",
    "CP2": "ec630cdddcd0e1cdbbde4eca696576636ff22a9a",
    "CP3": "82f5eaa793bf9d90d02997ba43a1742711d4a7fc",
    "CP4": "7643becabadf38e1d26b40bbbe417865c9c29e28",
    "CP5": "f87638588fdd606add683593f340378f5b1c3961",
    "CP6": "837e0117c01e473c93f0469df4847e858f2654b5",
}
HISTORICAL_CHECKPOINT_EVALUATED_COMMITS = {
    "CP1": "ee8efc5b04ebe3672f71f0c6c287ee634d994910",
    "CP2": "60c8f6721bcd3053c11fa2eb2316c8d8e94616fa",
    "CP3": "f867c470e917868e4b039d1d247ba61e8b79b791",
    "CP4": "5b25658f84e5b94c267ef59f3bfa2c9552fa04dd",
    "CP5": "38d01309eba9e9ffbe14fcf91ede785819f9b6fb",
    "CP6": "1d97ecc18662f5530870e24aff4126f94b2bc4cc",
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
CP5_REQUIRED_COMMANDS = {
    "backend-full-suite": "cd backend && ./.venv/bin/pytest -q",
    "frontend-full-suite": (
        "cd frontend && NODE_OPTIONS=--no-experimental-webstorage npm test -- --run"
    ),
    "frontend-production-build": "cd frontend && npm run build",
    "browser-production-chromium-1366": (
        "cd frontend && npx playwright test production-workflow.spec.ts "
        "--project=chromium-1366"
    ),
    "browser-notifications-chromium-1366": (
        "cd frontend && npx playwright test notification-routing.spec.ts "
        "--project=chromium-1366"
    ),
}
CP5_COMMAND_COUNT_PATTERNS = {
    "backend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-production-build": re.compile(r"(\d+) modules transformed"),
    "browser-production-chromium-1366": re.compile(r"(\d+) passed"),
    "browser-notifications-chromium-1366": re.compile(r"(\d+) passed"),
}
CP6_REQUIRED_COMMANDS = {
    "backend-full-suite": "cd backend && ./.venv/bin/pytest -q",
    "frontend-full-suite": (
        "cd frontend && NODE_OPTIONS=--no-experimental-webstorage npm test -- --run"
    ),
    "frontend-production-build": "cd frontend && npm run build",
    "browser-full-story-chromium-1366": (
        "cd frontend && npx playwright test full-story-flow.spec.ts "
        "--project=chromium-1366"
    ),
}
CP6_COMMAND_COUNT_PATTERNS = {
    "backend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-production-build": re.compile(r"(\d+) modules transformed"),
    "browser-full-story-chromium-1366": re.compile(r"(\d+) passed"),
}
CP7_UX_REQUIRED_COMMANDS = {
    "browser-ux-hard-gate-chromium-1366": (
        "cd frontend && npx playwright test ux-hard-gate.spec.ts "
        "--project=chromium-1366"
    ),
    "browser-ux-hard-gate-chromium-1920": (
        "cd frontend && npx playwright test ux-hard-gate.spec.ts "
        "--project=chromium-1920"
    ),
    "browser-accessibility-chromium-1366": (
        "cd frontend && npx playwright test accessibility.spec.ts "
        "--project=chromium-1366"
    ),
    "backend-ux-eval-evidence": (
        "cd backend && ./.venv/bin/pytest -q "
        "tests/test_ux_eval_evidence.py tests/test_product_reset_eval.py"
    ),
}
CP7_REQUIRED_COMMANDS = {
    "backend-full-suite": "cd backend && ./.venv/bin/pytest -q",
    "backend-compileall": (
        'backend_python="$(pwd)/backend/.venv/bin/python" && '
        'backend_root="/tmp/newscast-product-reset-cp7-backend-$(git rev-parse HEAD)" && '
        "trap 'status=$?; rm -rf \"$backend_root\"; exit \"$status\"' EXIT && "
        'rm -rf "$backend_root" && mkdir -p "$backend_root" && '
        'git archive HEAD backend | tar -x -C "$backend_root" && '
        'cd "$backend_root/backend" && '
        'PYTHONPYCACHEPREFIX="$backend_root/.pycache" '
        '"$backend_python" -m compileall app migrations'
    ),
    "backend-pip-check": "cd backend && ./.venv/bin/python -m pip check",
    "backend-dependency-license-policy": (
        "cd backend && ./.venv/bin/python scripts/check_dependency_licenses.py "
        "--repo-root .."
    ),
    "frontend-clean-npm-ci": (
        'frontend_root="/tmp/newscast-product-reset-cp7-frontend-$(git rev-parse HEAD)" && '
        'rm -rf "$frontend_root" && mkdir -p "$frontend_root" && '
        'git archive HEAD | tar -x -C "$frontend_root" && '
        'cd "$frontend_root/frontend" && npm ci'
    ),
    "frontend-full-suite": (
        'frontend_root="/tmp/newscast-product-reset-cp7-frontend-$(git rev-parse HEAD)" && '
        'cd "$frontend_root/frontend" && '
        "NODE_OPTIONS=--no-experimental-webstorage npm test -- --run"
    ),
    "frontend-production-build": (
        'frontend_root="/tmp/newscast-product-reset-cp7-frontend-$(git rev-parse HEAD)" && '
        'cd "$frontend_root/frontend" && npm run build'
    ),
    "browser-all-chromium-1366": (
        'frontend_root="/tmp/newscast-product-reset-cp7-frontend-$(git rev-parse HEAD)" && '
        'cd "$frontend_root/frontend" && '
        "npx playwright test --project=chromium-1366"
    ),
    "browser-all-chromium-1920": (
        'frontend_root="/tmp/newscast-product-reset-cp7-frontend-$(git rev-parse HEAD)" && '
        "trap 'status=$?; rm -rf \"$frontend_root\"; exit \"$status\"' EXIT && "
        'cd "$frontend_root/frontend" && '
        "npx playwright test --project=chromium-1920"
    ),
    "root-compose-config": "docker compose -f compose.yaml config",
    "clean-deploy-rehearsal": (
        "./deploy/scripts/rehearse_clean_deploy.sh "
        "--project-name nn-product-reset-eval-final "
        "--artifacts artifacts/product-reset/CP7/ops"
    ),
}
CP7_COMMAND_COUNT_PATTERNS = {
    "backend-full-suite": re.compile(r"(\d+) passed"),
    "backend-compileall": None,
    "backend-pip-check": None,
    "backend-dependency-license-policy": None,
    "frontend-clean-npm-ci": re.compile(r"added (\d+) packages"),
    "frontend-full-suite": re.compile(r"(\d+) passed"),
    "frontend-production-build": re.compile(r"(\d+) modules transformed"),
    "browser-all-chromium-1366": re.compile(r"(\d+) passed"),
    "browser-all-chromium-1920": re.compile(r"(\d+) passed"),
    "root-compose-config": None,
    "clean-deploy-rehearsal": None,
}
CP7_REQUIRED_EVIDENCE = {
    "local_full_verification": {
        "outcome": "automated_pass",
        "contracts": [
            "backend_full_suite_compileall_pip_check",
            "dependency_and_license_policy",
            "clean_frontend_install_component_suite_and_build",
            "full_browser_matrix_1366_and_1920",
            "root_compose_config",
        ],
    },
    "ux_hard_gate": {
        "outcome": "automated_pass",
        "document": UX_EVAL_RELATIVE_PATH,
        "artifact_root": str(UX_ARTIFACT_ROOT),
        "minimum_total": 90,
        "minimum_category": 8,
        "required_categories": EXPECTED_UX_CATEGORY_COUNT,
    },
    "operations_rehearsal": {
        "outcome": "automated_pass",
        "project_name": "nn-product-reset-eval-final",
        "artifact_root": "artifacts/product-reset/CP7/ops",
        "contracts": [
            "fresh_build_and_migration",
            "synthetic_seed",
            "authenticated_smoke_before_and_after_restore",
            "exact_backup_checksum",
            "empty_restore",
            "equal_key_counts",
            "clean_project_teardown",
            "redacted_exact_source",
        ],
    },
    "external_demo": {
        "outcome": "blocked_permission",
        "permission_status": "not_granted",
        "failed_gate": "external_demo",
    },
}
CP7_OPERATIONS_MANIFEST_FILES = (
    "result.json",
    "counts-before.json",
    "counts-after.json",
    "smoke-before.json",
    "smoke-after.json",
    "source-preparation.log",
    "backup/postgres.dump",
    "backup/postgres.dump.sha256",
    "docker-version.log",
    "compose-version.log",
    "build.log",
    "database-start.log",
    "migration.log",
    "seed.log",
    "application-start.log",
    "backup.log",
    "restore-database-start.log",
    "restore.log",
    "restore-application-start.log",
    "containers.log",
    "source-runtime.log",
    "restore-runtime.log",
    "cleanup.log",
)
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
CP5_REQUIRED_EVIDENCE = {
    "correction_packages": {
        "outcome": "automated_pass",
        "contracts": [
            "one_unified_package_model",
            "internal_one_part",
            "reusable_atomic_external_service_primitive",
            "assignee_or_leadership_completion",
            "leadership_return_and_close",
            "atomic_video_and_titles_completion",
            "production_prerequisites_and_open_scope_gates",
            "server_derived_whole_package_actions",
        ],
        "scopes": ["text", "video", "titles", "voiceover"],
        "internal_part_count": 1,
        "internal_cardinality_error": "INTERNAL_CORRECTION_ONE_PART_REQUIRED",
        "external_parts": "one_or_more",
        "sources": [
            "backend/app/api/routes/corrections.py",
            "backend/app/schemas/corrections.py",
            "backend/app/services/correction_service.py",
            "frontend/src/features/corrections/api.ts",
            "frontend/src/features/corrections/types.ts",
            "frontend/src/features/corrections/components/CorrectionPackageList.tsx",
            "frontend/src/features/corrections/components/CorrectionPackageDialog.tsx",
            "frontend/src/styles/corrections.css",
        ],
        "integration_sources": [
            "backend/app/main.py",
            "backend/app/services/action_policy.py",
            "backend/app/services/production_service.py",
            "frontend/src/pages/StoryProductionPage.tsx",
        ],
        "tests": [
            "backend/tests/test_corrections.py",
            "frontend/src/features/corrections/CorrectionPackageList.test.tsx",
        ],
    },
    "notification_delivery": {
        "outcome": "automated_pass",
        "contracts": [
            "internal_only",
            "recipient_isolation",
            "active_recipient_filter",
            "actor_exclusion",
            "idempotent_read_without_story_event",
            "assignment_workflow_production_and_correction_delivery",
            "autosave_creates_no_notification",
            "recipient_story_kind_session_grouping",
        ],
        "sources": [
            "backend/app/api/routes/notifications.py",
            "backend/app/schemas/notifications.py",
            "backend/app/services/notification_service.py",
        ],
        "integration_sources": [
            "backend/app/services/workflow_service.py",
            "backend/app/services/production_service.py",
            "backend/app/services/correction_service.py",
        ],
        "tests": ["backend/tests/test_notifications.py"],
    },
    "late_edit_routing": {
        "outcome": "automated_pass",
        "contracts": [
            "proofread_late_edit_only_other_active_chief_editors",
            "video_and_titles_diff_from_effective_recipient_baseline",
            "captionpanels_closes_matching_titles_notification",
            "monotonic_context_specific_read_markers",
            "immutable_effective_baseline_snapshots",
            "set_based_stale_snapshot_row_compaction",
            "preserve_current_no_session_and_latest_session_boundaries",
        ],
        "read_contexts": ["scenario", "video", "titles", "captionpanels"],
        "sources": [
            "backend/app/api/routes/captionpanels.py",
            "backend/app/services/notification_service.py",
            "backend/app/services/scenario_history.py",
            "backend/app/services/scenario_service.py",
            "backend/app/services/production_service.py",
        ],
        "tests": [
            "backend/tests/test_notifications.py",
            "backend/tests/test_captionpanels_current_scenario.py",
        ],
    },
    "personal_actions": {
        "outcome": "automated_pass",
        "contracts": [
            "server_derived_union",
            "stable_ids_and_exact_urls",
            "combined_functions_single_queue",
            "deterministic_order_and_dedupe",
            "archive_exclusion",
            "full_total_available_beyond_compact_preview",
        ],
        "sources": [
            "backend/app/api/routes/notifications.py",
            "backend/app/services/notification_service.py",
            "backend/app/services/action_policy.py",
        ],
        "tests": ["backend/tests/test_personal_actions.py"],
    },
    "frontend_attention": {
        "outcome": "automated_pass",
        "contracts": [
            "compact_three_item_preview",
            "empty_or_initial_error_has_no_footprint",
            "lazy_full_total_with_retry_and_collapse",
            "server_unread_count_badge",
            "exact_query_and_hash_deep_link",
            "same_path_navigation_without_scenario_rehydration",
            "opened_marker_refresh_preserves_local_editor_state",
        ],
        "sources": [
            "frontend/src/features/notifications/api.ts",
            "frontend/src/features/notifications/types.ts",
            "frontend/src/features/notifications/components/AttentionQueue.tsx",
            "frontend/src/features/notifications/components/NotificationTray.tsx",
            "frontend/src/pages/StoriesPage.tsx",
            "frontend/src/components/app-shell/AppShell.tsx",
            "frontend/src/app/AppRouter.tsx",
            "frontend/src/styles/notifications.css",
        ],
        "tests": ["frontend/src/features/notifications/AttentionQueue.test.tsx"],
        "browser_specs": ["frontend/e2e/notification-routing.spec.ts"],
    },
    "deterministic_tests": {
        "outcome": "automated_pass",
        "backend_tests": [
            "backend/tests/test_product_reset_eval.py",
            "backend/tests/test_repository_policy.py",
            "backend/tests/test_corrections.py",
            "backend/tests/test_notifications.py",
            "backend/tests/test_personal_actions.py",
        ],
        "component_tests": [
            "frontend/src/features/corrections/CorrectionPackageList.test.tsx",
            "frontend/src/features/notifications/AttentionQueue.test.tsx",
        ],
        "browser_specs": [
            "frontend/e2e/production-workflow.spec.ts",
            "frontend/e2e/notification-routing.spec.ts",
        ],
        "browser_projects": ["chromium-1366"],
    },
}
CP5_REFERENCED_FILES = tuple(
    dict.fromkeys(
        path
        for section in CP5_REQUIRED_EVIDENCE.values()
        for field in (
            "sources",
            "integration_sources",
            "tests",
            "backend_tests",
            "component_tests",
            "browser_specs",
        )
        for path in section.get(field, [])
    )
)
CP6_REQUIRED_EVIDENCE = {
    "external_approval_cycles": {
        "outcome": "automated_pass",
        "contracts": [
            "leadership_only_mutations",
            "active_users_read_cycles",
            "single_pending_cycle",
            "open_correction_blocks_send",
            "approved_rejects_parts",
            "changes_requested_requires_nonempty_parts",
            "atomic_external_multi_part_package",
            "repeat_cycle_after_closed_package",
            "archived_story_rejects_mutation",
            "server_derived_actions",
        ],
        "results": ["approved", "changes_requested"],
        "sources": [
            "backend/app/api/routes/external_approval.py",
            "backend/app/schemas/external_approval.py",
            "backend/app/services/external_approval_service.py",
            "backend/app/services/correction_service.py",
            "backend/app/services/notification_service.py",
            "backend/app/services/action_policy.py",
            "frontend/src/features/external-approval/api.ts",
            "frontend/src/features/external-approval/types.ts",
            "frontend/src/features/external-approval/components/ExternalApprovalCycles.tsx",
            "frontend/src/features/external-approval/components/ExternalResultDialog.tsx",
            "frontend/src/pages/StoryProductionPage.tsx",
            "frontend/src/styles/external-approval.css",
        ],
        "tests": [
            "backend/tests/test_external_approval.py",
            "frontend/src/features/external-approval/ExternalApprovalCycles.test.tsx",
        ],
    },
    "story_creation_and_lifecycle": {
        "outcome": "automated_pass",
        "contracts": [
            "server_scoped_create_options",
            "atomic_story_scenario_workflow_production_event",
            "leadership_mark_aired",
            "latest_completed_external_approval_required",
            "aired_status_keeps_edits_enabled",
            "archive_requires_aired",
            "archive_excludes_active_lists_and_is_read_only",
            "archive_finalizes_active_lease",
            "leadership_restore_preserves_current_history",
            "server_derived_lifecycle_situations_and_actions",
            "no_cancel_or_archive_reason",
        ],
        "situations": ["active", "external_pending", "ready_for_air", "aired", "archive"],
        "lifecycle_actions": [
            "story_create",
            "story_mark_aired",
            "story_archive",
            "story_restore",
        ],
        "sources": [
            "backend/app/api/routes/stories.py",
            "backend/app/api/routes/production.py",
            "backend/app/schemas/stories.py",
            "backend/app/services/story_service.py",
            "backend/app/services/story_queries.py",
            "backend/app/services/production_service.py",
            "backend/app/services/action_policy.py",
            "backend/app/services/permissions.py",
            "frontend/src/features/stories/api.ts",
            "frontend/src/features/stories/types.ts",
            "frontend/src/features/stories/components/CreateStoryDialog.tsx",
            "frontend/src/features/stories/components/StoriesTable.tsx",
            "frontend/src/pages/StoriesPage.tsx",
            "frontend/src/pages/ArchivePage.tsx",
            "frontend/src/styles/stories.css",
        ],
        "tests": [
            "backend/tests/test_archive.py",
            "frontend/src/features/stories/StoryLifecycle.test.tsx",
        ],
    },
    "aggregate_consistency": {
        "outcome": "automated_pass",
        "contracts": [
            "story_scenario_workflow_production_dependents_session_lock_order",
            "fail_closed_lock_order_guards",
            "refreshed_current_scenario_snapshot",
            "captionpanels_and_history_follow_aggregate_order",
        ],
        "lock_order": [
            "story",
            "scenario",
            "workflow",
            "production",
            "cycles_and_packages",
            "session",
        ],
        "sources": [
            "backend/app/services/story_service.py",
            "backend/app/services/scenario_service.py",
            "backend/app/services/workflow_service.py",
            "backend/app/services/production_service.py",
            "backend/app/services/external_approval_service.py",
            "backend/app/services/correction_service.py",
            "backend/app/services/scenario_history.py",
            "backend/app/services/captionpanels_export.py",
        ],
        "tests": [
            "backend/tests/sql_lock_order.py",
            "backend/tests/test_archive.py",
            "backend/tests/test_captionpanels_current_scenario.py",
            "backend/tests/test_story_history_api.py",
        ],
    },
    "full_product_flow": {
        "outcome": "automated_pass",
        "contracts": [
            "public_create_save_external_approved_air_archive_restore",
            "aired_edit_remains_available",
            "archive_read_only_then_restore_same_current_scenario",
            "rendered_chromium_1366_without_console_or_layout_errors",
        ],
        "backend_tests": ["backend/tests/test_product_flow.py"],
        "browser_specs": ["frontend/e2e/full-story-flow.spec.ts"],
        "browser_projects": ["chromium-1366"],
    },
    "deterministic_tests": {
        "outcome": "automated_pass",
        "backend_tests": [
            "backend/tests/test_product_reset_eval.py",
            "backend/tests/test_repository_policy.py",
            "backend/tests/test_external_approval.py",
            "backend/tests/test_archive.py",
            "backend/tests/test_product_flow.py",
        ],
        "component_tests": [
            "frontend/src/features/external-approval/ExternalApprovalCycles.test.tsx",
            "frontend/src/features/stories/StoryLifecycle.test.tsx",
        ],
        "browser_specs": ["frontend/e2e/full-story-flow.spec.ts"],
        "browser_projects": ["chromium-1366"],
    },
}
CP6_REFERENCED_FILES = tuple(
    dict.fromkeys(
        path
        for section in CP6_REQUIRED_EVIDENCE.values()
        for field in (
            "sources",
            "tests",
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


def _valid_utc_timestamp(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    return parsed.strftime("%Y-%m-%dT%H:%M:%SZ") == value


def _demo_evidence_schema_errors(repo_root: Path) -> tuple[dict[str, Any] | None, list[str]]:
    try:
        evidence = _load_json_object(
            repo_root / DEMO_EVIDENCE_RELATIVE_PATH,
            label="external demo evidence",
        )
    except ValueError as exc:
        return None, [str(exc)]

    errors: list[str] = []
    if set(evidence) != {"schema_version", "external_demo", "checks"}:
        errors.append("external demo evidence должен содержать точный верхнеуровневый contract")
    if type(evidence.get("schema_version")) is not int or evidence["schema_version"] != 2:
        errors.append("external demo evidence schema_version должен иметь значение 2")

    external_demo = evidence.get("external_demo")
    if not isinstance(external_demo, dict) or set(external_demo) != {
        "permission_status",
        "permission_reference",
        "status",
        "app_sha",
        "deployed_app_sha",
        "release_tag",
        "verified_at",
        "public_url",
    }:
        errors.append("external demo evidence external_demo должен содержать точный contract")
    else:
        if (
            external_demo.get("permission_status") != "granted"
            or external_demo.get("permission_reference") != DEMO_PERMISSION_REFERENCE
            or external_demo.get("status") not in {"pending", "passed"}
            or external_demo.get("app_sha") != DEMO_APPROVED_APP_SHA
            or external_demo.get("deployed_app_sha") not in {None, DEMO_APPROVED_APP_SHA}
        ):
            errors.append("external demo evidence permission/SHA binding невалиден")
        if external_demo.get("release_tag") != DEMO_RELEASE_TAG:
            errors.append("external demo evidence release_tag невалиден")
        verified_at = external_demo.get("verified_at")
        if verified_at is not None and not _valid_utc_timestamp(verified_at):
            errors.append("external demo evidence verified_at должен быть UTC timestamp")
        if external_demo.get("public_url") != DEMO_PUBLIC_URL:
            errors.append("external demo evidence public_url невалиден")

    checks = evidence.get("checks")
    expected_check_keys = {
        "redacted_dataset_validation",
        "backup",
        "public_health",
        "unauthenticated_request",
        "default_credentials",
        "authenticated_story_read",
        "desktop_viewports",
        "captionpanels_latest_scenario",
        "cache_policy",
        "admin_user_management",
        "runtime_continuity",
        "untracked_artifacts",
    }
    if not isinstance(checks, dict) or set(checks) != expected_check_keys:
        errors.append("external demo evidence checks должен содержать точный contract")
        return evidence, errors

    expected_pending_checks = {
        "redacted_dataset_validation": {
            "status": "pending",
            "dataset_id": None,
            "report_sha256": None,
        },
        "backup": {
            "status": "pending",
            "artifact_sha256": None,
            "restore_list_valid": None,
        },
        "public_health": {"status": "pending", "expected_status": 200},
        "unauthenticated_request": {"status": "pending", "expected_status": 401},
        "default_credentials": {"status": "pending", "rejected": None},
        "authenticated_story_read": {"status": "pending", "story_id": None},
        "desktop_viewports": {"1366x768": "pending", "1920x1080": "pending"},
        "captionpanels_latest_scenario": {"status": "pending", "scenario_id": None},
        "cache_policy": {
            "status": "pending",
            "html_revalidated": None,
            "hashed_asset_immutable": None,
            "missing_asset_status": 404,
            "missing_asset_no_store": None,
        },
        "admin_user_management": {
            "status": "pending",
            "existing_admin_authenticated": None,
            "admin_password_hash_preserved": None,
            "rename_login": None,
            "delete_unused": None,
            "delete_self_rejected": None,
            "temporary_users_removed": None,
        },
        "runtime_continuity": {
            "status": "pending",
            "database_container_preserved": None,
            "gateway_container_preserved": None,
            "rollback_ready": None,
        },
        "untracked_artifacts": {
            "status": "pending",
            "artifact_count": None,
            "dataset_sha256": None,
            "screenshots": {"1366x768": None, "1920x1080": None},
        },
    }
    for check_id, pending_contract in expected_pending_checks.items():
        value = checks.get(check_id)
        if check_id == "untracked_artifacts":
            if (
                not isinstance(value, dict)
                or set(value) != set(pending_contract)
                or value.get("status") not in {"pending", "passed"}
                or not isinstance(value.get("screenshots"), dict)
                or value.get("screenshots").keys() != pending_contract["screenshots"].keys()
            ):
                errors.append("external demo evidence untracked artifacts contract невалиден")
            continue
        if check_id == "desktop_viewports":
            if (
                not isinstance(value, dict)
                or set(value) != set(pending_contract)
                or not all(status in {"pending", "passed"} for status in value.values())
            ):
                errors.append("external demo evidence desktop viewport contract невалиден")
            continue
        if not isinstance(value, dict) or set(value) != set(pending_contract):
            errors.append(f"external demo evidence check {check_id} невалиден")
            continue
        if value.get("status") not in {"pending", "passed"}:
            errors.append(f"external demo evidence check {check_id} имеет невалидный status")

    if errors:
        return evidence, errors

    dataset_validation = checks["redacted_dataset_validation"]
    if (
        dataset_validation["dataset_id"] is not None
        and (
            not isinstance(dataset_validation["dataset_id"], str)
            or not REDACTED_IDENTIFIER_RE.fullmatch(dataset_validation["dataset_id"])
        )
    ):
        errors.append("dataset_id должен быть redacted identifier")
    for check_id, field in (
        ("redacted_dataset_validation", "report_sha256"),
        ("backup", "artifact_sha256"),
    ):
        value = checks[check_id][field]
        if value is not None and (
            not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)
        ):
            errors.append(f"external demo evidence {check_id}.{field} должен быть SHA256")
    for check_id, field in (
        ("authenticated_story_read", "story_id"),
        ("captionpanels_latest_scenario", "scenario_id"),
    ):
        value = checks[check_id][field]
        if value is not None and (
            not isinstance(value, str) or not REDACTED_IDENTIFIER_RE.fullmatch(value)
        ):
            errors.append(f"external demo evidence {check_id}.{field} должен быть redacted identifier")
    unauthenticated_status = checks["unauthenticated_request"]["expected_status"]
    if type(unauthenticated_status) is not int or unauthenticated_status != 401:
        errors.append("external demo evidence unauthenticated_request должен ожидать 401")
    public_health_status = checks["public_health"]["expected_status"]
    if type(public_health_status) is not int or public_health_status != 200:
        errors.append("external demo evidence public_health должен ожидать 200")
    if checks["default_credentials"]["rejected"] is not None and checks[
        "default_credentials"
    ]["rejected"] is not True:
        errors.append("external demo evidence default_credentials.rejected невалиден")
    if (
        checks["backup"]["restore_list_valid"] is not None
        and checks["backup"]["restore_list_valid"] is not True
    ):
        errors.append("external demo evidence backup.restore_list_valid невалиден")
    missing_asset_status = checks["cache_policy"]["missing_asset_status"]
    if type(missing_asset_status) is not int or missing_asset_status != 404:
        errors.append("external demo evidence cache_policy missing asset должен ожидать 404")
    for check_id, fields in (
        (
            "cache_policy",
            (
                "html_revalidated",
                "hashed_asset_immutable",
                "missing_asset_no_store",
            ),
        ),
        (
            "admin_user_management",
            (
                "existing_admin_authenticated",
                "admin_password_hash_preserved",
                "rename_login",
                "delete_unused",
                "delete_self_rejected",
                "temporary_users_removed",
            ),
        ),
        (
            "runtime_continuity",
            (
                "database_container_preserved",
                "gateway_container_preserved",
                "rollback_ready",
            ),
        ),
    ):
        for field in fields:
            if checks[check_id][field] is not None and checks[check_id][field] is not True:
                errors.append(
                    f"external demo evidence {check_id}.{field} невалиден"
                )

    untracked_artifacts = checks["untracked_artifacts"]
    artifact_count = untracked_artifacts["artifact_count"]
    if artifact_count is not None and (
        type(artifact_count) is not int or artifact_count != 3
    ):
        errors.append("external demo evidence untracked_artifacts.artifact_count невалиден")
    for field, value in (
        ("dataset_sha256", untracked_artifacts["dataset_sha256"]),
        *(
            (f"screenshots.{viewport}", screenshot_hash)
            for viewport, screenshot_hash in untracked_artifacts["screenshots"].items()
        ),
    ):
        if value is not None and (
            not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)
        ):
            errors.append(f"external demo evidence untracked_artifacts.{field} должен быть SHA256")

    if isinstance(external_demo, dict) and external_demo.get("status") == "passed":
        if external_demo.get("deployed_app_sha") != DEMO_APPROVED_APP_SHA:
            errors.append("external demo evidence не подтверждает exact deployed SHA")
        if not _valid_utc_timestamp(external_demo.get("verified_at")):
            errors.append("external demo evidence passed verified_at должен быть UTC timestamp")
        for check_id in (
            "redacted_dataset_validation",
            "backup",
            "public_health",
            "unauthenticated_request",
            "default_credentials",
            "authenticated_story_read",
            "captionpanels_latest_scenario",
            "cache_policy",
            "admin_user_management",
            "runtime_continuity",
        ):
            if checks[check_id]["status"] != "passed":
                errors.append(f"external demo evidence {check_id} должен иметь status passed")
        if checks["desktop_viewports"] != {
            "1366x768": "passed",
            "1920x1080": "passed",
        }:
            errors.append("external demo evidence desktop_viewports должен подтвердить оба viewport")
        if not isinstance(dataset_validation["dataset_id"], str) or not REDACTED_IDENTIFIER_RE.fullmatch(
            dataset_validation["dataset_id"]
        ):
            errors.append("external demo evidence passed dataset_id должен быть redacted identifier")
        if not isinstance(dataset_validation["report_sha256"], str) or not re.fullmatch(
            r"[0-9a-f]{64}", dataset_validation["report_sha256"]
        ):
            errors.append("external demo evidence passed report_sha256 должен быть SHA256")
        backup = checks["backup"]
        if not isinstance(backup["artifact_sha256"], str) or not re.fullmatch(
            r"[0-9a-f]{64}", backup["artifact_sha256"]
        ):
            errors.append("external demo evidence passed artifact_sha256 должен быть SHA256")
        if backup["restore_list_valid"] is not True:
            errors.append(
                "external demo evidence passed backup.restore_list_valid должен быть true"
            )
        if checks["default_credentials"]["rejected"] is not True:
            errors.append("external demo evidence passed default_credentials.rejected должен быть true")
        for check_id, fields in (
            (
                "cache_policy",
                (
                    "html_revalidated",
                    "hashed_asset_immutable",
                    "missing_asset_no_store",
                ),
            ),
            (
                "admin_user_management",
                (
                    "existing_admin_authenticated",
                    "admin_password_hash_preserved",
                    "rename_login",
                    "delete_unused",
                    "delete_self_rejected",
                    "temporary_users_removed",
                ),
            ),
            (
                "runtime_continuity",
                (
                    "database_container_preserved",
                    "gateway_container_preserved",
                    "rollback_ready",
                ),
            ),
        ):
            if any(checks[check_id][field] is not True for field in fields):
                errors.append(
                    f"external demo evidence passed {check_id} должен подтвердить все boolean gates"
                )
        for check_id, field in (
            ("authenticated_story_read", "story_id"),
            ("captionpanels_latest_scenario", "scenario_id"),
        ):
            value = checks[check_id][field]
            if not isinstance(value, str) or not REDACTED_IDENTIFIER_RE.fullmatch(value):
                errors.append(
                    f"external demo evidence passed {check_id}.{field} должен быть redacted identifier"
                )
        if untracked_artifacts["status"] != "passed":
            errors.append("external demo evidence passed untracked_artifacts должен иметь status passed")
        if (
            type(untracked_artifacts["artifact_count"]) is not int
            or untracked_artifacts["artifact_count"] != 3
        ):
            errors.append(
                "external demo evidence passed untracked_artifacts.artifact_count должен быть 3"
            )
        for field, value in (
            ("dataset_sha256", untracked_artifacts["dataset_sha256"]),
            *(
                (f"screenshots.{viewport}", screenshot_hash)
                for viewport, screenshot_hash in untracked_artifacts["screenshots"].items()
            ),
        ):
            if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
                errors.append(
                    f"external demo evidence passed untracked_artifacts.{field} должен быть SHA256"
                )
    return evidence, errors


def _git_bytes_run(
    repo_root: Path,
    *args: str,
    input_bytes: bytes | None = None,
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", *args],
        cwd=repo_root,
        input=input_bytes,
        check=False,
        capture_output=True,
    )


def _regular_blob_ids_from_records(records: bytes, *, source: str) -> set[str] | None:
    blob_ids: set[str] = set()
    for record in filter(None, records.split(b"\0")):
        metadata, separator, _path = record.partition(b"\t")
        fields = metadata.split()
        if not separator:
            return None
        if source == "index":
            if len(fields) != 3:
                return None
            mode, blob_id, stage = fields
            if stage != b"0":
                continue
        else:
            if len(fields) != 3:
                return None
            mode, object_type, blob_id = fields
            if object_type != b"blob":
                continue
        if mode not in {b"100644", b"100755"} or not re.fullmatch(
            rb"[0-9a-f]{40,64}", blob_id
        ):
            continue
        blob_ids.add(blob_id.decode("ascii"))
    return blob_ids


def _tracked_regular_file_hashes(repo_root: Path) -> tuple[set[str] | None, str | None]:
    index = _git_bytes_run(repo_root, "ls-files", "-s", "-z")
    if index.returncode != 0:
        return None, "external demo evidence не может проверить Git-tracked artifacts"
    blob_ids = _regular_blob_ids_from_records(index.stdout, source="index")
    if blob_ids is None:
        return None, "external demo evidence не может разобрать Git index"

    head = _git_run(repo_root, "rev-parse", "--verify", "-q", "HEAD")
    if head.returncode == 0:
        tree = _git_bytes_run(repo_root, "ls-tree", "-r", "-z", "HEAD")
        if tree.returncode != 0:
            return None, "external demo evidence не может проверить Git HEAD tree"
        head_blob_ids = _regular_blob_ids_from_records(tree.stdout, source="head")
        if head_blob_ids is None:
            return None, "external demo evidence не может разобрать Git HEAD tree"
        blob_ids.update(head_blob_ids)

    if not blob_ids:
        return set(), None
    batch = _git_bytes_run(
        repo_root,
        "cat-file",
        "--batch",
        input_bytes="".join(f"{blob_id}\n" for blob_id in sorted(blob_ids)).encode("ascii"),
    )
    if batch.returncode != 0:
        return None, "external demo evidence не может прочитать Git blobs"

    hashes: set[str] = set()
    output = batch.stdout
    offset = 0
    while offset < len(output):
        header_end = output.find(b"\n", offset)
        if header_end < 0:
            return None, "external demo evidence не может разобрать Git blob batch"
        header = output[offset:header_end].split()
        if len(header) != 3 or header[1] != b"blob":
            return None, "external demo evidence не может разобрать Git blob batch"
        try:
            size = int(header[2])
        except ValueError:
            return None, "external demo evidence не может разобрать Git blob batch"
        payload_start = header_end + 1
        payload_end = payload_start + size
        if payload_end >= len(output) or output[payload_end : payload_end + 1] != b"\n":
            return None, "external demo evidence не может разобрать Git blob batch"
        hashes.add(hashlib.sha256(output[payload_start:payload_end]).hexdigest())
        offset = payload_end + 1
    return hashes, None


def _external_demo_final_errors(
    document: Mapping[str, Any], repo_root: Path
) -> list[str]:
    evidence, errors = _demo_evidence_schema_errors(repo_root)
    if errors or evidence is None:
        return errors

    external_demo = evidence["external_demo"]
    expected_eval_external_demo = {
        "permission_status": external_demo["permission_status"],
        "status": external_demo["status"],
        "app_sha": external_demo["app_sha"],
    }
    if document.get("external_demo") != expected_eval_external_demo:
        return ["EVAL_RESULT external_demo не совпадает с DEMO_EVIDENCE"]
    if external_demo["status"] != "passed":
        return ["external demo evidence ожидает внешние проверки"]
    if external_demo["deployed_app_sha"] != DEMO_APPROVED_APP_SHA:
        return ["external demo evidence не подтверждает exact deployed SHA"]
    if not _git_commit_exists(repo_root, DEMO_APPROVED_APP_SHA):
        return [f"deployed SHA {DEMO_APPROVED_APP_SHA} недоступен в Git истории"]
    release_tag_target = _git_tag_target(repo_root, DEMO_RELEASE_TAG)
    if release_tag_target != DEMO_APPROVED_APP_SHA:
        return [
            f"release tag {DEMO_RELEASE_TAG} не указывает на exact deployed SHA"
        ]

    checks = evidence["checks"]
    incomplete_checks = [
        check_id
        for check_id, value in checks.items()
        if check_id != "desktop_viewports"
        and (
            not isinstance(value, dict)
            or value.get("status") != "passed"
        )
    ]
    if checks["desktop_viewports"] != {
        "1366x768": "passed",
        "1920x1080": "passed",
    }:
        incomplete_checks.append("desktop_viewports")
    if incomplete_checks:
        return [
            "external demo evidence не подтверждает все external gates: "
            + ", ".join(incomplete_checks)
        ]

    untracked_artifacts = checks["untracked_artifacts"]
    declared_hashes = {
        untracked_artifacts["dataset_sha256"],
        *untracked_artifacts["screenshots"].values(),
    }
    tracked_hashes, tracked_hashes_error = _tracked_regular_file_hashes(repo_root)
    if tracked_hashes_error is not None:
        return [tracked_hashes_error]
    if tracked_hashes is not None and declared_hashes & tracked_hashes:
        return ["untracked artifact hash совпадает с Git-tracked file"]
    return []


def _nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _ux_artifact_path_errors(path_value: object) -> list[str]:
    if not isinstance(path_value, str) or not path_value:
        return ["UX artifact path должен быть непустой строкой"]
    path = PurePosixPath(path_value)
    if path.is_absolute():
        return ["UX artifact path должен быть относительным"]
    if ".." in path.parts or path.parts[: len(UX_ARTIFACT_ROOT.parts)] != UX_ARTIFACT_ROOT.parts:
        return ["UX artifact path должен находиться внутри artifacts/product-reset/CP7/ux"]
    return []


def validate_ux_eval_document(
    document: Mapping[str, Any],
    *,
    repo_root: Path | None = None,
    require_artifacts: bool = False,
) -> list[str]:
    errors: list[str] = []
    expected_top_keys = {
        "schema_version",
        "ux_total",
        "categories",
        "artifacts",
        "defects",
        "visual_iteration",
        "comparison",
    }
    if set(document) != expected_top_keys:
        errors.append("UX evidence должен содержать точный верхнеуровневый contract")
    if type(document.get("schema_version")) is not int or document.get("schema_version") != 1:
        errors.append("UX evidence schema_version должен иметь значение 1")

    categories = document.get("categories")
    exact_category_ids = list(UX_CATEGORY_LABELS)
    categories_are_exact = (
        isinstance(categories, dict) and list(categories) == exact_category_ids
    )
    if not categories_are_exact:
        errors.append("UX evidence должен содержать точные 10 категорий rubric в утверждённом порядке")
        categories = categories if isinstance(categories, dict) else {}

    artifacts = document.get("artifacts")
    artifact_items = artifacts if isinstance(artifacts, list) else []
    if not isinstance(artifacts, list) or not all(isinstance(item, dict) for item in artifacts):
        errors.append("UX artifacts должен быть списком объектов")
        artifact_items = []

    artifact_ids: list[str] = []
    artifacts_by_id: dict[str, Mapping[str, Any]] = {}
    screenshot_matrix: set[tuple[object, object, object]] = set()
    axe_matrix: set[tuple[object, object, object]] = set()
    artifact_record_keys = {
        "id",
        "kind",
        "phase",
        "viewport",
        "surface",
        "path",
        "sha256",
    }
    artifact_root_is_valid = False
    if require_artifacts and repo_root is not None:
        try:
            _require_contained_directory(
                repo_root,
                repo_root / str(UX_ARTIFACT_ROOT),
                trusted_base=repo_root,
                label="UX artifact root",
            )
        except ValueError as exc:
            errors.append(str(exc))
        else:
            artifact_root_is_valid = True
    for item in artifact_items:
        artifact_id = item.get("id")
        if set(item) != artifact_record_keys:
            errors.append(f"UX artifact {artifact_id}: запись должна иметь точные поля")
        if not _nonempty_string(artifact_id):
            errors.append("UX artifact id должен быть непустой строкой")
            continue
        artifact_ids.append(str(artifact_id))
        artifacts_by_id[str(artifact_id)] = item
        errors.extend(
            f"UX artifact {artifact_id}: {error}"
            for error in _ux_artifact_path_errors(item.get("path"))
        )
        digest = item.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            errors.append(f"UX artifact {artifact_id}: SHA256 должен содержать 64 hex символа")

        kind = item.get("kind")
        phase = item.get("phase")
        viewport = item.get("viewport")
        surface = item.get("surface")
        path_value = item.get("path")
        if kind == "screenshot":
            screenshot_matrix.add((phase, surface, viewport))
            if phase not in {"before", "after"}:
                errors.append(f"UX artifact {artifact_id}: screenshot phase невалиден")
            if isinstance(path_value, str) and not path_value.endswith(".png"):
                errors.append(f"UX artifact {artifact_id}: screenshot должен иметь расширение .png")
        elif kind == "axe_json":
            axe_matrix.add((phase, surface, viewport))
            if phase != "axe":
                errors.append(f"UX artifact {artifact_id}: axe phase должен иметь значение axe")
            if isinstance(path_value, str) and not path_value.endswith(".json"):
                errors.append(f"UX artifact {artifact_id}: axe artifact должен иметь расширение .json")
        else:
            errors.append(f"UX artifact {artifact_id}: kind должен быть screenshot или axe_json")

        if require_artifacts and repo_root is not None and isinstance(path_value, str):
            path_errors = _ux_artifact_path_errors(path_value)
            if not path_errors and not artifact_root_is_valid:
                errors.append(f"UX artifact отсутствует: {path_value}")
            elif not path_errors:
                artifact_path = repo_root / path_value
                try:
                    _require_regular_contained_file(
                        repo_root / str(UX_ARTIFACT_ROOT),
                        artifact_path,
                        trusted_base=repo_root,
                        label="UX artifact",
                    )
                except ValueError as exc:
                    errors.append(str(exc))
                else:
                    if isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest):
                        actual_digest = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
                        if actual_digest != digest:
                            errors.append(f"UX artifact SHA256 не совпадает: {path_value}")

    if len(artifact_ids) != len(set(artifact_ids)):
        errors.append("UX artifact IDs должны быть уникальными")
    if screenshot_matrix != UX_REQUIRED_SCREENSHOT_MATRIX:
        errors.append("UX evidence должен содержать полный before/after screenshot matrix")
    if axe_matrix != UX_REQUIRED_AXE_MATRIX:
        errors.append("UX evidence должен содержать полный axe surface matrix")
    if require_artifacts and repo_root is None:
        errors.append("UX boundary artifact check требует repo_root")
    if require_artifacts and repo_root is not None and artifact_root_is_valid:
        artifact_root = repo_root / str(UX_ARTIFACT_ROOT)
        expected_files = {
            PurePosixPath(str(item["path"])).relative_to(UX_ARTIFACT_ROOT).as_posix()
            for item in artifact_items
            if isinstance(item.get("path"), str)
            and not _ux_artifact_path_errors(item.get("path"))
        }
        actual_files = {
            item.relative_to(artifact_root).as_posix()
            for item in artifact_root.rglob("*")
            if (item.is_file() or item.is_symlink())
            and not item.name.startswith("._")
        }
        if actual_files != expected_files:
            errors.append("UX artifact root нарушает exact regular-file set")
        actual_directories = {
            item.relative_to(artifact_root).as_posix()
            for item in artifact_root.rglob("*")
            if item.is_dir() and not item.is_symlink()
        }
        if actual_directories != {"before", "after", "axe"}:
            errors.append("UX artifact root содержит неожиданные каталоги")

    scores: list[int] = []
    for category_id, label in UX_CATEGORY_LABELS.items():
        category = categories.get(category_id)
        if not isinstance(category, dict):
            continue
        if set(category) != {"label", "score", "rationale", "screens"}:
            errors.append(f"UX category {category_id}: запись должна иметь точные поля")
        if category.get("label") != label:
            errors.append(f"UX category {category_id}: label не совпадает с rubric")
        score = category.get("score")
        if type(score) is not int:
            errors.append(f"UX category {category_id}: score должен быть целым числом")
        else:
            scores.append(score)
            if not 0 <= score <= 10:
                errors.append(f"UX category {category_id}: score должен быть от 0 до 10")
            if score < 8:
                errors.append(f"UX category {category_id}: score должен быть не ниже 8")
        if not _nonempty_string(category.get("rationale")):
            errors.append(f"UX category {category_id}: требуется письменное обоснование")
        screens = category.get("screens")
        if not isinstance(screens, list) or not screens or not all(
            isinstance(screen, str) for screen in screens
        ):
            errors.append(f"UX category {category_id}: требуется минимум один after screenshot")
            continue
        for screen in screens:
            artifact = artifacts_by_id.get(screen)
            if artifact is None:
                errors.append(f"UX category {category_id}: неизвестный artifact {screen}")
            elif artifact.get("kind") != "screenshot" or artifact.get("phase") != "after":
                errors.append(f"UX category {category_id}: {screen} должен быть after screenshot")

    declared_total = document.get("ux_total")
    if type(declared_total) is not int:
        errors.append("UX ux_total должен быть целым числом")
    elif len(scores) == EXPECTED_UX_CATEGORY_COUNT:
        if declared_total != sum(scores):
            errors.append("UX ux_total должен быть равен сумме категорий")
        if declared_total < 90:
            errors.append("UX ux_total должен быть не ниже 90")

    defects = document.get("defects")
    if not isinstance(defects, list) or not defects or not all(
        isinstance(item, dict) for item in defects
    ):
        errors.append("UX evidence должен содержать непустой список недостатков")
    else:
        for item in defects:
            expected_defect_keys = {
                "id",
                "status",
                "description",
                "before_artifact",
                "after_artifact",
            }
            if set(item) != expected_defect_keys or not all(
                _nonempty_string(item.get(key))
                for key in ("id", "status", "description", "before_artifact", "after_artifact")
            ):
                errors.append("UX defect должен содержать точные непустые поля")
                continue
            before = artifacts_by_id.get(str(item["before_artifact"]))
            after = artifacts_by_id.get(str(item["after_artifact"]))
            if before is None or before.get("phase") != "before":
                errors.append(f"UX defect {item['id']}: before_artifact невалиден")
            if after is None or after.get("phase") != "after":
                errors.append(f"UX defect {item['id']}: after_artifact невалиден")

    iteration = document.get("visual_iteration")
    if not isinstance(iteration, dict) or set(iteration) != {
        "before_summary",
        "changes",
        "after_summary",
    } or not _nonempty_string(iteration.get("before_summary")) or not _nonempty_string(
        iteration.get("after_summary")
    ) or not isinstance(iteration.get("changes"), list) or not iteration.get("changes") or not all(
        _nonempty_string(item) for item in iteration.get("changes", [])
    ):
        errors.append("UX visual_iteration должен описывать before, changes и after")

    comparison = document.get("comparison")
    if not isinstance(comparison, dict) or set(comparison) != {
        "summary",
        "before_artifacts",
        "after_artifacts",
    } or not _nonempty_string(comparison.get("summary")):
        errors.append("UX comparison должен содержать итоговое сравнение до/после")
    else:
        for field, phase in (
            ("before_artifacts", "before"),
            ("after_artifacts", "after"),
        ):
            references = comparison.get(field)
            if not isinstance(references, list) or not references:
                errors.append(f"UX comparison {field} должен быть непустым списком")
                continue
            for reference in references:
                artifact = artifacts_by_id.get(reference) if isinstance(reference, str) else None
                if (
                    artifact is None
                    or artifact.get("kind") != "screenshot"
                    or artifact.get("phase") != phase
                ):
                    errors.append(f"UX comparison {field} содержит невалидный artifact")
    return errors


def load_ux_eval_evidence(
    repo_root: Path,
    *,
    require_artifacts: bool,
) -> dict[str, Any]:
    path = repo_root / UX_EVAL_RELATIVE_PATH
    try:
        _require_regular_contained_file(
            repo_root,
            path,
            trusted_base=repo_root,
            label="UX evidence document",
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    try:
        markdown = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ValueError(f"UX evidence не найдена: {path}") from exc
    begin = "<!-- UX_EVAL_MACHINE_READABLE_BEGIN -->"
    end = "<!-- UX_EVAL_MACHINE_READABLE_END -->"
    if markdown.count(begin) != 1 or markdown.count(end) != 1:
        raise ValueError("UX evidence должна содержать один machine-readable block")
    block = markdown.split(begin, 1)[1].split(end, 1)[0].strip()
    match = re.fullmatch(r"```json\s*\n(?P<json>[\s\S]+?)\n```", block)
    if match is None:
        raise ValueError("UX machine-readable block должен быть fenced JSON")
    try:
        document = json.loads(match.group("json"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"UX machine-readable JSON невалиден: {exc}") from exc
    if not isinstance(document, dict):
        raise ValueError("UX machine-readable JSON должен быть объектом")
    errors = validate_ux_eval_document(
        document,
        repo_root=repo_root,
        require_artifacts=require_artifacts,
    )
    if errors:
        raise ValueError("; ".join(errors))
    return document


def ux_eval_result_alignment_errors(
    result: Mapping[str, Any],
    ux_document: Mapping[str, Any],
) -> list[str]:
    categories = ux_document.get("categories")
    expected_categories = (
        {
            category_id: category.get("score")
            for category_id, category in categories.items()
            if isinstance(category, dict)
        }
        if isinstance(categories, dict)
        else {}
    )
    if result.get("ux_categories") != expected_categories:
        return ["ux_categories не совпадает с UX_EVAL_RU.md"]
    if result.get("ux_total") != ux_document.get("ux_total"):
        return ["ux_total не совпадает с UX_EVAL_RU.md"]
    return []


def build_cp7_ux_manifest(
    repo_root: Path,
    *,
    evaluated_commit: str,
) -> dict[str, Any]:
    if not SHA_RE.fullmatch(evaluated_commit):
        raise ValueError("CP7 UX evaluated_commit должен быть полным Git SHA")
    document = load_ux_eval_evidence(
        repo_root,
        require_artifacts=True,
    )
    categories = document.get("categories")
    artifacts = document.get("artifacts")
    if not isinstance(categories, dict) or not isinstance(artifacts, list):
        raise ValueError("CP7 UX evidence не содержит categories/artifacts")
    return {
        "evaluated_commit": evaluated_commit,
        "document_path": UX_EVAL_RELATIVE_PATH,
        "document_sha256": _file_sha256(repo_root / UX_EVAL_RELATIVE_PATH),
        "ux_total": document.get("ux_total"),
        "ux_categories": {
            category_id: category.get("score")
            for category_id, category in categories.items()
            if isinstance(category, dict)
        },
        "artifacts": [
            {
                "id": item.get("id"),
                "path": item.get("path"),
                "sha256": item.get("sha256"),
            }
            for item in artifacts
            if isinstance(item, dict)
        ],
    }


def cp7_ux_evidence_errors(
    result: Mapping[str, Any],
    repo_root: Path,
) -> list[str]:
    try:
        ux_document = load_ux_eval_evidence(
            repo_root,
            require_artifacts=True,
        )
    except ValueError as exc:
        return [f"CP7 UX evidence: {exc}"]
    errors = ux_eval_result_alignment_errors(result, ux_document)
    checkpoint_results = result.get("checkpoint_results")
    cp7 = checkpoint_results.get("CP7") if isinstance(checkpoint_results, dict) else None
    evidence = cp7.get("evidence") if isinstance(cp7, dict) else None
    evaluated_commit = cp7.get("evaluated_commit") if isinstance(cp7, dict) else None
    ux_manifest = evidence.get("ux_manifest") if isinstance(evidence, dict) else None
    if not isinstance(evaluated_commit, str):
        errors.append("CP7 UX evaluated_commit отсутствует")
        return errors
    try:
        actual_manifest = build_cp7_ux_manifest(
            repo_root,
            evaluated_commit=evaluated_commit,
        )
    except ValueError as exc:
        errors.append(f"CP7 UX manifest: {exc}")
        return errors
    if ux_manifest != actual_manifest:
        errors.append("CP7 ux_manifest не совпадает с current document/artifacts")
    return errors


def _load_json_object(path: Path, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"{label} отсутствует: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} содержит невалидный JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} должен быть JSON-объектом")
    return value


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _require_regular_contained_file(
    root: Path,
    path: Path,
    *,
    trusted_base: Path,
    label: str,
) -> None:
    _require_contained_directory(
        trusted_base,
        root,
        trusted_base=trusted_base,
        label=f"{label} evidence root",
    )
    if path.is_symlink():
        raise ValueError(f"{label} не может быть символической ссылкой")
    try:
        resolved_root = root.resolve(strict=True)
        resolved_path = path.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError(f"{label} отсутствует: {path}") from exc
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError(f"{label} выходит за разрешённый evidence root") from exc
    current = path.parent
    while current != root:
        if current.is_symlink():
            raise ValueError(f"{label} проходит через символическую ссылку")
        if current == current.parent:
            raise ValueError(f"{label} выходит за разрешённый evidence root")
        current = current.parent
    if not path.is_file():
        raise ValueError(f"{label} должен быть обычным файлом")


def _require_contained_directory(
    root: Path,
    path: Path,
    *,
    trusted_base: Path,
    label: str,
) -> None:
    if trusted_base.is_symlink():
        raise ValueError(f"{label}: trusted base не может быть символической ссылкой")
    try:
        path.relative_to(trusted_base)
        resolved_base = trusted_base.resolve(strict=True)
        resolved_root = root.resolve(strict=True)
        resolved_path = path.resolve(strict=True)
        resolved_root.relative_to(resolved_base)
        resolved_path.relative_to(resolved_root)
    except (FileNotFoundError, ValueError) as exc:
        raise ValueError(f"{label} отсутствует или выходит за evidence root") from exc
    current = path
    while True:
        if current.is_symlink():
            raise ValueError(f"{label} не может проходить через символическую ссылку")
        if current == trusted_base:
            break
        if current == current.parent:
            raise ValueError(f"{label} выходит за trusted base")
        current = current.parent
    if not path.is_dir():
        raise ValueError(f"{label} должен быть каталогом")


def load_cp7_operations_evidence(
    repo_root: Path,
    *,
    evaluated_commit: str,
    check_cleanup: bool = False,
) -> dict[str, Any]:
    if not SHA_RE.fullmatch(evaluated_commit):
        raise ValueError("CP7 operations evaluated_commit должен быть полным Git SHA")

    operations_root = repo_root / "artifacts/product-reset/CP7/ops"
    _require_contained_directory(
        repo_root,
        operations_root,
        trusted_base=repo_root,
        label="CP7 operations evidence root",
    )
    pointer = operations_root / "latest-run.txt"
    _require_regular_contained_file(
        operations_root,
        pointer,
        trusted_base=repo_root,
        label="CP7 operations latest-run pointer",
    )
    try:
        run_id = pointer.read_text(encoding="utf-8").strip()
    except FileNotFoundError as exc:
        raise ValueError("CP7 operations latest-run pointer отсутствует") from exc
    expected_prefix = rf"^\d{{8}}T\d{{6}}Z-{re.escape(evaluated_commit[:12])}-[0-9a-f]{{8}}$"
    if not re.fullmatch(expected_prefix, run_id):
        raise ValueError("CP7 operations run_id не привязан к exact evaluated commit")

    runs_root = operations_root / "runs"
    _require_contained_directory(
        operations_root,
        runs_root,
        trusted_base=repo_root,
        label="CP7 operations runs root",
    )
    run_root = runs_root / run_id
    _require_contained_directory(
        runs_root,
        run_root,
        trusted_base=repo_root,
        label="CP7 operations run directory",
    )

    manifest_path = run_root / "manifest.json"
    _require_regular_contained_file(
        run_root,
        manifest_path,
        trusted_base=repo_root,
        label="CP7 operations manifest",
    )
    manifest = _load_json_object(
        manifest_path,
        label="CP7 operations manifest",
    )
    if set(manifest) != {
        "schema_version",
        "run_id",
        "evaluated_commit",
        "project_name",
        "restore_project_name",
        "logs_validation",
        "cleanup",
        "files",
    }:
        raise ValueError("CP7 operations manifest должен содержать exact contract")
    if (
        manifest.get("schema_version") != 1
        or manifest.get("run_id") != run_id
        or manifest.get("evaluated_commit") != evaluated_commit
        or manifest.get("project_name") != "nn-product-reset-eval-final"
        or manifest.get("restore_project_name")
        != "nn-product-reset-eval-final-restore"
        or manifest.get("logs_validation") != "passed"
        or manifest.get("cleanup") != "passed"
    ):
        raise ValueError("CP7 operations manifest status/source binding невалиден")
    manifest_files = manifest.get("files")
    if (
        not isinstance(manifest_files, dict)
        or set(manifest_files) != set(CP7_OPERATIONS_MANIFEST_FILES)
    ):
        raise ValueError("CP7 operations manifest files не совпадают с exact contract")
    expected_regular_files = {
        "manifest.json",
        *CP7_OPERATIONS_MANIFEST_FILES,
    }
    actual_regular_files = {
        path.relative_to(run_root).as_posix()
        for path in run_root.rglob("*")
        if (path.is_file() or path.is_symlink()) and not path.name.startswith("._")
    }
    if actual_regular_files != expected_regular_files:
        raise ValueError("CP7 operations run root нарушает exact regular-file set")
    actual_directories = {
        path.relative_to(run_root).as_posix()
        for path in run_root.rglob("*")
        if path.is_dir() and not path.is_symlink()
    }
    if actual_directories != {"backup"}:
        raise ValueError("CP7 operations run root содержит неожиданные каталоги")
    for relative_path in CP7_OPERATIONS_MANIFEST_FILES:
        digest = manifest_files.get(relative_path)
        path = run_root / relative_path
        _require_regular_contained_file(
            run_root,
            path,
            trusted_base=repo_root,
            label=f"CP7 operations artifact {relative_path}",
        )
        if (
            not isinstance(digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", digest)
            or not path.is_file()
            or _file_sha256(path) != digest
        ):
            raise ValueError(
                f"CP7 operations manifest file hash не совпадает: {relative_path}"
            )

    result_path = run_root / "result.json"
    result = _load_json_object(result_path, label="CP7 operations result")
    expected_result = {
        "schema_version": 1,
        "run_id": run_id,
        "evaluated_commit": evaluated_commit,
        "project_name": "nn-product-reset-eval-final",
        "restore_project_name": "nn-product-reset-eval-final-restore",
        "fresh_build": True,
        "migration": "passed",
        "synthetic_seed": "passed",
        "health_smoke": "passed",
        "backup_checksum": "passed",
        "empty_restore": "passed",
        "post_restore_counts": "matched",
        "post_restore_smoke": "passed",
    }
    if result != expected_result:
        raise ValueError("CP7 operations result не совпадает с exact rehearsal contract")

    counts_before_path = run_root / "counts-before.json"
    counts_after_path = run_root / "counts-after.json"
    counts_before = _load_json_object(
        counts_before_path,
        label="CP7 operations counts-before",
    )
    counts_after = _load_json_object(
        counts_after_path,
        label="CP7 operations counts-after",
    )
    expected_count_keys = {
        "users",
        "rubrics",
        "stories",
        "archived",
        "scenarios",
        "scenario_rows",
    }
    if set(counts_before) != expected_count_keys or counts_after != counts_before:
        raise ValueError("CP7 operations key counts не совпадают до/после restore")
    minimum_counts = {
        "users": 8,
        "rubrics": 4,
        "stories": 35,
        "archived": 5,
        "scenarios": 35,
    }
    if any(
        type(counts_before.get(key)) is not int or counts_before.get(key, 0) < minimum
        for key, minimum in minimum_counts.items()
    ) or type(counts_before.get("scenario_rows")) is not int or counts_before.get(
        "scenario_rows", -1
    ) < 0:
        raise ValueError("CP7 operations key counts не подтверждают synthetic dataset")

    smoke_paths = {
        "before": run_root / "smoke-before.json",
        "after": run_root / "smoke-after.json",
    }
    expected_smoke = {
        "health": 200,
        "root": 200,
        "unauthenticated": 401,
        "authenticated": True,
    }
    for phase, smoke_path in smoke_paths.items():
        if _load_json_object(
            smoke_path,
            label=f"CP7 operations smoke-{phase}",
        ) != expected_smoke:
            raise ValueError(f"CP7 operations authenticated smoke {phase} не пройден")

    source_preparation_path = run_root / "source-preparation.log"
    try:
        source_lines = source_preparation_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as exc:
        raise ValueError("CP7 operations source-preparation evidence отсутствует") from exc
    expected_source_lines = [
        "source_root=temporary",
        f"tracked_commit={evaluated_commit}",
        "appledouble_files=0",
        "real_env_files=0",
        "secret_like_files=0",
    ]
    if source_lines != expected_source_lines:
        raise ValueError("CP7 operations source preparation не подтверждает redacted exact source")

    backup_root = run_root / "backup"
    backup_files = {
        path.name
        for path in backup_root.iterdir()
        if path.is_file() and not path.name.startswith("._")
    } if backup_root.is_dir() else set()
    if backup_files != {"postgres.dump", "postgres.dump.sha256"}:
        raise ValueError("CP7 operations backup должен содержать exact dump и checksum")
    backup_path = backup_root / "postgres.dump"
    backup_digest = _file_sha256(backup_path)
    checksum_text = (backup_root / "postgres.dump.sha256").read_text(
        encoding="utf-8"
    ).strip()
    if checksum_text != f"{backup_digest}  postgres.dump":
        raise ValueError("CP7 operations backup checksum не совпадает с exact dump")

    forbidden_fragments = (
        "/Users/",
        "/Volumes/",
        "/private/var/folders/",
        "BEGIN PRIVATE KEY",
        "BEGIN OPENSSH PRIVATE KEY",
    )
    failure_patterns = (
        re.compile(
            r"(?im)^(?:[A-Za-z0-9_.-]+-\d+\s+\|\s*)?"
            r"traceback \(most recent call last\):"
        ),
        re.compile(
            r"(?im)^(?:[A-Za-z0-9_.-]+-\d+\s+\|\s*)?"
            r"error response from daemon:"
        ),
        re.compile(
            r"(?im)^(?:[A-Za-z0-9_.-]+-\d+\s+\|\s*)?"
            r"(?:\d{4}-\d{2}-\d{2}\s+[0-9:.+-]+\s+\S+"
            r"(?:\s+\[\d+\])?\s+)?(?:error|fatal|panic):\s"
        ),
        re.compile(
            r"(?im)^(?:[A-Za-z0-9_.-]+-\d+\s+\|\s*)?"
            r"\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}\s+"
            r"\[(?:error|crit|alert|emerg)\]"
        ),
        re.compile(r"(?i)\bunhandled exception\b"),
    )
    for path in run_root.rglob("*"):
        if (
            not path.is_file()
            or path.name.startswith("._")
            or path == backup_path
        ):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if any(fragment in text for fragment in forbidden_fragments):
            raise ValueError(f"CP7 operations artifact не прошёл redaction: {path.name}")
        if path.suffix == ".log" and any(pattern.search(text) for pattern in failure_patterns):
            raise ValueError(
                f"CP7 operations unhandled failure marker: {path.name}"
            )

    if check_cleanup:
        for project_name in (
            "nn-product-reset-eval-final",
            "nn-product-reset-eval-final-restore",
        ):
            resource_commands = (
                (
                    "containers",
                    [
                        "docker",
                        "ps",
                        "-aq",
                        "--filter",
                        f"label=com.docker.compose.project={project_name}",
                    ],
                ),
                (
                    "volumes",
                    [
                        "docker",
                        "volume",
                        "ls",
                        "-q",
                        "--filter",
                        f"label=com.docker.compose.project={project_name}",
                    ],
                ),
                (
                    "networks",
                    [
                        "docker",
                        "network",
                        "ls",
                        "-q",
                        "--filter",
                        f"label=com.docker.compose.project={project_name}",
                    ],
                ),
            )
            for resource_kind, command in resource_commands:
                completed = subprocess.run(
                    command,
                    cwd=repo_root,
                    check=False,
                    capture_output=True,
                    text=True,
                )
                if completed.returncode != 0:
                    raise ValueError(
                        f"CP7 operations cleanup check не запустился для {resource_kind}"
                    )
                if completed.stdout.strip():
                    raise ValueError(
                        f"CP7 operations cleanup оставил {resource_kind} project {project_name}"
                    )

    return {
        "run_id": run_id,
        "evaluated_commit": evaluated_commit,
        "manifest_sha256": _file_sha256(manifest_path),
    }


def cp7_operations_evidence_errors(
    result: Mapping[str, Any],
    repo_root: Path,
) -> list[str]:
    checkpoint_results = result.get("checkpoint_results")
    cp7 = checkpoint_results.get("CP7") if isinstance(checkpoint_results, dict) else None
    evidence = cp7.get("evidence") if isinstance(cp7, dict) else None
    evaluated_commit = cp7.get("evaluated_commit") if isinstance(cp7, dict) else None
    operations_run = evidence.get("operations_run") if isinstance(evidence, dict) else None
    if not isinstance(evaluated_commit, str):
        return ["CP7 operations evaluated_commit отсутствует"]
    try:
        actual = load_cp7_operations_evidence(
            repo_root,
            evaluated_commit=evaluated_commit,
            check_cleanup=True,
        )
    except ValueError as exc:
        return [f"CP7 operations evidence: {exc}"]
    if operations_run != actual:
        return ["CP7 operations_run не совпадает с immutable local artifacts"]
    return []


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


def _cp5_schema_errors(
    document: Mapping[str, Any], *, validate_command_results: bool = True
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    cp5 = checkpoint_results.get("CP5") if isinstance(checkpoint_results, dict) else None
    evidence = cp5.get("evidence") if isinstance(cp5, dict) else None
    if not isinstance(evidence, dict):
        return ["checkpoint_results.CP5.evidence должен быть JSON-объектом"]

    errors: list[str] = []
    try:
        serialized = json.dumps(evidence, ensure_ascii=False).casefold()
    except (TypeError, ValueError):
        return ["checkpoint_results.CP5.evidence должен быть сериализуемым JSON"]
    for marker in INVALID_EVIDENCE_MARKERS:
        if marker in serialized:
            errors.append(f"CP5 evidence содержит запрещённый маркер: {marker}")

    expected_keys = {"schema_version", *CP5_REQUIRED_EVIDENCE, "commands"}
    if set(evidence) != expected_keys:
        errors.append("CP5 evidence должен содержать точный структурированный contract")
    if type(evidence.get("schema_version")) is not int or evidence.get("schema_version") != 1:
        errors.append("CP5 evidence schema_version должен иметь значение 1")
    for section, expected in CP5_REQUIRED_EVIDENCE.items():
        if not _exact_contract_match(evidence.get(section), expected):
            errors.append(f"CP5 evidence {section} не совпадает с contract")

    commands = evidence.get("commands")
    if not validate_command_results and commands == []:
        return errors
    if not isinstance(commands, list) or not all(isinstance(item, dict) for item in commands):
        errors.append("CP5 evidence commands должен быть списком объектов")
    else:
        command_ids = [item.get("id") for item in commands]
        ids_are_strings = all(isinstance(command_id, str) for command_id in command_ids)
        if not ids_are_strings or len(command_ids) != len(set(command_ids)):
            errors.append("CP5 evidence command IDs должны быть уникальными строками")
        for command_id in command_ids:
            if not isinstance(command_id, str) or command_id not in CP5_REQUIRED_COMMANDS:
                errors.append(f"CP5 evidence содержит неизвестный command ID: {command_id}")
        if command_ids != list(CP5_REQUIRED_COMMANDS):
            errors.append("CP5 evidence commands должны идти в точном порядке contract")

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
                errors.append(f"CP5 evidence command {command_id}: запись должна иметь точные поля")
            if not isinstance(command_id, str) or command_id not in CP5_REQUIRED_COMMANDS:
                continue

            command = CP5_REQUIRED_COMMANDS[command_id]
            if item.get("command") != command:
                errors.append(f"CP5 evidence command {command_id} не совпадает с contract")
            expected_exit_code = item.get("expected_exit_code")
            if (
                not isinstance(expected_exit_code, int)
                or isinstance(expected_exit_code, bool)
                or expected_exit_code != 0
            ):
                errors.append(
                    f"CP5 evidence command {command_id}: expected_exit_code не совпадает с contract"
                )
            if not validate_command_results:
                continue

            exit_code = item.get("exit_code")
            count = item.get("count")
            outcome = item.get("outcome")
            if not isinstance(exit_code, int) or isinstance(exit_code, bool):
                errors.append(f"CP5 evidence command {command_id}: exit_code должен быть целым")
            if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                errors.append(
                    f"CP5 evidence command {command_id}: count должен быть неотрицательным"
                )
            command_passed = (
                isinstance(exit_code, int)
                and not isinstance(exit_code, bool)
                and exit_code == 0
                and isinstance(count, int)
                and not isinstance(count, bool)
                and count >= 1
            )
            if outcome not in {"automated_pass", "automated_failure"}:
                errors.append(f"CP5 evidence command {command_id}: поле outcome невалидно")
            if not command_passed or outcome != "automated_pass":
                errors.append(
                    f"CP5 evidence command {command_id} не подтвердил expected exit/count contract"
                )

            reproducibility = item.get("reproducibility")
            if not isinstance(reproducibility, dict) or (
                set(reproducibility) != expected_reproducibility_keys
                or reproducibility.get("runner") != "product_reset_eval.py"
                or reproducibility.get("evaluated_commit") != cp5.get("evaluated_commit")
                or reproducibility.get("command_sha256") != _sha256_text(command)
                or not isinstance(reproducibility.get("output_sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", reproducibility.get("output_sha256", ""))
                or not isinstance(reproducibility.get("summary"), str)
                or not reproducibility.get("summary")
                or not isinstance(reproducibility.get("duration_ms"), int)
                or isinstance(reproducibility.get("duration_ms"), bool)
                or reproducibility.get("duration_ms", -1) < 0
            ):
                errors.append(
                    f"CP5 evidence command {command_id}: метаданные воспроизводимости невалидны"
                )

    if validate_command_results and (
        not isinstance(cp5.get("evaluated_commit"), str)
        or not SHA_RE.fullmatch(cp5.get("evaluated_commit"))
    ):
        errors.append("checkpoint_results.CP5.evaluated_commit должен быть полным Git SHA")
    return errors


def _cp6_schema_errors(
    document: Mapping[str, Any], *, validate_command_results: bool = True
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    cp6 = checkpoint_results.get("CP6") if isinstance(checkpoint_results, dict) else None
    evidence = cp6.get("evidence") if isinstance(cp6, dict) else None
    if not isinstance(evidence, dict):
        return ["checkpoint_results.CP6.evidence должен быть JSON-объектом"]

    errors: list[str] = []
    try:
        serialized = json.dumps(evidence, ensure_ascii=False).casefold()
    except (TypeError, ValueError):
        return ["checkpoint_results.CP6.evidence должен быть сериализуемым JSON"]
    for marker in INVALID_EVIDENCE_MARKERS:
        if marker in serialized:
            errors.append(f"CP6 evidence содержит запрещённый маркер: {marker}")

    expected_keys = {"schema_version", *CP6_REQUIRED_EVIDENCE, "commands"}
    if set(evidence) != expected_keys:
        errors.append("CP6 evidence должен содержать точный структурированный contract")
    if type(evidence.get("schema_version")) is not int or evidence.get("schema_version") != 1:
        errors.append("CP6 evidence schema_version должен иметь значение 1")
    for section, expected in CP6_REQUIRED_EVIDENCE.items():
        if not _exact_contract_match(evidence.get(section), expected):
            errors.append(f"CP6 evidence {section} не совпадает с contract")

    commands = evidence.get("commands")
    if not validate_command_results and commands == []:
        return errors
    if not isinstance(commands, list) or not all(isinstance(item, dict) for item in commands):
        errors.append("CP6 evidence commands должен быть списком объектов")
    else:
        command_ids = [item.get("id") for item in commands]
        ids_are_strings = all(isinstance(command_id, str) for command_id in command_ids)
        if not ids_are_strings or len(command_ids) != len(set(command_ids)):
            errors.append("CP6 evidence command IDs должны быть уникальными строками")
        for command_id in command_ids:
            if not isinstance(command_id, str) or command_id not in CP6_REQUIRED_COMMANDS:
                errors.append(f"CP6 evidence содержит неизвестный command ID: {command_id}")
        if command_ids != list(CP6_REQUIRED_COMMANDS):
            errors.append("CP6 evidence commands должны идти в точном порядке contract")

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
                errors.append(f"CP6 evidence command {command_id}: запись должна иметь точные поля")
            if not isinstance(command_id, str) or command_id not in CP6_REQUIRED_COMMANDS:
                continue

            command = CP6_REQUIRED_COMMANDS[command_id]
            if item.get("command") != command:
                errors.append(f"CP6 evidence command {command_id} не совпадает с contract")
            expected_exit_code = item.get("expected_exit_code")
            if (
                not isinstance(expected_exit_code, int)
                or isinstance(expected_exit_code, bool)
                or expected_exit_code != 0
            ):
                errors.append(
                    f"CP6 evidence command {command_id}: expected_exit_code не совпадает с contract"
                )
            if not validate_command_results:
                continue

            exit_code = item.get("exit_code")
            count = item.get("count")
            outcome = item.get("outcome")
            if not isinstance(exit_code, int) or isinstance(exit_code, bool):
                errors.append(f"CP6 evidence command {command_id}: exit_code должен быть целым")
            if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                errors.append(
                    f"CP6 evidence command {command_id}: count должен быть неотрицательным"
                )
            command_passed = (
                isinstance(exit_code, int)
                and not isinstance(exit_code, bool)
                and exit_code == 0
                and isinstance(count, int)
                and not isinstance(count, bool)
                and count >= 1
            )
            if outcome not in {"automated_pass", "automated_failure"}:
                errors.append(f"CP6 evidence command {command_id}: поле outcome невалидно")
            if not command_passed or outcome != "automated_pass":
                errors.append(
                    f"CP6 evidence command {command_id} не подтвердил expected exit/count contract"
                )

            reproducibility = item.get("reproducibility")
            if not isinstance(reproducibility, dict) or (
                set(reproducibility) != expected_reproducibility_keys
                or reproducibility.get("runner") != "product_reset_eval.py"
                or reproducibility.get("evaluated_commit") != cp6.get("evaluated_commit")
                or reproducibility.get("command_sha256") != _sha256_text(command)
                or not isinstance(reproducibility.get("output_sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", reproducibility.get("output_sha256", ""))
                or not isinstance(reproducibility.get("summary"), str)
                or not reproducibility.get("summary")
                or not isinstance(reproducibility.get("duration_ms"), int)
                or isinstance(reproducibility.get("duration_ms"), bool)
                or reproducibility.get("duration_ms", -1) < 0
            ):
                errors.append(
                    f"CP6 evidence command {command_id}: метаданные воспроизводимости невалидны"
                )

    if validate_command_results and (
        not isinstance(cp6.get("evaluated_commit"), str)
        or not SHA_RE.fullmatch(cp6.get("evaluated_commit"))
    ):
        errors.append("checkpoint_results.CP6.evaluated_commit должен быть полным Git SHA")
    return errors


def _cp7_schema_errors(
    document: Mapping[str, Any], *, validate_command_results: bool = True
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    cp7 = checkpoint_results.get("CP7") if isinstance(checkpoint_results, dict) else None
    evidence = cp7.get("evidence") if isinstance(cp7, dict) else None
    if not isinstance(evidence, dict):
        return ["checkpoint_results.CP7.evidence должен быть JSON-объектом"]

    errors: list[str] = []
    try:
        serialized = json.dumps(evidence, ensure_ascii=False).casefold()
    except (TypeError, ValueError):
        return ["checkpoint_results.CP7.evidence должен быть сериализуемым JSON"]
    for marker in INVALID_EVIDENCE_MARKERS:
        if marker in serialized:
            errors.append(f"CP7 evidence содержит запрещённый маркер: {marker}")

    expected_keys = {
        "schema_version",
        *CP7_REQUIRED_EVIDENCE,
        "ux_manifest",
        "operations_run",
        "commands",
    }
    if set(evidence) != expected_keys:
        errors.append("CP7 evidence должен содержать точный структурированный contract")
    if type(evidence.get("schema_version")) is not int or evidence.get("schema_version") != 1:
        errors.append("CP7 evidence schema_version должен иметь значение 1")
    for section, expected in CP7_REQUIRED_EVIDENCE.items():
        if not _exact_contract_match(evidence.get(section), expected):
            errors.append(f"CP7 evidence {section} не совпадает с contract")

    ux_manifest = evidence.get("ux_manifest")
    if not validate_command_results and ux_manifest is None:
        pass
    elif not isinstance(ux_manifest, dict) or set(ux_manifest) != {
        "evaluated_commit",
        "document_path",
        "document_sha256",
        "ux_total",
        "ux_categories",
        "artifacts",
    }:
        errors.append("CP7 evidence ux_manifest должен содержать exact artifact binding")
    else:
        evaluated_commit = cp7.get("evaluated_commit") if isinstance(cp7, dict) else None
        if ux_manifest.get("evaluated_commit") != evaluated_commit:
            errors.append("CP7 evidence ux_manifest не совпадает с evaluated_commit")
        if ux_manifest.get("document_path") != UX_EVAL_RELATIVE_PATH:
            errors.append("CP7 evidence ux_manifest.document_path невалиден")
        if not isinstance(ux_manifest.get("document_sha256"), str) or not re.fullmatch(
            r"[0-9a-f]{64}",
            ux_manifest.get("document_sha256", ""),
        ):
            errors.append("CP7 evidence ux_manifest.document_sha256 должен быть SHA256")
        if ux_manifest.get("ux_total") != document.get("ux_total"):
            errors.append("CP7 evidence ux_manifest.ux_total не совпадает с eval")
        if ux_manifest.get("ux_categories") != document.get("ux_categories"):
            errors.append("CP7 evidence ux_manifest.ux_categories не совпадает с eval")
        artifacts = ux_manifest.get("artifacts")
        if (
            not isinstance(artifacts, list)
            or len(artifacts) != len(UX_REQUIRED_SCREENSHOT_MATRIX | UX_REQUIRED_AXE_MATRIX)
            or not all(
                isinstance(item, dict)
                and set(item) == {"id", "path", "sha256"}
                and _nonempty_string(item.get("id"))
                and not _ux_artifact_path_errors(item.get("path"))
                and isinstance(item.get("sha256"), str)
                and bool(re.fullmatch(r"[0-9a-f]{64}", item.get("sha256", "")))
                for item in artifacts
            )
        ):
            errors.append("CP7 evidence ux_manifest.artifacts не содержит exact UX matrix")

    operations_run = evidence.get("operations_run")
    if not validate_command_results and operations_run is None:
        pass
    elif not isinstance(operations_run, dict) or set(operations_run) != {
        "run_id",
        "evaluated_commit",
        "manifest_sha256",
    }:
        errors.append("CP7 evidence operations_run должен содержать exact artifact binding")
    else:
        evaluated_commit = cp7.get("evaluated_commit") if isinstance(cp7, dict) else None
        if operations_run.get("evaluated_commit") != evaluated_commit:
            errors.append("CP7 evidence operations_run не совпадает с evaluated_commit")
        run_id = operations_run.get("run_id")
        if (
            not isinstance(run_id, str)
            or not isinstance(evaluated_commit, str)
            or not re.fullmatch(
                rf"\d{{8}}T\d{{6}}Z-{re.escape(evaluated_commit[:12])}-[0-9a-f]{{8}}",
                run_id,
            )
        ):
            errors.append("CP7 evidence operations_run.run_id не привязан к exact source")
        digest = operations_run.get("manifest_sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            errors.append("CP7 evidence operations_run.manifest_sha256 должен быть SHA256")

    commands = evidence.get("commands")
    if not validate_command_results and commands == []:
        return errors
    if not isinstance(commands, list) or not all(isinstance(item, dict) for item in commands):
        errors.append("CP7 evidence commands должен быть списком объектов")
    else:
        command_ids = [item.get("id") for item in commands]
        if (
            not all(isinstance(command_id, str) for command_id in command_ids)
            or len(command_ids) != len(set(command_ids))
        ):
            errors.append("CP7 evidence command IDs должны быть уникальными строками")
        for command_id in command_ids:
            if not isinstance(command_id, str) or command_id not in CP7_REQUIRED_COMMANDS:
                errors.append(f"CP7 evidence содержит неизвестный command ID: {command_id}")
        if command_ids != list(CP7_REQUIRED_COMMANDS):
            errors.append("CP7 evidence commands должны идти в точном порядке contract")

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
                errors.append(f"CP7 evidence command {command_id}: запись должна иметь точные поля")
            if not isinstance(command_id, str) or command_id not in CP7_REQUIRED_COMMANDS:
                continue
            command = CP7_REQUIRED_COMMANDS[command_id]
            if item.get("command") != command:
                errors.append(f"CP7 evidence command {command_id} не совпадает с contract")
            if type(item.get("expected_exit_code")) is not int or item.get(
                "expected_exit_code"
            ) != 0:
                errors.append(
                    f"CP7 evidence command {command_id}: expected_exit_code не совпадает с contract"
                )
            if not validate_command_results:
                continue
            exit_code = item.get("exit_code")
            count = item.get("count")
            outcome = item.get("outcome")
            command_passed = (
                type(exit_code) is int
                and exit_code == 0
                and type(count) is int
                and count >= 1
                and outcome == "automated_pass"
            )
            if not command_passed:
                errors.append(
                    f"CP7 evidence command {command_id} не подтвердил expected exit/count contract"
                )
            reproducibility = item.get("reproducibility")
            if not isinstance(reproducibility, dict) or (
                set(reproducibility) != expected_reproducibility_keys
                or reproducibility.get("runner") != "product_reset_eval.py"
                or reproducibility.get("evaluated_commit")
                != (cp7.get("evaluated_commit") if isinstance(cp7, dict) else None)
                or reproducibility.get("command_sha256") != _sha256_text(command)
                or not isinstance(reproducibility.get("output_sha256"), str)
                or not re.fullmatch(
                    r"[0-9a-f]{64}",
                    reproducibility.get("output_sha256", ""),
                )
                or not _nonempty_string(reproducibility.get("summary"))
                or type(reproducibility.get("duration_ms")) is not int
                or reproducibility.get("duration_ms", -1) < 0
            ):
                errors.append(
                    f"CP7 evidence command {command_id}: метаданные воспроизводимости невалидны"
                )

    if validate_command_results:
        if (
            not isinstance(cp7, dict)
            or not isinstance(cp7.get("evaluated_commit"), str)
            or not SHA_RE.fullmatch(cp7.get("evaluated_commit", ""))
        ):
            errors.append("checkpoint_results.CP7.evaluated_commit должен быть полным Git SHA")
        local_external_demo_states = (
            {
                "permission_status": "not_granted",
                "status": "blocked_permission",
                "app_sha": None,
            },
            {
                "permission_status": "granted",
                "status": "pending",
                "app_sha": DEMO_APPROVED_APP_SHA,
            },
        )
        final_external_demo_state = {
            "permission_status": "granted",
            "status": "passed",
            "app_sha": DEMO_APPROVED_APP_SHA,
        }
        if document.get("external_demo") in local_external_demo_states:
            if document.get("local_hard_gates_passed") is not True:
                errors.append("local_hard_gates_passed должен быть true после локального CP7")
            if document.get("hard_gates_passed") is not False:
                errors.append("hard_gates_passed должен оставаться false до EXT-DEMO")
            if document.get("full_eval_passed") is not False:
                errors.append("full_eval_passed должен оставаться false до EXT-DEMO")
            if document.get("failed_gates") != ["external_demo"]:
                errors.append("после локального CP7 единственным failed gate должен быть external_demo")
        elif document.get("external_demo") == final_external_demo_state:
            if document.get("local_hard_gates_passed") is not True:
                errors.append("local_hard_gates_passed должен сохраняться true после EXT-DEMO")
            if document.get("hard_gates_passed") is not True:
                errors.append("hard_gates_passed должен иметь значение true после EXT-DEMO")
            if document.get("full_eval_passed") is not True:
                errors.append("full_eval_passed должен иметь значение true после EXT-DEMO")
            if document.get("failed_gates") != []:
                errors.append("после EXT-DEMO failed_gates должен быть пустым")
            completed = document.get("completed_checkpoints")
            if not isinstance(completed, list) or FINAL_CHECKPOINT not in completed:
                errors.append("passed EXT-DEMO должен присутствовать в completed_checkpoints")
        else:
            errors.append("CP7 external_demo должен оставаться fail-closed до EXT.2")
    return errors


def _ux_gate_passed(document: Mapping[str, Any]) -> bool:
    categories = document.get("ux_categories")
    if not isinstance(categories, dict) or list(categories) != list(UX_CATEGORY_LABELS):
        return False
    scores = tuple(categories.values())
    if not all(type(score) is int and 0 <= score <= 10 for score in scores):
        return False
    declared_total = document.get("ux_total")
    if type(declared_total) is not int:
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


def _git_tag_target(repo_root: Path, tag: str) -> str | None:
    completed = _git_run(repo_root, "rev-parse", f"refs/tags/{tag}^{{commit}}")
    if completed.returncode != 0:
        return None
    target = completed.stdout.strip()
    return target if SHA_RE.fullmatch(target) else None


def _git_is_ancestor(repo_root: Path, ancestor: str, descendant: str) -> bool:
    return _git_run(repo_root, "merge-base", "--is-ancestor", ancestor, descendant).returncode == 0


def _git_diff_is_empty(repo_root: Path, base: str, commit: str, paths: tuple[str, ...]) -> bool:
    return _git_run(repo_root, "diff", "--quiet", base, commit, "--", *paths).returncode == 0


def _git_changed_paths(repo_root: Path, base: str, commit: str) -> set[str]:
    completed = _git_run(repo_root, "diff", "--name-only", base, commit, "--")
    if completed.returncode != 0:
        raise ValueError(
            "не удалось получить список изменённых путей: "
            + completed.stderr.strip()
        )
    return {path for path in completed.stdout.splitlines() if path}


def _git_path_exists_at_commit(repo_root: Path, commit: str, path: str) -> bool:
    return _git_run(repo_root, "cat-file", "-e", f"{commit}:{path}").returncode == 0


def _git_file_at_commit(repo_root: Path, commit: str, path: str) -> str | None:
    completed = _git_run(repo_root, "show", f"{commit}:{path}")
    return completed.stdout if completed.returncode == 0 else None


def _historical_checkpoint_binding_errors(
    document: Mapping[str, Any],
    repo_root: Path,
    checkpoints: tuple[str, ...] | None = None,
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    if not isinstance(checkpoint_results, dict):
        return ["checkpoint_results должен быть JSON-объектом для pinned historical evidence"]

    errors: list[str] = []
    checkpoint_order = checkpoints or tuple(HISTORICAL_CHECKPOINT_BINDING_COMMITS)
    for checkpoint in checkpoint_order:
        binding_commit = HISTORICAL_CHECKPOINT_BINDING_COMMITS[checkpoint]
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
    cp4_predecessors = ("CP1", "CP2", "CP3")
    errors.extend(
        _historical_checkpoint_binding_errors(document, repo_root, cp4_predecessors)
    )
    for checkpoint in cp4_predecessors:
        binding_commit = HISTORICAL_CHECKPOINT_BINDING_COMMITS[checkpoint]
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


def _cp5_git_errors(document: Mapping[str, Any], repo_root: Path) -> list[str]:
    errors: list[str] = []
    checkpoint_results = document.get("checkpoint_results")
    cp4 = checkpoint_results.get("CP4") if isinstance(checkpoint_results, dict) else None
    cp5 = checkpoint_results.get("CP5") if isinstance(checkpoint_results, dict) else None
    cp4_commit = cp4.get("evaluated_commit") if isinstance(cp4, dict) else None
    cp5_commit = cp5.get("evaluated_commit") if isinstance(cp5, dict) else None
    latest_commit = document.get("commit")

    if (
        not isinstance(cp5_commit, str)
        or not SHA_RE.fullmatch(cp5_commit)
        or not _git_commit_exists(repo_root, cp5_commit)
    ):
        return ["checkpoint_results.CP5.evaluated_commit не существует как Git commit"]
    cp5_predecessors = ("CP1", "CP2", "CP3", "CP4")
    errors.extend(
        _historical_checkpoint_binding_errors(document, repo_root, cp5_predecessors)
    )
    for checkpoint in cp5_predecessors:
        binding_commit = HISTORICAL_CHECKPOINT_BINDING_COMMITS[checkpoint]
        if _git_commit_exists(repo_root, binding_commit) and not _git_is_ancestor(
            repo_root, binding_commit, cp5_commit
        ):
            errors.append(
                f"{checkpoint} pinned binding commit не является предком CP5 evaluated_commit"
            )
    if (
        not isinstance(latest_commit, str)
        or not SHA_RE.fullmatch(latest_commit)
        or not _git_commit_exists(repo_root, latest_commit)
    ):
        return ["eval commit не существует как Git commit"]
    if not _git_is_ancestor(repo_root, latest_commit, _git_head(repo_root)):
        errors.append("eval commit не является предком текущего HEAD")
    if not _git_is_ancestor(repo_root, cp5_commit, latest_commit):
        errors.append("CP5 evaluated_commit не является предком eval commit")
    if (
        not isinstance(cp4_commit, str)
        or not SHA_RE.fullmatch(cp4_commit)
        or not _git_commit_exists(repo_root, cp4_commit)
        or not _git_is_ancestor(repo_root, cp4_commit, cp5_commit)
    ):
        errors.append("CP4 evaluated_commit не является предком CP5 evaluated_commit")

    for label in ("ANALYZED_PRODUCT_BASE_SHA", "IMPLEMENTATION_BASE_SHA"):
        base = document.get(label)
        if (
            not isinstance(base, str)
            or not SHA_RE.fullmatch(base)
            or not _git_commit_exists(repo_root, base)
            or not _git_is_ancestor(repo_root, base, cp5_commit)
        ):
            errors.append(f"{label} не является предком CP5 evaluated_commit")

    for path in CP5_REFERENCED_FILES:
        if not _git_path_exists_at_commit(repo_root, cp5_commit, path):
            errors.append(f"CP5 evidence path отсутствует в CP5 evaluated_commit: {path}")
    if isinstance(cp4_commit, str) and SHA_RE.fullmatch(cp4_commit) and not _git_diff_is_empty(
        repo_root,
        cp4_commit,
        cp5_commit,
        ("backend/migrations",),
    ):
        errors.append("CP5 evaluated_commit изменяет запрещённое дерево backend/migrations")

    historical_validators = (
        ("CP1", _cp1_schema_errors, _cp1_git_errors),
        ("CP2", _cp2_schema_errors, _cp2_git_errors),
        ("CP3", _cp3_schema_errors, _cp3_git_errors),
        ("CP4", _cp4_schema_errors, _cp4_git_errors),
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


def _cp6_git_errors(document: Mapping[str, Any], repo_root: Path) -> list[str]:
    errors: list[str] = []
    checkpoint_results = document.get("checkpoint_results")
    cp5 = checkpoint_results.get("CP5") if isinstance(checkpoint_results, dict) else None
    cp6 = checkpoint_results.get("CP6") if isinstance(checkpoint_results, dict) else None
    cp5_commit = cp5.get("evaluated_commit") if isinstance(cp5, dict) else None
    cp6_commit = cp6.get("evaluated_commit") if isinstance(cp6, dict) else None
    latest_commit = document.get("commit")

    if (
        not isinstance(cp6_commit, str)
        or not SHA_RE.fullmatch(cp6_commit)
        or not _git_commit_exists(repo_root, cp6_commit)
    ):
        return ["checkpoint_results.CP6.evaluated_commit не существует как Git commit"]
    cp6_predecessors = ("CP1", "CP2", "CP3", "CP4", "CP5")
    errors.extend(
        _historical_checkpoint_binding_errors(document, repo_root, cp6_predecessors)
    )
    for checkpoint in cp6_predecessors:
        binding_commit = HISTORICAL_CHECKPOINT_BINDING_COMMITS[checkpoint]
        if _git_commit_exists(repo_root, binding_commit) and not _git_is_ancestor(
            repo_root, binding_commit, cp6_commit
        ):
            errors.append(
                f"{checkpoint} pinned binding commit не является предком CP6 evaluated_commit"
            )
    if (
        not isinstance(latest_commit, str)
        or not SHA_RE.fullmatch(latest_commit)
        or not _git_commit_exists(repo_root, latest_commit)
    ):
        return ["eval commit не существует как Git commit"]
    if not _git_is_ancestor(repo_root, latest_commit, _git_head(repo_root)):
        errors.append("eval commit не является предком текущего HEAD")
    if not _git_is_ancestor(repo_root, cp6_commit, latest_commit):
        errors.append("CP6 evaluated_commit не является предком eval commit")
    if (
        not isinstance(cp5_commit, str)
        or not SHA_RE.fullmatch(cp5_commit)
        or not _git_commit_exists(repo_root, cp5_commit)
        or not _git_is_ancestor(repo_root, cp5_commit, cp6_commit)
    ):
        errors.append("CP5 evaluated_commit не является предком CP6 evaluated_commit")

    for label in ("ANALYZED_PRODUCT_BASE_SHA", "IMPLEMENTATION_BASE_SHA"):
        base = document.get(label)
        if (
            not isinstance(base, str)
            or not SHA_RE.fullmatch(base)
            or not _git_commit_exists(repo_root, base)
            or not _git_is_ancestor(repo_root, base, cp6_commit)
        ):
            errors.append(f"{label} не является предком CP6 evaluated_commit")

    for path in CP6_REFERENCED_FILES:
        if not _git_path_exists_at_commit(repo_root, cp6_commit, path):
            errors.append(f"CP6 evidence path отсутствует в CP6 evaluated_commit: {path}")
    if isinstance(cp5_commit, str) and SHA_RE.fullmatch(cp5_commit) and not _git_diff_is_empty(
        repo_root,
        cp5_commit,
        cp6_commit,
        ("backend/migrations",),
    ):
        errors.append("CP6 evaluated_commit изменяет запрещённое дерево backend/migrations")

    historical_validators = (
        ("CP1", _cp1_schema_errors, _cp1_git_errors),
        ("CP2", _cp2_schema_errors, _cp2_git_errors),
        ("CP3", _cp3_schema_errors, _cp3_git_errors),
        ("CP4", _cp4_schema_errors, _cp4_git_errors),
        ("CP5", _cp5_schema_errors, _cp5_git_errors),
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


def _cp7_binding_subtree_errors(
    document: Mapping[str, Any],
    repo_root: Path,
) -> list[str]:
    if CP7_BINDING_COMMIT is None:
        return ["CP7 immutable binding commit ещё не закреплён"]
    if not _git_commit_exists(repo_root, CP7_BINDING_COMMIT):
        return [f"CP7 binding commit недоступен: {CP7_BINDING_COMMIT}"]
    serialized_binding = _git_file_at_commit(
        repo_root,
        CP7_BINDING_COMMIT,
        EVAL_RESULT_RELATIVE_PATH,
    )
    if serialized_binding is None:
        return [f"CP7 binding evidence недоступен в commit {CP7_BINDING_COMMIT}"]
    try:
        binding_document = json.loads(serialized_binding)
    except json.JSONDecodeError:
        return ["CP7 binding evidence содержит невалидный JSON"]
    if not isinstance(binding_document, dict):
        return ["CP7 binding evidence должен быть JSON-объектом"]
    binding_results = binding_document.get("checkpoint_results")
    pinned_result = (
        binding_results.get("CP7") if isinstance(binding_results, dict) else None
    )
    current_results = document.get("checkpoint_results")
    current_result = (
        current_results.get("CP7") if isinstance(current_results, dict) else None
    )
    if not isinstance(pinned_result, dict):
        return ["CP7 subtree отсутствует в binding evidence"]
    if not isinstance(current_result, dict):
        return ["CP7 subtree отсутствует в текущем eval result"]
    errors: list[str] = []
    if not _exact_contract_match(current_result, pinned_result):
        errors.append("CP7 evidence не совпадает с exact binding subtree")
    evaluated_commit = current_result.get("evaluated_commit")
    if (
        not isinstance(evaluated_commit, str)
        or not SHA_RE.fullmatch(evaluated_commit)
        or not _git_is_ancestor(repo_root, evaluated_commit, CP7_BINDING_COMMIT)
    ):
        errors.append("CP7 evaluated_commit не является предком binding commit")
    if not _git_is_ancestor(repo_root, CP7_BINDING_COMMIT, _git_head(repo_root)):
        errors.append("CP7 binding commit не является предком текущего HEAD")
    return errors


def _cp7_git_errors(
    document: Mapping[str, Any],
    repo_root: Path,
    *,
    require_cp7_binding: bool = True,
) -> list[str]:
    checkpoint_results = document.get("checkpoint_results")
    cp6 = checkpoint_results.get("CP6") if isinstance(checkpoint_results, dict) else None
    cp7 = checkpoint_results.get("CP7") if isinstance(checkpoint_results, dict) else None
    evaluated_commit = cp7.get("evaluated_commit") if isinstance(cp7, dict) else None
    latest_commit = document.get("commit")
    if (
        not isinstance(evaluated_commit, str)
        or not SHA_RE.fullmatch(evaluated_commit)
        or not _git_commit_exists(repo_root, evaluated_commit)
    ):
        return ["checkpoint_results.CP7.evaluated_commit не существует как Git commit"]
    if (
        not isinstance(latest_commit, str)
        or latest_commit != evaluated_commit
        or not _git_commit_exists(repo_root, latest_commit)
    ):
        return ["eval commit должен совпадать с exact CP7 evaluated_commit"]

    errors: list[str] = []
    head = _git_head(repo_root)
    if not _git_is_ancestor(repo_root, evaluated_commit, head):
        errors.append("CP7 evaluated_commit не является предком текущего HEAD")
    cp6_commit = cp6.get("evaluated_commit") if isinstance(cp6, dict) else None
    if (
        not isinstance(cp6_commit, str)
        or not SHA_RE.fullmatch(cp6_commit)
        or not _git_is_ancestor(repo_root, cp6_commit, evaluated_commit)
    ):
        errors.append("CP6 evaluated_commit не является предком CP7 evaluated_commit")
    errors.extend(
        _historical_checkpoint_binding_errors(document, repo_root, ("CP6",))
    )
    cp6_binding = HISTORICAL_CHECKPOINT_BINDING_COMMITS["CP6"]
    if _git_commit_exists(repo_root, cp6_binding) and not _git_is_ancestor(
        repo_root,
        cp6_binding,
        evaluated_commit,
    ):
        errors.append(
            "CP6 pinned binding commit не является предком CP7 evaluated_commit"
        )

    required_paths = (
        "backend/app/services/product_reset_eval.py",
        "backend/tests/test_product_reset_eval.py",
        "backend/tests/test_ux_eval_evidence.py",
        "docs/product-reset/PROGRESS.md",
        EVAL_RESULT_RELATIVE_PATH,
        "docs/product-reset/RISK_REGISTER_RU.md",
        UX_EVAL_RELATIVE_PATH,
        "deploy/scripts/rehearse_clean_deploy.sh",
    )
    for path in required_paths:
        if not _git_path_exists_at_commit(repo_root, evaluated_commit, path):
            errors.append(f"CP7 evidence path отсутствует в evaluated commit: {path}")

    cp6_schema_errors = _cp6_schema_errors(document)
    if cp6_schema_errors:
        errors.extend(
            f"Историческая CP6 evidence: {error}" for error in cp6_schema_errors
        )
    else:
        errors.extend(_cp6_git_errors(document, repo_root))
    if CP7_BINDING_COMMIT is None:
        changed_paths = (
            set()
            if evaluated_commit == head
            else _git_changed_paths(repo_root, evaluated_commit, head)
        )
        unexpected_paths = changed_paths - CP7_BINDING_DIFF_ALLOWED_PATHS
        if unexpected_paths:
            errors.append(
                "CP7 post-evaluation drift содержит запрещённые пути: "
                + ", ".join(sorted(unexpected_paths))
            )
    else:
        binding_paths = _git_changed_paths(
            repo_root,
            evaluated_commit,
            CP7_BINDING_COMMIT,
        )
        if binding_paths != CP7_BINDING_DIFF_ALLOWED_PATHS:
            errors.append(
                "CP7 binding diff должен содержать только EVAL_RESULT.json; "
                "фактически: "
                + ", ".join(sorted(binding_paths))
            )
        if (
            DEPLOYMENT_BINDING_COMMIT is None
            or not _git_commit_exists(repo_root, DEPLOYMENT_BINDING_COMMIT)
        ):
            errors.append("deployment binding commit недоступен")
        elif not _git_is_ancestor(
            repo_root,
            evaluated_commit,
            CP7_BINDING_COMMIT,
        ):
            errors.append(
                "CP7 evaluated_commit не является предком CP7 binding commit"
            )
        elif not _git_is_ancestor(
            repo_root,
            CP7_BINDING_COMMIT,
            DEPLOYMENT_BINDING_COMMIT,
        ):
            errors.append(
                "CP7 binding commit не является предком deployment binding commit"
            )
        elif not _git_is_ancestor(
            repo_root,
            DEPLOYMENT_BINDING_COMMIT,
            head,
        ):
            errors.append(
                "deployment binding commit не является предком текущего HEAD"
            )
        else:
            post_deployment_paths = _git_changed_paths(
                repo_root,
                DEPLOYMENT_BINDING_COMMIT,
                head,
            )
            unexpected_paths = (
                post_deployment_paths - POST_DEPLOYMENT_EVIDENCE_ALLOWED_PATHS
            )
            if unexpected_paths:
                errors.append(
                    "CP7 post-deployment drift содержит запрещённые пути: "
                    + ", ".join(sorted(unexpected_paths))
                )
    if require_cp7_binding:
        errors.extend(_cp7_binding_subtree_errors(document, repo_root))
    return errors


def _checkpoint_evidence_errors(
    document: Mapping[str, Any],
    checkpoint: str,
    repo_root: Path | None = None,
    *,
    allow_unbound_cp7: bool = False,
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
    if checkpoint == "CP5":
        errors = _cp5_schema_errors(document)
        if repo_root is not None and not errors:
            errors.extend(_cp5_git_errors(document, repo_root))
        return errors
    if checkpoint == "CP6":
        errors = _cp6_schema_errors(document)
        if repo_root is not None and not errors:
            errors.extend(_cp6_git_errors(document, repo_root))
        return errors
    if checkpoint == "CP7":
        errors = _cp7_schema_errors(document)
        if repo_root is not None and not errors:
            errors.extend(cp7_ux_evidence_errors(document, repo_root))
            errors.extend(cp7_operations_evidence_errors(document, repo_root))
            errors.extend(
                _cp7_git_errors(
                    document,
                    repo_root,
                    require_cp7_binding=not allow_unbound_cp7,
                )
            )
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
    failed_gates = document.get("failed_gates")
    legacy_findings = document.get("legacy_findings")
    operations_findings = document.get("operations_findings")

    external_demo_passed = (
        repo_root is not None
        and not _external_demo_final_errors(document, repo_root)
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
        if repo_root is not None:
            errors.extend(_external_demo_final_errors(document, repo_root))
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


def _run_cp5_commands(
    repo_root: Path,
    evaluated_commit: str,
    command_executor: CommandExecutor,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for command_id, command in CP5_REQUIRED_COMMANDS.items():
        if _git_head(repo_root) != evaluated_commit:
            raise ValueError(f"HEAD изменился до команды CP5 {command_id}")
        dirty_before = _git_dirty_paths(repo_root)
        if dirty_before:
            raise ValueError(
                f"дерево исходников загрязнено до команды CP5 {command_id}: "
                + ", ".join(sorted(dirty_before))
            )

        command_spec: dict[str, object] = {"id": command_id, "command": command}
        print(f"Старт команды CP5: {command_id}", flush=True)
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
            raise ValueError(f"HEAD изменился после команды CP5 {command_id}")
        dirty_after = _git_dirty_paths(repo_root)
        if dirty_after:
            raise ValueError(
                f"каноническая команда CP5 {command_id} изменила дерево исходников: "
                + ", ".join(sorted(dirty_after))
            )

        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        result = _command_result_record(
            command_id=command_id,
            command=command,
            completed=completed,
            evaluated_commit=evaluated_commit,
            duration_ms=duration_ms,
            count_patterns=CP5_COMMAND_COUNT_PATTERNS,
            expected_exit_code=0,
        )
        results.append(result)
        print(
            f"Команда CP5 завершена: {command_id}; код={completed.returncode}; "
            f"количество={result['count']}",
            flush=True,
        )
    return results


def _run_cp6_commands(
    repo_root: Path,
    evaluated_commit: str,
    command_executor: CommandExecutor,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for command_id, command in CP6_REQUIRED_COMMANDS.items():
        if _git_head(repo_root) != evaluated_commit:
            raise ValueError(f"HEAD изменился до команды CP6 {command_id}")
        dirty_before = _git_dirty_paths(repo_root)
        if dirty_before:
            raise ValueError(
                f"дерево исходников загрязнено до команды CP6 {command_id}: "
                + ", ".join(sorted(dirty_before))
            )

        command_spec: dict[str, object] = {"id": command_id, "command": command}
        print(f"Старт команды CP6: {command_id}", flush=True)
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
            raise ValueError(f"HEAD изменился после команды CP6 {command_id}")
        dirty_after = _git_dirty_paths(repo_root)
        if dirty_after:
            raise ValueError(
                f"каноническая команда CP6 {command_id} изменила дерево исходников: "
                + ", ".join(sorted(dirty_after))
            )

        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        result = _command_result_record(
            command_id=command_id,
            command=command,
            completed=completed,
            evaluated_commit=evaluated_commit,
            duration_ms=duration_ms,
            count_patterns=CP6_COMMAND_COUNT_PATTERNS,
            expected_exit_code=0,
        )
        results.append(result)
        print(
            f"Команда CP6 завершена: {command_id}; код={completed.returncode}; "
            f"количество={result['count']}",
            flush=True,
        )
    return results


def _cp7_backend_temp_root(evaluated_commit: str) -> Path:
    if not SHA_RE.fullmatch(evaluated_commit):
        raise ValueError("CP7 backend temp root требует полный Git SHA")
    return Path(f"/tmp/newscast-product-reset-cp7-backend-{evaluated_commit}")


def _cp7_frontend_temp_root(evaluated_commit: str) -> Path:
    if not SHA_RE.fullmatch(evaluated_commit):
        raise ValueError("CP7 frontend temp root требует полный Git SHA")
    return Path(f"/tmp/newscast-product-reset-cp7-frontend-{evaluated_commit}")


def _run_cp7_commands_unmanaged(
    repo_root: Path,
    evaluated_commit: str,
    command_executor: CommandExecutor,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for command_id, command in CP7_REQUIRED_COMMANDS.items():
        if _git_head(repo_root) != evaluated_commit:
            raise ValueError(f"HEAD изменился до команды CP7 {command_id}")
        dirty_before = _git_dirty_paths(repo_root)
        if dirty_before:
            raise ValueError(
                f"дерево исходников загрязнено до команды CP7 {command_id}: "
                + ", ".join(sorted(dirty_before))
            )

        command_spec: dict[str, object] = {"id": command_id, "command": command}
        print(f"Старт команды CP7: {command_id}", flush=True)
        started = time.monotonic()
        try:
            completed = command_executor(repo_root, command_spec)
        except Exception as exc:  # pragma: no cover - defensive process boundary
            completed = subprocess.CompletedProcess(
                ["/bin/sh", "-lc", command],
                125,
                stdout="",
                stderr=f"ошибка запуска команды: {type(exc).__name__}",
            )
        if _git_head(repo_root) != evaluated_commit:
            raise ValueError(f"HEAD изменился после команды CP7 {command_id}")
        dirty_after = _git_dirty_paths(repo_root)
        if dirty_after:
            raise ValueError(
                f"каноническая команда CP7 {command_id} изменила дерево исходников: "
                + ", ".join(sorted(dirty_after))
            )
        duration_ms = max(0, int((time.monotonic() - started) * 1000))
        result = _command_result_record(
            command_id=command_id,
            command=command,
            completed=completed,
            evaluated_commit=evaluated_commit,
            duration_ms=duration_ms,
            count_patterns=CP7_COMMAND_COUNT_PATTERNS,
            expected_exit_code=0,
        )
        results.append(result)
        print(
            f"Команда CP7 завершена: {command_id}; код={completed.returncode}; "
            f"количество={result['count']}",
            flush=True,
        )
    return results


def _run_cp7_commands(
    repo_root: Path,
    evaluated_commit: str,
    command_executor: CommandExecutor,
) -> list[dict[str, Any]]:
    backend_root = _cp7_backend_temp_root(evaluated_commit)
    frontend_root = _cp7_frontend_temp_root(evaluated_commit)
    try:
        return _run_cp7_commands_unmanaged(
            repo_root,
            evaluated_commit,
            command_executor,
        )
    finally:
        shutil.rmtree(backend_root, ignore_errors=True)
        shutil.rmtree(frontend_root, ignore_errors=True)


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


def _sync_cp7_local_state(
    document: dict[str, Any],
    *,
    evidence_errors: list[str],
) -> None:
    local_passed = not evidence_errors
    document["local_hard_gates_passed"] = local_passed
    document["hard_gates_passed"] = False
    document["full_eval_passed"] = False
    if local_passed:
        document["operations_findings"] = []


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

        if checkpoint == "CP5":
            template_errors = _cp5_schema_errors(document, validate_command_results=False)
            if template_errors:
                raise ValueError("Шаблон evidence CP5 невалиден: " + "; ".join(template_errors))
            evidence = checkpoint_result.get("evidence")
            if not isinstance(evidence, dict):
                raise ValueError("checkpoint_results.CP5.evidence должен быть JSON-объектом")
            evidence["commands"] = _run_cp5_commands(
                repo_root,
                str(document["commit"]),
                command_executor or _default_command_executor,
            )

        if checkpoint == "CP6":
            template_errors = _cp6_schema_errors(document, validate_command_results=False)
            if template_errors:
                raise ValueError("Шаблон evidence CP6 невалиден: " + "; ".join(template_errors))
            evidence = checkpoint_result.get("evidence")
            if not isinstance(evidence, dict):
                raise ValueError("checkpoint_results.CP6.evidence должен быть JSON-объектом")
            evidence["commands"] = _run_cp6_commands(
                repo_root,
                str(document["commit"]),
                command_executor or _default_command_executor,
            )

        if checkpoint == "CP7":
            template_errors = _cp7_schema_errors(
                document,
                validate_command_results=False,
            )
            if template_errors:
                raise ValueError("Шаблон evidence CP7 невалиден: " + "; ".join(template_errors))
            evidence = checkpoint_result.get("evidence")
            if not isinstance(evidence, dict):
                raise ValueError("checkpoint_results.CP7.evidence должен быть JSON-объектом")
            ux_document = load_ux_eval_evidence(
                repo_root,
                require_artifacts=True,
            )
            categories = ux_document.get("categories")
            if not isinstance(categories, dict):
                raise ValueError("UX evidence categories должен быть JSON-объектом")
            document["ux_categories"] = {
                category_id: category.get("score")
                for category_id, category in categories.items()
                if isinstance(category, dict)
            }
            document["ux_total"] = ux_document.get("ux_total")
            evidence["ux_manifest"] = build_cp7_ux_manifest(
                repo_root,
                evaluated_commit=str(document["commit"]),
            )
            evidence["commands"] = _run_cp7_commands(
                repo_root,
                str(document["commit"]),
                command_executor or _default_command_executor,
            )
            try:
                evidence["operations_run"] = load_cp7_operations_evidence(
                    repo_root,
                    evaluated_commit=str(document["commit"]),
                    check_cleanup=True,
                )
            except ValueError:
                evidence["operations_run"] = None
            document["external_demo"] = {
                "permission_status": "not_granted",
                "status": "blocked_permission",
                "app_sha": None,
            }
            document["local_hard_gates_passed"] = True
            document["hard_gates_passed"] = False
            document["full_eval_passed"] = False
            _sync_failed_gate(document, "CP7", failed=False)

        evidence_errors = _checkpoint_evidence_errors(
            document,
            checkpoint,
            repo_root,
            allow_unbound_cp7=checkpoint == "CP7",
        )
        checkpoint_result["passed"] = not evidence_errors
        checkpoint_result["missing"] = evidence_errors
        if checkpoint == "CP7":
            _sync_cp7_local_state(document, evidence_errors=evidence_errors)
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
