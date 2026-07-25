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

CP4_EXPECTED_COMMANDS = {
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
CP4_UNSTABILIZED_FRONTEND_COMMAND = "cd frontend && npm test -- --run"
CP4_STABLE_FRONTEND_COMMAND_SHA256 = (
    "24f762722b0ba51050e8f386e33881718be6ac7f413bc537d7ec8155765550e7"
)

HISTORICAL_BINDING_COMMITS = {
    "CP1": "57743e197f7c4c8a420673842d67e048c90d63c9",
    "CP2": "ec630cdddcd0e1cdbbde4eca696576636ff22a9a",
    "CP3": "82f5eaa793bf9d90d02997ba43a1742711d4a7fc",
    "CP4": "7643becabadf38e1d26b40bbbe417865c9c29e28",
    "CP5": "f87638588fdd606add683593f340378f5b1c3961",
    "CP6": "837e0117c01e473c93f0469df4847e858f2654b5",
}
HISTORICAL_EVALUATED_COMMITS = {
    "CP1": "ee8efc5b04ebe3672f71f0c6c287ee634d994910",
    "CP2": "60c8f6721bcd3053c11fa2eb2316c8d8e94616fa",
    "CP3": "f867c470e917868e4b039d1d247ba61e8b79b791",
    "CP4": "5b25658f84e5b94c267ef59f3bfa2c9552fa04dd",
    "CP5": "38d01309eba9e9ffbe14fcf91ede785819f9b6fb",
    "CP6": "1d97ecc18662f5530870e24aff4126f94b2bc4cc",
}
CP4_BINDING_COMMIT = "7643becabadf38e1d26b40bbbe417865c9c29e28"
CP5_BINDING_COMMIT = "f87638588fdd606add683593f340378f5b1c3961"
CP6_BINDING_COMMIT = "837e0117c01e473c93f0469df4847e858f2654b5"

CP5_EXPECTED_COMMANDS = {
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

CP5_EXPECTED_EVIDENCE = {
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

CP6_EXPECTED_COMMANDS = {
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

CP6_EXPECTED_EVIDENCE = {
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

CP4_EXPECTED_EVIDENCE = {
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


def _valid_cp4_evidence(evaluated_commit: str) -> dict[str, object]:
    evidence = copy.deepcopy(CP4_EXPECTED_EVIDENCE)
    evidence["schema_version"] = 1
    evidence["commands"] = [
        {
            "id": command_id,
            "command": command,
            "expected_exit_code": 1 if command_id == "frontend-production-denylist" else 0,
            "exit_code": 1 if command_id == "frontend-production-denylist" else 0,
            "count": 0 if command_id == "frontend-production-denylist" else 1,
            "outcome": "automated_pass",
            "reproducibility": {
                "runner": "product_reset_eval.py",
                "evaluated_commit": evaluated_commit,
                "command_sha256": eval_service._sha256_text(command),
                "output_sha256": "0" * 64,
                "summary": (
                    "ожидаемый_код_выхода=1; количество=0"
                    if command_id == "frontend-production-denylist"
                    else "успешно; количество=1"
                ),
                "duration_ms": 0,
            },
        }
        for command_id, command in CP4_EXPECTED_COMMANDS.items()
    ]
    return {"schema_version": evidence.pop("schema_version"), **evidence}


def _cp4_checkpoint_result(*, evaluated_commit: str) -> dict[str, object]:
    result = _cp3_checkpoint_result(evaluated_commit="b" * 40)
    result["commit"] = evaluated_commit
    result["checkpoint"] = "CP4"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3", "CP4"]
    result["failed_gates"] = ["CP5", "CP6", "CP7", "external_demo"]
    result["checkpoint_results"]["CP4"] = {
        "passed": True,
        "missing": [],
        "evaluated_commit": evaluated_commit,
        "evidence": _valid_cp4_evidence(evaluated_commit),
    }
    return result


def _actual_bound_cp4_result(repo_root: Path) -> dict[str, object]:
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    evaluated_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    result["commit"] = evaluated_commit
    result["checkpoint"] = "CP4"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3", "CP4"]
    result["failed_gates"] = ["CP5", "CP6", "CP7", "external_demo"]
    result["checkpoint_results"]["CP4"] = {
        "passed": True,
        "missing": [],
        "evaluated_commit": evaluated_commit,
        "evidence": _valid_cp4_evidence(evaluated_commit),
    }
    return result


def _cp4_source_template_result(repo_root: Path) -> dict[str, object]:
    """Reconstruct the pre-binding CP4 template from the tracked bound document."""
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    cp3_commit = result["checkpoint_results"]["CP3"]["evaluated_commit"]
    result["commit"] = cp3_commit
    result["checkpoint"] = "CP3"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3"]
    result["failed_gates"] = ["CP4", "CP5", "CP6", "CP7", "external_demo"]
    result["checkpoint_results"]["CP4"] = {
        "passed": False,
        "missing": ["command_evidence_pending"],
        "evaluated_commit": None,
        "evidence": {
            "schema_version": 1,
            **copy.deepcopy(CP4_EXPECTED_EVIDENCE),
            "commands": [],
        },
    }
    result["largest_remaining_risk"] = (
        "CP4 source/template ещё требует independent review и runner-owned binding; "
        "CP5–CP7, clean-deploy rehearsal и внешний demo gate остаются незавершёнными."
    )
    result["next_action"] = (
        "После independent review чистого source commit выполнить runner-owned CP4 "
        "boundary и записать отдельный binding commit."
    )
    return result


def _cp4_binding_subtree_errors(
    document: dict[str, object], repo_root: Path
) -> list[str]:
    if not eval_service._git_commit_exists(repo_root, CP4_BINDING_COMMIT):
        return [f"CP4 binding commit недоступен: {CP4_BINDING_COMMIT}"]

    serialized_binding = eval_service._git_file_at_commit(
        repo_root,
        CP4_BINDING_COMMIT,
        "docs/product-reset/EVAL_RESULT.json",
    )
    if serialized_binding is None:
        return [f"CP4 binding evidence недоступен в commit {CP4_BINDING_COMMIT}"]
    try:
        binding_document = json.loads(serialized_binding)
    except json.JSONDecodeError:
        return ["CP4 binding evidence содержит невалидный JSON"]
    if not isinstance(binding_document, dict):
        return ["CP4 binding evidence должен быть JSON-объектом"]

    binding_results = binding_document.get("checkpoint_results")
    pinned_result = (
        binding_results.get("CP4") if isinstance(binding_results, dict) else None
    )
    if not isinstance(pinned_result, dict):
        return ["CP4 subtree отсутствует в binding evidence"]

    checkpoint_results = document.get("checkpoint_results")
    current_result = (
        checkpoint_results.get("CP4") if isinstance(checkpoint_results, dict) else None
    )
    if not isinstance(current_result, dict):
        return ["CP4 subtree отсутствует в текущем eval result"]
    if current_result != pinned_result:
        return ["CP4 evidence не совпадает с exact binding subtree"]
    return []


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
    result["ux_categories"] = {
        category_id: 9 for category_id in eval_service.UX_CATEGORY_LABELS
    }
    result["ux_total"] = 91

    assert compute_full_eval_passed(result) is False


def test_ux_gate_rejects_unknown_categories_and_scores_above_ten() -> None:
    result = _checkpoint_only_result()
    result["ux_categories"] = {
        category_id: 9 for category_id in eval_service.UX_CATEGORY_LABELS
    }
    result["ux_total"] = 90
    assert eval_service._ux_gate_passed(result) is True

    result["ux_categories"]["unknown"] = result["ux_categories"].pop("overall_hierarchy")
    assert eval_service._ux_gate_passed(result) is False

    result["ux_categories"] = {
        category_id: 9 for category_id in eval_service.UX_CATEGORY_LABELS
    }
    result["ux_categories"]["overall_hierarchy"] = 11
    result["ux_total"] = 92
    assert eval_service._ux_gate_passed(result) is False


def test_cp7_ux_command_registry_matches_eval_commands_document() -> None:
    expected = {
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
    assert eval_service.CP7_UX_REQUIRED_COMMANDS == expected

    repo_root = Path(__file__).resolve().parents[2]
    document = json.loads(
        (repo_root / "docs/product-reset/EVAL_COMMANDS.json").read_text(encoding="utf-8")
    )
    records = {
        item["id"]: item
        for item in document["commands"]
        if item.get("execution_group") == "cp7_ux"
    }
    assert list(records) == list(expected)
    for command_id, command in expected.items():
        assert records[command_id] == {
            "id": command_id,
            "execution_group": "cp7_ux",
            "scope": "checkpoint",
            "checkpoint": "CP7",
            "command": command,
            "expected_exit_code": 0,
        }


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


def test_cp3_binding_is_structured_runner_owned_and_immutable() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    cp3 = result["checkpoint_results"]["CP3"]
    evaluated_commit = "f867c470e917868e4b039d1d247ba61e8b79b791"
    commands = cp3["evidence"]["commands"]

    assert cp3["passed"] is True
    assert cp3["evaluated_commit"] == evaluated_commit
    assert cp3["missing"] == []
    assert [
        (
            item["id"],
            item["count"],
            item["reproducibility"]["command_sha256"],
            item["reproducibility"]["output_sha256"],
        )
        for item in commands
    ] == [
        (
            "backend-full-suite",
            245,
            "b5b57c765bb0d58c78e4c1705d5f68aef1a54b03e30a3e1765aa60ae8c7b9298",
            "ee503ad9113a2ee67f9f643f392a7014b2dc86e6bf2f4d9bb65cc70dfdb871e7",
        ),
        (
            "frontend-full-suite",
            57,
            "dce8d5d0c97d93e6354e7b90f53186c13c41fa6a38984546d68619315c3e58dd",
            "6759b7980af50a29db0db90a68600873bb2bad2ab0f3bec4a3309e2346001751",
        ),
        (
            "frontend-production-build",
            127,
            "008af75026d284dc318e955d965f0d551d81673560186d65b79a4c97e91b2c43",
            "588b405c9a0940c76e6940a9ebb23f651a10c5b04b115f1abb824835b6876dd6",
        ),
        (
            "browser-scenario-history-chromium-1366",
            5,
            "b959a42d56581662487943b05284a6c197b06901d1c19309ac93d84282549ad4",
            "eb4683009a5f3bb49dc1bef59ed597b90ac1b4276710df046ebb1a5e89a640e9",
        ),
        (
            "browser-scenario-chromium-1920",
            3,
            "440cfd298071cb6508ab65184a023fa9e9523d4614cca9fc2e63b85f0026df91",
            "c3a55f2572ddeb7aa5b965c0e9005650728c52a493a67e06c0b494c094b718f3",
        ),
    ]
    assert all(item["exit_code"] == 0 for item in commands)
    assert all(item["outcome"] == "automated_pass" for item in commands)
    assert all(
        item["reproducibility"]["evaluated_commit"] == evaluated_commit
        for item in commands
    )
    assert eval_service._cp3_schema_errors(result) == []
    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP3",
        repo_root=repo_root,
    )
    assert verification.passed is True
    assert verification.errors == ()


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
    fixture = (repo_root / "frontend/e2e/fixtures/current-editor.ts").read_text(encoding="utf-8")
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
    assert 'testMatch: ["**/*.spec.ts"]' in config
    assert "fixtures/current-editor.ts" not in config
    assert 'test("' not in fixture
    assert "expect(" not in fixture
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


def test_cp4_source_template_has_exact_contract_and_remains_unbound() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp4_source_template_result(repo_root)

    cp4 = result["checkpoint_results"]["CP4"]
    assert cp4 == {
        "passed": False,
        "missing": ["command_evidence_pending"],
        "evaluated_commit": None,
        "evidence": {
            "schema_version": 1,
            **CP4_EXPECTED_EVIDENCE,
            "commands": [],
        },
    }
    assert result["checkpoint"] == "CP3"
    assert result["completed_checkpoints"] == ["CP1", "CP2", "CP3"]
    assert "CP4" in result["failed_gates"]
    assert result["local_hard_gates_passed"] is False
    assert result["hard_gates_passed"] is False
    assert result["full_eval_passed"] is False
    assert "independent review" in result["largest_remaining_risk"]
    assert "runner-owned CP4" in result["next_action"]


def test_tracked_eval_result_preserves_bound_historical_cp4_subtree() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    evaluated_commit = "5b25658f84e5b94c267ef59f3bfa2c9552fa04dd"
    cp4 = result["checkpoint_results"]["CP4"]

    assert CP4_BINDING_COMMIT == "7643becabadf38e1d26b40bbbe417865c9c29e28"
    assert cp4["passed"] is True
    assert cp4["missing"] == []
    assert cp4["evaluated_commit"] == evaluated_commit
    assert [
        (item["id"], item["count"], item["exit_code"])
        for item in cp4["evidence"]["commands"]
    ] == [
        ("backend-full-suite", 378, 0),
        ("frontend-full-suite", 87, 0),
        ("frontend-production-build", 136, 0),
        ("browser-production-chromium-1366", 4, 0),
        ("frontend-production-denylist", 0, 1),
    ]
    assert all(
        item["reproducibility"]["evaluated_commit"] == evaluated_commit
        for item in cp4["evidence"]["commands"]
    )
    assert _cp4_binding_subtree_errors(result, repo_root) == []

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP4",
        repo_root=repo_root,
    )
    assert verification.passed is True
    assert verification.errors == ()


@pytest.mark.parametrize("field", ["output_sha256", "summary", "duration_ms"])
def test_cp4_binding_regression_rejects_valid_format_command_metadata_drift(
    field: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    command = result["checkpoint_results"]["CP4"]["evidence"]["commands"][0]
    if field == "output_sha256":
        command["reproducibility"][field] = "f" * 64
    elif field == "summary":
        command["reproducibility"][field] = "успешно; количество=379"
    else:
        command["reproducibility"][field] += 1

    assert eval_service._cp4_schema_errors(result) == []
    assert _cp4_binding_subtree_errors(result, repo_root) == [
        "CP4 evidence не совпадает с exact binding subtree"
    ]


@pytest.mark.parametrize(
    ("unavailable", "expected_error"),
    [
        ("binding_commit", "CP4 binding commit недоступен"),
        ("binding_blob", "CP4 binding evidence недоступен"),
        ("invalid_json", "CP4 binding evidence содержит невалидный JSON"),
        ("missing_subtree", "CP4 subtree отсутствует в binding evidence"),
    ],
)
def test_cp4_binding_regression_fails_closed_when_pinned_evidence_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    unavailable: str,
    expected_error: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    if unavailable == "binding_commit":
        monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: False)
    elif unavailable == "binding_blob":
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: None)
    elif unavailable == "invalid_json":
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: "{")
    else:
        monkeypatch.setattr(
            eval_service,
            "_git_file_at_commit",
            lambda *_args: json.dumps({"checkpoint_results": {}}),
        )

    errors = _cp4_binding_subtree_errors(result, repo_root)

    assert any(expected_error in error for error in errors)


@pytest.mark.parametrize("section", list(CP4_EXPECTED_EVIDENCE))
def test_cp4_verification_rejects_mutation_in_every_contract_section(section: str) -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    result["checkpoint_results"]["CP4"]["evidence"][section] = {
        **CP4_EXPECTED_EVIDENCE[section],
        "unexpected": True,
    }

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")

    assert verification.passed is False
    assert any(section in error for error in verification.errors)


@pytest.mark.parametrize(
    ("field", "identifier"),
    [
        *(
            ("transition_ids", identifier)
            for identifier in CP4_EXPECTED_EVIDENCE["production_workflow"]["transition_ids"]
        ),
        *(
            ("gate_ids", identifier)
            for identifier in CP4_EXPECTED_EVIDENCE["production_workflow"]["gate_ids"]
        ),
    ],
)
def test_cp4_verification_rejects_each_mutated_transition_and_gate_identifier(
    field: str,
    identifier: str,
) -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    identifiers = result["checkpoint_results"]["CP4"]["evidence"][
        "production_workflow"
    ][field]
    identifiers[identifiers.index(identifier)] = f"mutated_{identifier}"

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")

    assert verification.passed is False
    assert any("production_workflow" in error for error in verification.errors)


def test_cp4_verification_rejects_extra_top_level_evidence_key() -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    result["checkpoint_results"]["CP4"]["evidence"]["unexpected"] = True

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")

    assert verification.passed is False
    assert any("точный структурированный contract" in error for error in verification.errors)


def test_cp4_verification_rejects_boolean_schema_version() -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    result["checkpoint_results"]["CP4"]["evidence"]["schema_version"] = True

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")

    assert verification.passed is False
    assert any("schema_version" in error for error in verification.errors)


@pytest.mark.parametrize(
    ("section", "field", "numeric_value"),
    [
        ("revision_and_read_markers", "current_scenario_revision_binding", 1),
        ("server_read_model", "one_primary_action", 1),
        ("frontend_production", "frontend_gate_status_calculator", 0),
    ],
)
def test_cp4_verification_requires_exact_boolean_types(
    section: str,
    field: str,
    numeric_value: int,
) -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    result["checkpoint_results"]["CP4"]["evidence"][section][field] = numeric_value

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")

    assert verification.passed is False
    assert any(section in error for error in verification.errors)


@pytest.mark.parametrize(
    ("command_id", "output", "exit_code", "expected_count"),
    [
        ("backend-full-suite", "301 passed, 2 skipped", 0, 301),
        ("frontend-full-suite", "Tests 81 passed", 0, 81),
        ("frontend-production-build", "134 modules transformed", 0, 134),
        ("browser-production-chromium-1366", "4 passed", 0, 4),
        (
            "frontend-production-denylist",
            "frontend/src/a.ts:1:buildProductionGates\nfrontend/src/b.ts:2:_requires_resync",
            0,
            2,
        ),
        ("frontend-production-denylist", "", 1, 0),
    ],
)
def test_cp4_command_registry_order_and_deterministic_count_parsers(
    command_id: str,
    output: str,
    exit_code: int,
    expected_count: int,
) -> None:
    assert eval_service.CP4_REQUIRED_COMMANDS == CP4_EXPECTED_COMMANDS
    assert list(eval_service.CP4_REQUIRED_COMMANDS) == list(CP4_EXPECTED_COMMANDS)
    assert eval_service._command_count(
        command_id,
        output,
        exit_code,
        eval_service.CP4_COMMAND_COUNT_PATTERNS,
    ) == expected_count


def test_cp4_frontend_full_suite_stabilizes_node_runtime_without_filtering_vitest() -> None:
    command = CP4_EXPECTED_COMMANDS["frontend-full-suite"]

    assert command == (
        "cd frontend && NODE_OPTIONS=--no-experimental-webstorage npm test -- --run"
    )
    assert eval_service.CP4_REQUIRED_COMMANDS["frontend-full-suite"] == command
    assert command.endswith("npm test -- --run")
    assert all(
        filter_marker not in command
        for filter_marker in ("--project", "--testNamePattern", ".test.", ".spec.")
    )
    assert eval_service._sha256_text(command) == CP4_STABLE_FRONTEND_COMMAND_SHA256
    assert eval_service._command_count(
        "frontend-full-suite",
        "Test Files 26 passed\nTests 87 passed",
        0,
        eval_service.CP4_COMMAND_COUNT_PATTERNS,
    ) == 87


def test_cp4_verification_rejects_unstabilized_frontend_full_suite_command() -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    record = next(
        item
        for item in result["checkpoint_results"]["CP4"]["evidence"]["commands"]
        if item["id"] == "frontend-full-suite"
    )
    record["command"] = CP4_UNSTABILIZED_FRONTEND_COMMAND
    record["reproducibility"]["command_sha256"] = eval_service._sha256_text(
        CP4_UNSTABILIZED_FRONTEND_COMMAND
    )

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")

    assert verification.passed is False
    assert any(
        "frontend-full-suite не совпадает с contract" in error
        for error in verification.errors
    )


@pytest.mark.parametrize(
    ("exit_code", "output", "expected_outcome", "expected_count"),
    [
        (1, "", "automated_pass", 0),
        (
            1,
            "frontend/src/a.ts:1:buildProductionGates",
            "automated_failure",
            1,
        ),
        (0, "frontend/src/a.ts:1:buildProductionGates", "automated_failure", 1),
        (2, "rg: error", "automated_failure", 0),
    ],
)
def test_cp4_denylist_expected_exit_contract_is_recorded_without_weakening_success_rules(
    exit_code: int,
    output: str,
    expected_outcome: str,
    expected_count: int,
) -> None:
    command_id = "frontend-production-denylist"
    command = CP4_EXPECTED_COMMANDS[command_id]
    record = eval_service._command_result_record(
        command_id=command_id,
        command=command,
        completed=subprocess.CompletedProcess(["rg"], exit_code, stdout=output, stderr=""),
        evaluated_commit="c" * 40,
        duration_ms=1,
        count_patterns=eval_service.CP4_COMMAND_COUNT_PATTERNS,
        expected_exit_code=1,
        count_rule="zero",
    )

    assert record["expected_exit_code"] == 1
    assert record["exit_code"] == exit_code
    assert record["count"] == expected_count
    assert record["outcome"] == expected_outcome


@pytest.mark.parametrize(
    ("mutation", "expected_error"),
    [
        ("missing_record_key", "точные поля"),
        ("extra_record_key", "точные поля"),
        ("duplicate_command_id", "уникальными"),
        ("unknown_command_id", "неизвестный command ID"),
        ("wrong_order", "точном порядке"),
        ("wrong_command", "не совпадает с contract"),
        ("wrong_expected_exit", "expected_exit_code"),
        ("bool_expected_exit", "expected_exit_code"),
        ("bool_exit", "exit_code должен быть целым"),
        ("bool_count", "count должен быть неотрицательным"),
        ("wrong_commit_binding", "метаданные воспроизводимости"),
        ("bad_output_hash", "метаданные воспроизводимости"),
        ("empty_summary", "метаданные воспроизводимости"),
        ("bool_duration", "метаданные воспроизводимости"),
    ],
)
def test_cp4_verification_rejects_malformed_or_unowned_command_records(
    mutation: str,
    expected_error: str,
) -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    commands = result["checkpoint_results"]["CP4"]["evidence"]["commands"]

    if mutation == "missing_record_key":
        commands[0].pop("count")
    elif mutation == "extra_record_key":
        commands[0]["unexpected"] = True
    elif mutation == "duplicate_command_id":
        commands[1]["id"] = commands[0]["id"]
    elif mutation == "unknown_command_id":
        commands[0]["id"] = "unknown"
    elif mutation == "wrong_order":
        commands[0], commands[1] = commands[1], commands[0]
    elif mutation == "wrong_command":
        commands[0]["command"] = "cd backend && pytest"
    elif mutation == "wrong_expected_exit":
        commands[-1]["expected_exit_code"] = 0
    elif mutation == "bool_expected_exit":
        commands[-1]["expected_exit_code"] = True
    elif mutation == "bool_exit":
        commands[0]["exit_code"] = True
    elif mutation == "bool_count":
        commands[0]["count"] = True
    elif mutation == "wrong_commit_binding":
        commands[0]["reproducibility"]["evaluated_commit"] = "d" * 40
    elif mutation == "bad_output_hash":
        commands[0]["reproducibility"]["output_sha256"] = "not-a-hash"
    elif mutation == "empty_summary":
        commands[0]["reproducibility"]["summary"] = ""
    elif mutation == "bool_duration":
        commands[0]["reproducibility"]["duration_ms"] = True

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")

    assert verification.passed is False
    assert any(expected_error in error for error in verification.errors)


@pytest.mark.parametrize("invalid_id", [[], {}, None, 7])
def test_cp4_verification_handles_non_string_command_ids_without_exception(
    invalid_id: object,
) -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    result["checkpoint_results"]["CP4"]["evidence"]["commands"][0]["id"] = invalid_id

    try:
        verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")
    except (TypeError, KeyError) as exc:
        pytest.fail(f"malformed command ID escaped controlled verification: {exc}")

    assert verification.passed is False
    assert any("command ID" in error for error in verification.errors)


@pytest.mark.parametrize(
    ("command_id", "exit_code", "count", "expected_error"),
    [
        ("backend-full-suite", 1, 0, "backend-full-suite"),
        ("frontend-full-suite", 0, 0, "frontend-full-suite"),
        ("frontend-production-denylist", 1, 1, "frontend-production-denylist"),
        ("frontend-production-denylist", 0, 1, "frontend-production-denylist"),
        ("frontend-production-denylist", 2, 0, "frontend-production-denylist"),
    ],
)
def test_cp4_verification_rejects_failed_command_semantics(
    command_id: str,
    exit_code: int,
    count: int,
    expected_error: str,
) -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    record = next(
        item
        for item in result["checkpoint_results"]["CP4"]["evidence"]["commands"]
        if item["id"] == command_id
    )
    record["exit_code"] = exit_code
    record["count"] = count
    record["outcome"] = "automated_failure"

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP4")

    assert verification.passed is False
    assert any(expected_error in error for error in verification.errors)


def test_cp4_historical_binding_registry_pins_binding_and_evaluated_commits() -> None:
    assert eval_service.HISTORICAL_CHECKPOINT_BINDING_COMMITS == HISTORICAL_BINDING_COMMITS
    assert eval_service.HISTORICAL_CHECKPOINT_EVALUATED_COMMITS == HISTORICAL_EVALUATED_COMMITS
    assert HISTORICAL_BINDING_COMMITS["CP3"] != HISTORICAL_EVALUATED_COMMITS["CP3"]


@pytest.mark.parametrize(
    "mutation",
    [
        "output_sha256",
        "count",
        "summary",
        "duration_ms",
        "evidence_field",
        "evaluated_commit",
    ],
)
def test_cp4_pinned_historical_binding_rejects_mutable_evidence_fields(
    mutation: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    for checkpoint in ("CP1", "CP2", "CP3"):
        result = _actual_bound_cp4_result(repo_root)
        checkpoint_result = result["checkpoint_results"][checkpoint]
        command = checkpoint_result["evidence"]["commands"][0]

        if mutation == "output_sha256":
            command["reproducibility"]["output_sha256"] = "f" * 64
        elif mutation == "count":
            command["count"] += 1
        elif mutation == "summary":
            command["reproducibility"]["summary"] = "изменено после binding"
        elif mutation == "duration_ms":
            command["reproducibility"]["duration_ms"] += 1
        elif mutation == "evidence_field":
            checkpoint_result["evidence"]["schema_version"] = 2
        elif mutation == "evaluated_commit":
            checkpoint_result["evaluated_commit"] = "a" * 40

        errors = eval_service._historical_checkpoint_binding_errors(result, repo_root)

        assert any(
            f"{checkpoint} evidence не совпадает с pinned binding" in error
            or f"{checkpoint}.evaluated_commit" in error
            for error in errors
        )


def test_cp4_verification_rejects_real_mutated_historical_subtree() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _actual_bound_cp4_result(repo_root)
    result["checkpoint_results"]["CP2"]["evidence"]["commands"][0][
        "reproducibility"
    ]["output_sha256"] = "f" * 64

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP4",
        repo_root=repo_root,
    )

    assert verification.passed is False
    assert any("CP2 evidence не совпадает с pinned binding" in error for error in verification.errors)


@pytest.mark.parametrize("unavailable", ["binding_commit", "binding_blob"])
def test_cp4_pinned_historical_binding_fails_closed_when_git_evidence_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    unavailable: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _actual_bound_cp4_result(repo_root)

    if unavailable == "binding_commit":
        original_commit_exists = eval_service._git_commit_exists
        monkeypatch.setattr(
            eval_service,
            "_git_commit_exists",
            lambda root, sha: False
            if sha == HISTORICAL_BINDING_COMMITS["CP2"]
            else original_commit_exists(root, sha),
        )
    else:
        original_file_at_commit = eval_service._git_file_at_commit
        monkeypatch.setattr(
            eval_service,
            "_git_file_at_commit",
            lambda root, commit, path: None
            if commit == HISTORICAL_BINDING_COMMITS["CP2"]
            else original_file_at_commit(root, commit, path),
        )

    errors = eval_service._historical_checkpoint_binding_errors(result, repo_root)

    assert any("CP2 pinned binding" in error and "недоступ" in error for error in errors)


def test_cp4_git_contract_uses_cp4_tree_and_revalidates_historical_cp1_through_cp3(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cp3_commit = "b" * 40
    cp4_commit = "c" * 40
    result = _cp4_checkpoint_result(evaluated_commit=cp4_commit)
    result["checkpoint_results"]["CP3"]["evaluated_commit"] = cp3_commit
    checked_paths: list[tuple[str, str]] = []
    historical_checks: list[str] = []
    historical_binding_checks: list[tuple[str, ...]] = []
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "d" * 40)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(eval_service, "_git_is_ancestor", lambda *args: True)
    monkeypatch.setattr(
        eval_service,
        "_historical_checkpoint_binding_errors",
        lambda document, repo_root, checkpoints=None: (
            historical_binding_checks.append(tuple(checkpoints or ())) or []
        ),
    )
    for checkpoint in ("cp1", "cp2", "cp3"):
        monkeypatch.setattr(
            eval_service,
            f"_{checkpoint}_schema_errors",
            lambda document: [],
        )
        monkeypatch.setattr(
            eval_service,
            f"_{checkpoint}_git_errors",
            lambda document, repo_root, name=checkpoint.upper(): (
                historical_checks.append(name) or []
            ),
        )

    def path_exists(repo_root: Path, commit: str, path: str) -> bool:
        checked_paths.append((commit, path))
        return True

    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", path_exists)

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP4",
        repo_root=tmp_path,
    )

    assert verification.passed is True
    assert historical_binding_checks == [("CP1", "CP2", "CP3")]
    assert historical_checks[-3:] == ["CP1", "CP2", "CP3"]
    assert checked_paths
    paths_checked_at_cp4 = {
        path
        for commit, path in checked_paths
        if commit == cp4_commit and path in eval_service.CP4_REFERENCED_FILES
    }
    assert paths_checked_at_cp4 == set(eval_service.CP4_REFERENCED_FILES)


@pytest.mark.parametrize("checkpoint", ["CP1", "CP2", "CP3"])
def test_cp4_git_contract_rejects_mutated_historical_checkpoint_evidence(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    checkpoint: str,
) -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "d" * 40)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(eval_service, "_git_is_ancestor", lambda *args: True)
    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", lambda *args: True)
    for historical in ("cp1", "cp2", "cp3"):
        monkeypatch.setattr(
            eval_service,
            f"_{historical}_schema_errors",
            lambda document, name=historical.upper(): (
                ["mutated"] if name == checkpoint else []
            ),
        )
        monkeypatch.setattr(
            eval_service,
            f"_{historical}_git_errors",
            lambda document, repo_root: [],
        )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP4",
        repo_root=tmp_path,
    )

    assert verification.passed is False
    assert f"Историческая {checkpoint} evidence: mutated" in verification.errors


@pytest.mark.parametrize("failure", ["missing_commit", "wrong_ancestry", "missing_path"])
def test_cp4_git_contract_rejects_missing_objects_wrong_ancestry_and_wrong_tree(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    cp3_commit = "b" * 40
    cp4_commit = "c" * 40
    result = _cp4_checkpoint_result(evaluated_commit=cp4_commit)
    result["checkpoint_results"]["CP3"]["evaluated_commit"] = cp3_commit
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "d" * 40)
    monkeypatch.setattr(
        eval_service,
        "_git_commit_exists",
        lambda repo_root, sha: not (failure == "missing_commit" and sha == cp4_commit),
    )
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda repo_root, ancestor, descendant: not (
            failure == "wrong_ancestry"
            and ancestor == cp3_commit
            and descendant == cp4_commit
        ),
    )
    for checkpoint in ("cp1", "cp2", "cp3"):
        monkeypatch.setattr(
            eval_service,
            f"_{checkpoint}_schema_errors",
            lambda document: [],
        )
        monkeypatch.setattr(
            eval_service,
            f"_{checkpoint}_git_errors",
            lambda document, repo_root: [],
        )
    monkeypatch.setattr(
        eval_service,
        "_git_path_exists_at_commit",
        lambda repo_root, commit, path: not (
            failure == "missing_path"
            and commit == cp4_commit
            and path == eval_service.CP4_REFERENCED_FILES[0]
        ),
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP4",
        repo_root=tmp_path,
    )

    assert verification.passed is False


def _write_pending_cp4_result(tmp_path: Path) -> None:
    result = _cp4_checkpoint_result(evaluated_commit="c" * 40)
    result["commit"] = "b" * 40
    result["checkpoint"] = "CP3"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3"]
    result["failed_gates"] = ["CP4", "CP5", "CP6", "CP7", "external_demo"]
    cp4 = result["checkpoint_results"]["CP4"]
    cp4["passed"] = False
    cp4["missing"] = ["command_evidence_pending"]
    cp4["evaluated_commit"] = None
    cp4["evidence"]["commands"] = []
    result_dir = tmp_path / "docs/product-reset"
    result_dir.mkdir(parents=True)
    (result_dir / "EVAL_RESULT.json").write_text(json.dumps(result), encoding="utf-8")


def _successful_cp4_command_executor(
    repo_root: Path,
    command_spec: dict[str, object],
) -> subprocess.CompletedProcess[str]:
    output_by_id = {
        "backend-full-suite": "310 passed, 2 skipped",
        "frontend-full-suite": "Tests 84 passed",
        "frontend-production-build": "136 modules transformed",
        "browser-production-chromium-1366": "4 passed",
        "frontend-production-denylist": "",
    }
    command_id = str(command_spec["id"])
    return subprocess.CompletedProcess(
        ["sh", "-lc", str(command_spec["command"])],
        1 if command_id == "frontend-production-denylist" else 0,
        stdout=output_by_id[command_id],
        stderr="",
    )


def test_cp4_run_binds_only_cp4_and_preserves_false_full_gates(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp4_result(tmp_path)
    evaluated = "d" * 40
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp4_git_errors", lambda document, repo_root: [])

    bound = run_checkpoint(
        tmp_path,
        "CP4",
        command_executor=_successful_cp4_command_executor,
    )

    cp4 = bound["checkpoint_results"]["CP4"]
    commands = cp4["evidence"]["commands"]
    assert bound["commit"] == evaluated
    assert bound["checkpoint"] == "CP4"
    assert [item["id"] for item in commands] == list(CP4_EXPECTED_COMMANDS)
    assert [item["count"] for item in commands] == [310, 84, 136, 4, 0]
    assert [item["exit_code"] for item in commands] == [0, 0, 0, 0, 1]
    assert all(item["outcome"] == "automated_pass" for item in commands)
    assert all(item["reproducibility"]["evaluated_commit"] == evaluated for item in commands)
    assert cp4["evaluated_commit"] == evaluated
    assert cp4["passed"] is True
    assert cp4["missing"] == []
    assert bound["completed_checkpoints"] == ["CP1", "CP2", "CP3", "CP4"]
    assert bound["checkpoint_results"]["CP3"]["evaluated_commit"] == "b" * 40
    assert "CP4" not in bound["failed_gates"]
    assert bound["local_hard_gates_passed"] is False
    assert bound["hard_gates_passed"] is False
    assert bound["full_eval_passed"] is False


def test_cp4_failed_command_keeps_checkpoint_failed_and_uncompleted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp4_result(tmp_path)
    evaluated = "d" * 40
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp4_git_errors", lambda document, repo_root: [])

    def failing_executor(
        repo_root: Path,
        command_spec: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        completed = _successful_cp4_command_executor(repo_root, command_spec)
        if command_spec["id"] == "browser-production-chromium-1366":
            return subprocess.CompletedProcess(completed.args, 0, stdout="no tests", stderr="")
        return completed

    bound = run_checkpoint(tmp_path, "CP4", command_executor=failing_executor)

    cp4 = bound["checkpoint_results"]["CP4"]
    failed = next(
        item
        for item in cp4["evidence"]["commands"]
        if item["id"] == "browser-production-chromium-1366"
    )
    assert failed["count"] == 0
    assert failed["outcome"] == "automated_failure"
    assert cp4["passed"] is False
    assert "CP4" not in bound["completed_checkpoints"]
    assert "CP4" in bound["failed_gates"]


def test_cp4_run_rejects_source_side_effect_between_commands(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp4_result(tmp_path)
    evaluated = "d" * 40
    dirty_checks = iter(
        (
            set(),
            set(),
            {"frontend/src/generated.ts"},
        )
    )
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: next(dirty_checks))
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)

    with pytest.raises(ValueError, match="каноническая команда CP4.*изменила дерево исходников"):
        run_checkpoint(
            tmp_path,
            "CP4",
            command_executor=_successful_cp4_command_executor,
        )


def test_cp4_run_checks_stable_head_before_and_after_each_command(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp4_result(tmp_path)
    evaluated = "d" * 40
    future = "e" * 40
    heads = iter((evaluated, evaluated, future))
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: next(heads))

    with pytest.raises(ValueError, match="HEAD изменился.*команды CP4"):
        run_checkpoint(
            tmp_path,
            "CP4",
            command_executor=_successful_cp4_command_executor,
        )


def test_cp4_checkpoint_verify_fails_for_source_template_and_accepts_valid_binding() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    template = _cp4_source_template_result(repo_root)
    bound = _cp4_checkpoint_result(evaluated_commit="c" * 40)

    template_verification = evaluate_verification(
        template,
        scope="checkpoint",
        checkpoint="CP4",
    )
    bound_verification = evaluate_verification(
        bound,
        scope="checkpoint",
        checkpoint="CP4",
    )

    assert template_verification.passed is False
    assert bound_verification.passed is True


def _cp5_source_template_result(repo_root: Path) -> dict[str, object]:
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    cp4_commit = result["checkpoint_results"]["CP4"]["evaluated_commit"]
    result["commit"] = cp4_commit
    result["checkpoint"] = "CP4"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3", "CP4"]
    result["failed_gates"] = ["CP5", "CP6", "CP7", "external_demo"]
    result["checkpoint_results"]["CP5"] = {
        "passed": False,
        "missing": ["command_evidence_pending"],
        "evaluated_commit": None,
        "evidence": {
            "schema_version": 1,
            **copy.deepcopy(CP5_EXPECTED_EVIDENCE),
            "commands": [],
        },
    }
    result["largest_remaining_risk"] = (
        "CP5 source/template требует independent review и runner-owned binding; "
        "CP6–CP7, clean-deploy/restore rehearsal и внешний demo gate остаются незавершёнными."
    )
    result["next_action"] = (
        "После independent review чистого source commit выполнить runner-owned CP5 "
        "boundary и записать отдельный binding commit."
    )
    return result


def _cp5_binding_subtree_errors(
    document: dict[str, object], repo_root: Path
) -> list[str]:
    if not eval_service._git_commit_exists(repo_root, CP5_BINDING_COMMIT):
        return [f"CP5 binding commit недоступен: {CP5_BINDING_COMMIT}"]

    serialized_binding = eval_service._git_file_at_commit(
        repo_root,
        CP5_BINDING_COMMIT,
        "docs/product-reset/EVAL_RESULT.json",
    )
    if serialized_binding is None:
        return [f"CP5 binding evidence недоступен в commit {CP5_BINDING_COMMIT}"]
    try:
        binding_document = json.loads(serialized_binding)
    except json.JSONDecodeError:
        return ["CP5 binding evidence содержит невалидный JSON"]
    if not isinstance(binding_document, dict):
        return ["CP5 binding evidence должен быть JSON-объектом"]

    binding_results = binding_document.get("checkpoint_results")
    pinned_result = (
        binding_results.get("CP5") if isinstance(binding_results, dict) else None
    )
    if not isinstance(pinned_result, dict):
        return ["CP5 subtree отсутствует в binding evidence"]

    checkpoint_results = document.get("checkpoint_results")
    current_result = (
        checkpoint_results.get("CP5") if isinstance(checkpoint_results, dict) else None
    )
    if not isinstance(current_result, dict):
        return ["CP5 subtree отсутствует в текущем eval result"]
    if current_result != pinned_result:
        return ["CP5 evidence не совпадает с exact binding subtree"]
    return []


def _valid_cp5_evidence(evaluated_commit: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        **copy.deepcopy(CP5_EXPECTED_EVIDENCE),
        "commands": [
            {
                "id": command_id,
                "command": command,
                "expected_exit_code": 0,
                "exit_code": 0,
                "count": 1,
                "outcome": "automated_pass",
                "reproducibility": {
                    "runner": "product_reset_eval.py",
                    "evaluated_commit": evaluated_commit,
                    "command_sha256": eval_service._sha256_text(command),
                    "output_sha256": "0" * 64,
                    "summary": "ожидаемый_код_выхода=0; количество=1",
                    "duration_ms": 0,
                },
            }
            for command_id, command in CP5_EXPECTED_COMMANDS.items()
        ],
    }


def _cp5_checkpoint_result(*, evaluated_commit: str) -> dict[str, object]:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp5_source_template_result(repo_root)
    result["commit"] = evaluated_commit
    result["checkpoint"] = "CP5"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3", "CP4", "CP5"]
    result["failed_gates"] = ["CP6", "CP7", "external_demo"]
    result["checkpoint_results"]["CP5"] = {
        "passed": True,
        "missing": [],
        "evaluated_commit": evaluated_commit,
        "evidence": _valid_cp5_evidence(evaluated_commit),
    }
    return result


def _write_pending_cp5_result(repo_root: Path) -> None:
    result_path = repo_root / "docs/product-reset/EVAL_RESULT.json"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    source_root = Path(__file__).resolve().parents[2]
    result_path.write_text(
        json.dumps(_cp5_source_template_result(source_root), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def test_cp5_source_template_has_exact_contract_and_remains_unbound() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp5_source_template_result(repo_root)
    cp5 = result["checkpoint_results"]["CP5"]
    assert getattr(eval_service, "CP5_REQUIRED_COMMANDS", None) == CP5_EXPECTED_COMMANDS
    assert getattr(eval_service, "CP5_REQUIRED_EVIDENCE", None) == CP5_EXPECTED_EVIDENCE
    assert eval_service._cp5_schema_errors(result, validate_command_results=False) == []
    assert cp5["passed"] is False
    assert cp5["missing"] == ["command_evidence_pending"]
    assert cp5["evaluated_commit"] is None
    assert cp5["evidence"]["commands"] == []
    assert result["checkpoint"] == "CP4"
    assert result["completed_checkpoints"] == ["CP1", "CP2", "CP3", "CP4"]
    assert result["failed_gates"] == ["CP5", "CP6", "CP7", "external_demo"]
    assert evaluate_verification(result, scope="checkpoint", checkpoint="CP5").passed is False


def test_tracked_eval_result_preserves_bound_cp5_and_checkpoint_verifies() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    evaluated_commit = "38d01309eba9e9ffbe14fcf91ede785819f9b6fb"
    cp5 = result["checkpoint_results"]["CP5"]

    assert CP5_BINDING_COMMIT == "f87638588fdd606add683593f340378f5b1c3961"
    assert cp5["passed"] is True
    assert cp5["missing"] == []
    assert cp5["evaluated_commit"] == evaluated_commit
    assert [
        (item["id"], item["count"], item["exit_code"])
        for item in cp5["evidence"]["commands"]
    ] == [
        ("backend-full-suite", 464, 0),
        ("frontend-full-suite", 103, 0),
        ("frontend-production-build", 142, 0),
        ("browser-production-chromium-1366", 6, 0),
        ("browser-notifications-chromium-1366", 2, 0),
    ]
    assert all(
        item["reproducibility"]["evaluated_commit"] == evaluated_commit
        for item in cp5["evidence"]["commands"]
    )
    assert _cp5_binding_subtree_errors(result, repo_root) == []

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP5",
        repo_root=repo_root,
    )
    assert verification.passed is True
    assert verification.errors == ()


@pytest.mark.parametrize("field", ["output_sha256", "summary", "duration_ms"])
def test_cp5_binding_regression_rejects_valid_format_command_metadata_drift(
    field: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    command = result["checkpoint_results"]["CP5"]["evidence"]["commands"][0]
    if field == "output_sha256":
        command["reproducibility"][field] = "f" * 64
    elif field == "summary":
        command["reproducibility"][field] = "успешно; количество=465"
    else:
        command["reproducibility"][field] += 1

    assert eval_service._cp5_schema_errors(result) == []
    assert _cp5_binding_subtree_errors(result, repo_root) == [
        "CP5 evidence не совпадает с exact binding subtree"
    ]


@pytest.mark.parametrize(
    ("unavailable", "expected_error"),
    [
        ("binding_commit", "CP5 binding commit недоступен"),
        ("binding_blob", "CP5 binding evidence недоступен"),
        ("invalid_json", "CP5 binding evidence содержит невалидный JSON"),
        ("non_object", "CP5 binding evidence должен быть JSON-объектом"),
        ("missing_subtree", "CP5 subtree отсутствует в binding evidence"),
    ],
)
def test_cp5_binding_regression_fails_closed_when_pinned_evidence_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    unavailable: str,
    expected_error: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    if unavailable == "binding_commit":
        monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: False)
    elif unavailable == "binding_blob":
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: None)
    elif unavailable == "invalid_json":
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: "{")
    elif unavailable == "non_object":
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: "[]")
    else:
        monkeypatch.setattr(
            eval_service,
            "_git_file_at_commit",
            lambda *_args: json.dumps({"checkpoint_results": {}}),
        )

    errors = _cp5_binding_subtree_errors(result, repo_root)

    assert any(expected_error in error for error in errors)


@pytest.mark.parametrize(
    "section",
    [
        "correction_packages",
        "notification_delivery",
        "late_edit_routing",
        "personal_actions",
        "frontend_attention",
        "deterministic_tests",
    ],
)
def test_cp5_verification_rejects_each_mutated_contract_section(section: str) -> None:
    result = _cp5_checkpoint_result(evaluated_commit="d" * 40)
    assert evaluate_verification(result, scope="checkpoint", checkpoint="CP5").passed is True

    result["checkpoint_results"]["CP5"]["evidence"][section] = {}
    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP5")
    assert verification.passed is False
    assert any(f"CP5 evidence {section} не совпадает" in error for error in verification.errors)


def test_cp5_runner_owns_exact_commands_and_binds_only_cp5(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp5_result(tmp_path)
    evaluated = "d" * 40
    calls: list[tuple[str, str]] = []
    outputs = {
        "backend-full-suite": "423 passed",
        "frontend-full-suite": "Test Files 15 passed\nTests 103 passed",
        "frontend-production-build": "142 modules transformed",
        "browser-production-chromium-1366": "6 passed",
        "browser-notifications-chromium-1366": "2 passed",
    }

    def executor(
        repo_root: Path,
        command_spec: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        command_id = str(command_spec["id"])
        command = str(command_spec["command"])
        calls.append((command_id, command))
        return subprocess.CompletedProcess(
            ["sh", "-lc", command],
            0,
            stdout=outputs[command_id],
            stderr="",
        )

    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp5_git_errors", lambda document, repo_root: [], raising=False)

    bound = run_checkpoint(tmp_path, "CP5", command_executor=executor)
    cp5 = bound["checkpoint_results"]["CP5"]

    assert calls == list(CP5_EXPECTED_COMMANDS.items())
    assert [item["count"] for item in cp5["evidence"]["commands"]] == [423, 103, 142, 6, 2]
    assert cp5["evaluated_commit"] == evaluated
    assert cp5["passed"] is True
    assert cp5["missing"] == []
    assert bound["completed_checkpoints"] == ["CP1", "CP2", "CP3", "CP4", "CP5"]
    assert bound["failed_gates"] == ["CP6", "CP7", "external_demo"]
    assert bound["checkpoint_results"]["CP4"]["evaluated_commit"] == (
        "5b25658f84e5b94c267ef59f3bfa2c9552fa04dd"
    )
    assert bound["local_hard_gates_passed"] is False
    assert bound["hard_gates_passed"] is False
    assert bound["full_eval_passed"] is False


@pytest.mark.parametrize("marker", ["placeholder", "timeout", "manual"])
def test_cp5_verification_rejects_forbidden_evidence_markers(marker: str) -> None:
    result = _cp5_checkpoint_result(evaluated_commit="d" * 40)
    result["checkpoint_results"]["CP5"]["evidence"]["correction_packages"][
        "contracts"
    ][0] = marker

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP5")

    assert verification.passed is False
    assert f"CP5 evidence содержит запрещённый маркер: {marker}" in verification.errors


@pytest.mark.parametrize(
    ("mutation", "expected_error"),
    [
        ("extra_top_key", "точный структурированный contract"),
        ("bool_schema", "schema_version"),
        ("missing_command", "точном порядке"),
        ("duplicate_command", "уникальными строками"),
        ("unknown_command", "неизвестный command ID"),
        ("wrong_order", "точном порядке"),
        ("missing_record_key", "точные поля"),
        ("extra_record_key", "точные поля"),
        ("missing_repro_key", "метаданные воспроизводимости"),
        ("extra_repro_key", "метаданные воспроизводимости"),
        ("bool_expected_exit", "expected_exit_code"),
        ("bool_exit", "exit_code должен быть целым"),
        ("bool_count", "count должен быть неотрицательным"),
        ("bool_duration", "метаданные воспроизводимости"),
        ("failed_command", "не подтвердил expected exit/count contract"),
        ("no_count", "не подтвердил expected exit/count contract"),
    ],
)
def test_cp5_verification_rejects_unowned_command_and_reproducibility_records(
    mutation: str,
    expected_error: str,
) -> None:
    result = _cp5_checkpoint_result(evaluated_commit="d" * 40)
    evidence = result["checkpoint_results"]["CP5"]["evidence"]
    commands = evidence["commands"]

    if mutation == "extra_top_key":
        evidence["unexpected"] = True
    elif mutation == "bool_schema":
        evidence["schema_version"] = True
    elif mutation == "missing_command":
        commands.pop()
    elif mutation == "duplicate_command":
        commands[1]["id"] = commands[0]["id"]
    elif mutation == "unknown_command":
        commands[0]["id"] = "unknown"
    elif mutation == "wrong_order":
        commands[0], commands[1] = commands[1], commands[0]
    elif mutation == "missing_record_key":
        commands[0].pop("count")
    elif mutation == "extra_record_key":
        commands[0]["unexpected"] = True
    elif mutation == "missing_repro_key":
        commands[0]["reproducibility"].pop("summary")
    elif mutation == "extra_repro_key":
        commands[0]["reproducibility"]["unexpected"] = True
    elif mutation == "bool_expected_exit":
        commands[0]["expected_exit_code"] = True
    elif mutation == "bool_exit":
        commands[0]["exit_code"] = True
    elif mutation == "bool_count":
        commands[0]["count"] = True
    elif mutation == "bool_duration":
        commands[0]["reproducibility"]["duration_ms"] = True
    elif mutation == "failed_command":
        commands[0]["exit_code"] = 1
        commands[0]["outcome"] = "automated_failure"
    elif mutation == "no_count":
        commands[0]["count"] = 0
        commands[0]["outcome"] = "automated_failure"

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP5")

    assert verification.passed is False
    assert any(expected_error in error for error in verification.errors)


@pytest.mark.parametrize(
    ("failed_id", "exit_code", "output"),
    [
        ("backend-full-suite", 1, "1 failed"),
        ("browser-notifications-chromium-1366", 0, "no tests"),
    ],
)
def test_cp5_failed_or_no_count_command_keeps_checkpoint_uncompleted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failed_id: str,
    exit_code: int,
    output: str,
) -> None:
    _write_pending_cp5_result(tmp_path)
    evaluated = "d" * 40
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp5_git_errors", lambda document, repo_root: [])

    def executor(
        repo_root: Path,
        command_spec: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        command_id = str(command_spec["id"])
        command = str(command_spec["command"])
        if command_id == failed_id:
            return subprocess.CompletedProcess(["sh"], exit_code, stdout=output, stderr="")
        success_output = (
            "1 modules transformed"
            if command_id == "frontend-production-build"
            else "1 passed"
        )
        return subprocess.CompletedProcess(["sh"], 0, stdout=success_output, stderr="")

    bound = run_checkpoint(tmp_path, "CP5", command_executor=executor)
    record = next(
        item
        for item in bound["checkpoint_results"]["CP5"]["evidence"]["commands"]
        if item["id"] == failed_id
    )

    assert record["outcome"] == "automated_failure"
    assert bound["checkpoint_results"]["CP5"]["passed"] is False
    assert "CP5" not in bound["completed_checkpoints"]
    assert "CP5" in bound["failed_gates"]


def test_cp5_runner_rejects_dirty_side_effect_after_command(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp5_result(tmp_path)
    evaluated = "d" * 40
    dirty_checks = iter((set(), set(), {"frontend/src/generated.ts"}))
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: next(dirty_checks))
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)

    with pytest.raises(ValueError, match="каноническая команда CP5.*изменила дерево исходников"):
        run_checkpoint(
            tmp_path,
            "CP5",
            command_executor=lambda repo_root, spec: subprocess.CompletedProcess(
                ["sh"], 0, stdout="1 passed", stderr=""
            ),
        )


def test_cp5_runner_rejects_dirty_source_before_commands(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp5_result(tmp_path)
    monkeypatch.setattr(
        eval_service,
        "_git_dirty_paths",
        lambda repo_root: {"backend/app/services/notification_service.py"},
    )

    with pytest.raises(ValueError, match="checkpoint run требует чистый committed source tree"):
        run_checkpoint(
            tmp_path,
            "CP5",
            command_executor=lambda repo_root, spec: subprocess.CompletedProcess(
                ["sh"], 0, stdout="1 passed", stderr=""
            ),
        )


def test_cp5_runner_rejects_head_drift_between_commands(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp5_result(tmp_path)
    evaluated = "d" * 40
    future = "e" * 40
    heads = iter((evaluated, evaluated, future))
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: next(heads))

    with pytest.raises(ValueError, match="HEAD изменился после команды CP5"):
        run_checkpoint(
            tmp_path,
            "CP5",
            command_executor=lambda repo_root, spec: subprocess.CompletedProcess(
                ["sh"], 0, stdout="1 passed", stderr=""
            ),
        )


@pytest.mark.parametrize(
    ("mode", "expected_error"),
    [
        ("unavailable", "CP4 pinned binding commit недоступен"),
        ("invalid_json", "CP4 pinned binding evidence содержит невалидный JSON"),
        ("mutated", "CP4 evidence не совпадает с pinned binding"),
    ],
)
def test_cp5_historical_cp4_binding_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    expected_error: str,
) -> None:
    result = _cp5_checkpoint_result(evaluated_commit="d" * 40)
    cp4_binding = HISTORICAL_BINDING_COMMITS["CP4"]

    monkeypatch.setattr(
        eval_service,
        "_git_commit_exists",
        lambda repo_root, sha: not (mode == "unavailable" and sha == cp4_binding),
    )

    def binding_file(repo_root: Path, commit: str, path: str) -> str:
        if commit == cp4_binding and mode == "invalid_json":
            return "{"
        binding = copy.deepcopy(result)
        if commit == cp4_binding and mode == "mutated":
            binding["checkpoint_results"]["CP4"]["evidence"]["commands"][0]["count"] = 999
        return json.dumps(binding)

    monkeypatch.setattr(eval_service, "_git_file_at_commit", binding_file)

    errors = eval_service._historical_checkpoint_binding_errors(result, Path("."))

    assert any(expected_error in error for error in errors)


@pytest.mark.parametrize(
    ("mode", "expected_error"),
    [
        ("cp4_ancestry", "CP4 evaluated_commit не является предком CP5 evaluated_commit"),
        ("base_ancestry", "IMPLEMENTATION_BASE_SHA не является предком CP5 evaluated_commit"),
        ("missing_path", "CP5 evidence path отсутствует"),
        ("migration", "изменяет запрещённое дерево backend/migrations"),
    ],
)
def test_cp5_git_contract_rejects_ancestry_path_and_migration_drift(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    expected_error: str,
) -> None:
    result = _cp5_checkpoint_result(evaluated_commit="d" * 40)
    cp4_commit = result["checkpoint_results"]["CP4"]["evaluated_commit"]
    implementation_base = result["IMPLEMENTATION_BASE_SHA"]
    missing_path = eval_service.CP5_REFERENCED_FILES[0]

    monkeypatch.setattr(eval_service, "_historical_checkpoint_binding_errors", lambda *args: [])
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "d" * 40)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda repo_root, ancestor, descendant: not (
            (mode == "cp4_ancestry" and ancestor == cp4_commit and descendant == "d" * 40)
            or (
                mode == "base_ancestry"
                and ancestor == implementation_base
                and descendant == "d" * 40
            )
        ),
    )
    monkeypatch.setattr(
        eval_service,
        "_git_path_exists_at_commit",
        lambda repo_root, commit, path: not (mode == "missing_path" and path == missing_path),
    )
    monkeypatch.setattr(
        eval_service,
        "_git_diff_is_empty",
        lambda repo_root, base, commit, paths: mode != "migration",
    )
    for checkpoint in (1, 2, 3, 4):
        monkeypatch.setattr(eval_service, f"_cp{checkpoint}_schema_errors", lambda document: [])
        monkeypatch.setattr(
            eval_service,
            f"_cp{checkpoint}_git_errors",
            lambda document, repo_root: [],
        )

    errors = eval_service._cp5_git_errors(result, Path("."))

    assert any(expected_error in error for error in errors)


def test_cp5_checkpoint_verify_rejects_template_and_accepts_bound_evidence() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    template = _cp5_source_template_result(repo_root)
    bound = _cp5_checkpoint_result(evaluated_commit="d" * 40)

    assert evaluate_verification(
        template,
        scope="checkpoint",
        checkpoint="CP5",
    ).passed is False
    assert evaluate_verification(
        bound,
        scope="checkpoint",
        checkpoint="CP5",
    ).passed is True


def _cp6_source_template_result(repo_root: Path) -> dict[str, object]:
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    cp5_commit = result["checkpoint_results"]["CP5"]["evaluated_commit"]
    result["commit"] = cp5_commit
    result["checkpoint"] = "CP5"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3", "CP4", "CP5"]
    result["failed_gates"] = ["CP6", "CP7", "external_demo"]
    result["checkpoint_results"]["CP6"] = {
        "passed": False,
        "missing": ["command_evidence_pending"],
        "evaluated_commit": None,
        "evidence": {
            "schema_version": 1,
            **copy.deepcopy(CP6_EXPECTED_EVIDENCE),
            "commands": [],
        },
    }
    result["local_hard_gates_passed"] = False
    result["hard_gates_passed"] = False
    result["full_eval_passed"] = False
    result["largest_remaining_risk"] = (
        "CP6 source/template требует independent review и runner-owned binding; "
        "CP7, clean-deploy/restore rehearsal и внешний demo gate остаются незавершёнными."
    )
    result["next_action"] = (
        "После independent review чистого source commit выполнить runner-owned CP6 "
        "boundary и записать отдельный binding commit."
    )
    return result


def _cp6_binding_subtree_errors(
    document: dict[str, object], repo_root: Path
) -> list[str]:
    if not eval_service._git_commit_exists(repo_root, CP6_BINDING_COMMIT):
        return [f"CP6 binding commit недоступен: {CP6_BINDING_COMMIT}"]

    serialized_binding = eval_service._git_file_at_commit(
        repo_root,
        CP6_BINDING_COMMIT,
        "docs/product-reset/EVAL_RESULT.json",
    )
    if serialized_binding is None:
        return [f"CP6 binding evidence недоступен в commit {CP6_BINDING_COMMIT}"]
    try:
        binding_document = json.loads(serialized_binding)
    except json.JSONDecodeError:
        return ["CP6 binding evidence содержит невалидный JSON"]
    if not isinstance(binding_document, dict):
        return ["CP6 binding evidence должен быть JSON-объектом"]

    binding_results = binding_document.get("checkpoint_results")
    pinned_result = (
        binding_results.get("CP6") if isinstance(binding_results, dict) else None
    )
    if not isinstance(pinned_result, dict):
        return ["CP6 subtree отсутствует в binding evidence"]

    checkpoint_results = document.get("checkpoint_results")
    current_result = (
        checkpoint_results.get("CP6") if isinstance(checkpoint_results, dict) else None
    )
    if not isinstance(current_result, dict):
        return ["CP6 subtree отсутствует в текущем eval result"]
    if current_result != pinned_result:
        return ["CP6 evidence не совпадает с exact binding subtree"]
    return []


def _valid_cp6_evidence(evaluated_commit: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        **copy.deepcopy(CP6_EXPECTED_EVIDENCE),
        "commands": [
            {
                "id": command_id,
                "command": command,
                "expected_exit_code": 0,
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
            for command_id, command in CP6_EXPECTED_COMMANDS.items()
        ],
    }


def _cp6_checkpoint_result(*, evaluated_commit: str) -> dict[str, object]:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp6_source_template_result(repo_root)
    result["commit"] = evaluated_commit
    result["checkpoint"] = "CP6"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3", "CP4", "CP5", "CP6"]
    result["failed_gates"] = ["CP7", "external_demo"]
    result["checkpoint_results"]["CP6"] = {
        "passed": True,
        "missing": [],
        "evaluated_commit": evaluated_commit,
        "evidence": _valid_cp6_evidence(evaluated_commit),
    }
    return result


def _write_pending_cp6_result(repo_root: Path) -> None:
    result_path = repo_root / "docs/product-reset/EVAL_RESULT.json"
    result_path.parent.mkdir(parents=True, exist_ok=True)
    source_root = Path(__file__).resolve().parents[2]
    result_path.write_text(
        json.dumps(_cp6_source_template_result(source_root), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def test_cp6_source_template_has_exact_contract_and_remains_unbound() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp6_source_template_result(repo_root)
    cp6 = result["checkpoint_results"]["CP6"]

    assert getattr(eval_service, "CP6_REQUIRED_COMMANDS", None) == CP6_EXPECTED_COMMANDS
    assert getattr(eval_service, "CP6_REQUIRED_EVIDENCE", None) == CP6_EXPECTED_EVIDENCE
    assert eval_service.HISTORICAL_CHECKPOINT_BINDING_COMMITS == HISTORICAL_BINDING_COMMITS
    assert eval_service.HISTORICAL_CHECKPOINT_EVALUATED_COMMITS == HISTORICAL_EVALUATED_COMMITS
    assert eval_service._cp6_schema_errors(result, validate_command_results=False) == []
    assert cp6["passed"] is False
    assert cp6["missing"] == ["command_evidence_pending"]
    assert cp6["evaluated_commit"] is None
    assert cp6["evidence"]["commands"] == []
    assert result["checkpoint"] == "CP5"
    assert result["completed_checkpoints"] == ["CP1", "CP2", "CP3", "CP4", "CP5"]
    assert result["failed_gates"] == ["CP6", "CP7", "external_demo"]
    assert result["local_hard_gates_passed"] is False
    assert result["hard_gates_passed"] is False
    assert result["full_eval_passed"] is False
    assert evaluate_verification(result, scope="checkpoint", checkpoint="CP6").passed is False


def test_tracked_eval_result_is_bound_to_cp6_and_checkpoint_verifies() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    evaluated_commit = "1d97ecc18662f5530870e24aff4126f94b2bc4cc"
    cp6 = result["checkpoint_results"]["CP6"]

    assert CP6_BINDING_COMMIT == "837e0117c01e473c93f0469df4847e858f2654b5"
    assert cp6["passed"] is True
    assert cp6["missing"] == []
    assert cp6["evaluated_commit"] == evaluated_commit
    assert [
        (
            item["id"],
            item["count"],
            item["exit_code"],
            item["reproducibility"]["duration_ms"],
        )
        for item in cp6["evidence"]["commands"]
    ] == [
        ("backend-full-suite", 570, 0, 1335253),
        ("frontend-full-suite", 117, 0, 111686),
        ("frontend-production-build", 146, 0, 23781),
        ("browser-full-story-chromium-1366", 1, 0, 69825),
    ]
    assert all(
        item["reproducibility"]["evaluated_commit"] == evaluated_commit
        for item in cp6["evidence"]["commands"]
    )
    assert _cp6_binding_subtree_errors(result, repo_root) == []

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP6",
        repo_root=repo_root,
    )
    assert verification.passed is True
    assert verification.errors == ()


@pytest.mark.parametrize("field", ["output_sha256", "summary", "duration_ms"])
def test_cp6_binding_regression_rejects_valid_format_command_metadata_drift(
    field: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    command = result["checkpoint_results"]["CP6"]["evidence"]["commands"][0]
    if field == "output_sha256":
        command["reproducibility"][field] = "f" * 64
    elif field == "summary":
        command["reproducibility"][field] = "успешно; количество=571"
    else:
        command["reproducibility"][field] += 1

    assert eval_service._cp6_schema_errors(result) == []
    assert _cp6_binding_subtree_errors(result, repo_root) == [
        "CP6 evidence не совпадает с exact binding subtree"
    ]


@pytest.mark.parametrize(
    ("unavailable", "expected_error"),
    [
        ("binding_commit", "CP6 binding commit недоступен"),
        ("binding_blob", "CP6 binding evidence недоступен"),
        ("invalid_json", "CP6 binding evidence содержит невалидный JSON"),
        ("non_object", "CP6 binding evidence должен быть JSON-объектом"),
        ("missing_subtree", "CP6 subtree отсутствует в binding evidence"),
    ],
)
def test_cp6_binding_regression_fails_closed_when_pinned_evidence_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    unavailable: str,
    expected_error: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    if unavailable == "binding_commit":
        monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: False)
    elif unavailable == "binding_blob":
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: None)
    elif unavailable == "invalid_json":
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: "{")
    elif unavailable == "non_object":
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: "[]")
    else:
        monkeypatch.setattr(
            eval_service,
            "_git_file_at_commit",
            lambda *_args: json.dumps({"checkpoint_results": {}}),
        )

    errors = _cp6_binding_subtree_errors(result, repo_root)

    assert any(expected_error in error for error in errors)


@pytest.mark.parametrize(
    "section",
    [
        "external_approval_cycles",
        "story_creation_and_lifecycle",
        "aggregate_consistency",
        "full_product_flow",
        "deterministic_tests",
    ],
)
def test_cp6_verification_rejects_each_mutated_contract_section(section: str) -> None:
    result = _cp6_checkpoint_result(evaluated_commit="e" * 40)
    assert evaluate_verification(result, scope="checkpoint", checkpoint="CP6").passed is True

    result["checkpoint_results"]["CP6"]["evidence"][section] = {}
    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP6")

    assert verification.passed is False
    assert any(f"CP6 evidence {section} не совпадает" in error for error in verification.errors)


@pytest.mark.parametrize("marker", ["placeholder", "timeout", "manual"])
def test_cp6_verification_rejects_forbidden_evidence_markers(marker: str) -> None:
    result = _cp6_checkpoint_result(evaluated_commit="e" * 40)
    result["checkpoint_results"]["CP6"]["evidence"]["external_approval_cycles"][
        "contracts"
    ][0] = marker

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP6")

    assert verification.passed is False
    assert f"CP6 evidence содержит запрещённый маркер: {marker}" in verification.errors


@pytest.mark.parametrize(
    ("mutation", "expected_error"),
    [
        ("extra_top_key", "точный структурированный contract"),
        ("bool_schema", "schema_version"),
        ("missing_command", "точном порядке"),
        ("duplicate_command", "уникальными строками"),
        ("unknown_command", "неизвестный command ID"),
        ("wrong_order", "точном порядке"),
        ("missing_record_key", "точные поля"),
        ("extra_record_key", "точные поля"),
        ("missing_repro_key", "метаданные воспроизводимости"),
        ("extra_repro_key", "метаданные воспроизводимости"),
        ("bool_expected_exit", "expected_exit_code"),
        ("bool_exit", "exit_code должен быть целым"),
        ("bool_count", "count должен быть неотрицательным"),
        ("bool_duration", "метаданные воспроизводимости"),
        ("failed_command", "не подтвердил expected exit/count contract"),
        ("no_count", "не подтвердил expected exit/count contract"),
    ],
)
def test_cp6_verification_rejects_unowned_command_and_reproducibility_records(
    mutation: str,
    expected_error: str,
) -> None:
    result = _cp6_checkpoint_result(evaluated_commit="e" * 40)
    evidence = result["checkpoint_results"]["CP6"]["evidence"]
    commands = evidence["commands"]

    if mutation == "extra_top_key":
        evidence["unexpected"] = True
    elif mutation == "bool_schema":
        evidence["schema_version"] = True
    elif mutation == "missing_command":
        commands.pop()
    elif mutation == "duplicate_command":
        commands[1]["id"] = commands[0]["id"]
    elif mutation == "unknown_command":
        commands[0]["id"] = "unknown"
    elif mutation == "wrong_order":
        commands[0], commands[1] = commands[1], commands[0]
    elif mutation == "missing_record_key":
        commands[0].pop("count")
    elif mutation == "extra_record_key":
        commands[0]["unexpected"] = True
    elif mutation == "missing_repro_key":
        commands[0]["reproducibility"].pop("summary")
    elif mutation == "extra_repro_key":
        commands[0]["reproducibility"]["unexpected"] = True
    elif mutation == "bool_expected_exit":
        commands[0]["expected_exit_code"] = True
    elif mutation == "bool_exit":
        commands[0]["exit_code"] = True
    elif mutation == "bool_count":
        commands[0]["count"] = True
    elif mutation == "bool_duration":
        commands[0]["reproducibility"]["duration_ms"] = True
    elif mutation == "failed_command":
        commands[0]["exit_code"] = 1
        commands[0]["outcome"] = "automated_failure"
    elif mutation == "no_count":
        commands[0]["count"] = 0
        commands[0]["outcome"] = "automated_failure"

    verification = evaluate_verification(result, scope="checkpoint", checkpoint="CP6")

    assert verification.passed is False
    assert any(expected_error in error for error in verification.errors)


def test_cp6_runner_owns_exact_commands_and_binds_only_cp6(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp6_result(tmp_path)
    evaluated = "e" * 40
    calls: list[tuple[str, str]] = []
    outputs = {
        "backend-full-suite": "531 passed, 2 skipped",
        "frontend-full-suite": "Test Files 17 passed\nTests 117 passed",
        "frontend-production-build": "146 modules transformed",
        "browser-full-story-chromium-1366": "1 passed",
    }

    def executor(
        repo_root: Path,
        command_spec: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        command_id = str(command_spec["id"])
        command = str(command_spec["command"])
        calls.append((command_id, command))
        return subprocess.CompletedProcess(
            ["sh", "-lc", command],
            0,
            stdout=outputs[command_id],
            stderr="",
        )

    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp6_git_errors", lambda document, repo_root: [])

    bound = run_checkpoint(tmp_path, "CP6", command_executor=executor)
    cp6 = bound["checkpoint_results"]["CP6"]

    assert calls == list(CP6_EXPECTED_COMMANDS.items())
    assert [item["count"] for item in cp6["evidence"]["commands"]] == [531, 117, 146, 1]
    assert cp6["evaluated_commit"] == evaluated
    assert cp6["passed"] is True
    assert cp6["missing"] == []
    assert bound["completed_checkpoints"] == ["CP1", "CP2", "CP3", "CP4", "CP5", "CP6"]
    assert bound["failed_gates"] == ["CP7", "external_demo"]
    assert bound["checkpoint_results"]["CP5"]["evaluated_commit"] == (
        "38d01309eba9e9ffbe14fcf91ede785819f9b6fb"
    )
    assert bound["local_hard_gates_passed"] is False
    assert bound["hard_gates_passed"] is False
    assert bound["full_eval_passed"] is False


@pytest.mark.parametrize(
    ("failed_id", "exit_code", "output"),
    [
        ("backend-full-suite", 1, "1 failed"),
        ("browser-full-story-chromium-1366", 0, "no tests"),
    ],
)
def test_cp6_failed_or_no_count_command_keeps_checkpoint_uncompleted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failed_id: str,
    exit_code: int,
    output: str,
) -> None:
    _write_pending_cp6_result(tmp_path)
    evaluated = "e" * 40
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)
    monkeypatch.setattr(eval_service, "_cp6_git_errors", lambda document, repo_root: [])

    def executor(
        repo_root: Path,
        command_spec: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        command_id = str(command_spec["id"])
        if command_id == failed_id:
            return subprocess.CompletedProcess(["sh"], exit_code, stdout=output, stderr="")
        success_output = (
            "1 modules transformed"
            if command_id == "frontend-production-build"
            else "1 passed"
        )
        return subprocess.CompletedProcess(["sh"], 0, stdout=success_output, stderr="")

    bound = run_checkpoint(tmp_path, "CP6", command_executor=executor)
    record = next(
        item
        for item in bound["checkpoint_results"]["CP6"]["evidence"]["commands"]
        if item["id"] == failed_id
    )

    assert record["outcome"] == "automated_failure"
    assert bound["checkpoint_results"]["CP6"]["passed"] is False
    assert "CP6" not in bound["completed_checkpoints"]
    assert "CP6" in bound["failed_gates"]


def test_cp6_runner_rejects_dirty_side_effect_and_head_drift(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_pending_cp6_result(tmp_path)
    evaluated = "e" * 40
    dirty_checks = iter((set(), set(), {"frontend/src/generated.ts"}))
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: next(dirty_checks))
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: evaluated)

    with pytest.raises(ValueError, match="каноническая команда CP6.*изменила дерево исходников"):
        run_checkpoint(
            tmp_path,
            "CP6",
            command_executor=lambda repo_root, spec: subprocess.CompletedProcess(
                ["sh"], 0, stdout="1 passed", stderr=""
            ),
        )

    _write_pending_cp6_result(tmp_path)
    heads = iter((evaluated, evaluated, "f" * 40))
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda repo_root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: next(heads))

    with pytest.raises(ValueError, match="HEAD изменился после команды CP6"):
        run_checkpoint(
            tmp_path,
            "CP6",
            command_executor=lambda repo_root, spec: subprocess.CompletedProcess(
                ["sh"], 0, stdout="1 passed", stderr=""
            ),
        )


@pytest.mark.parametrize(
    ("mode", "expected_error"),
    [
        ("unavailable", "CP5 pinned binding commit недоступен"),
        ("invalid_json", "CP5 pinned binding evidence содержит невалидный JSON"),
        ("mutated", "CP5 evidence не совпадает с pinned binding"),
    ],
)
def test_cp6_historical_cp5_binding_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    expected_error: str,
) -> None:
    result = _cp6_checkpoint_result(evaluated_commit="e" * 40)
    cp5_binding = HISTORICAL_BINDING_COMMITS["CP5"]

    monkeypatch.setattr(
        eval_service,
        "_git_commit_exists",
        lambda repo_root, sha: not (mode == "unavailable" and sha == cp5_binding),
    )

    def binding_file(repo_root: Path, commit: str, path: str) -> str:
        if commit == cp5_binding and mode == "invalid_json":
            return "{"
        binding = copy.deepcopy(result)
        if commit == cp5_binding and mode == "mutated":
            binding["checkpoint_results"]["CP5"]["evidence"]["commands"][0]["count"] = 999
        return json.dumps(binding)

    monkeypatch.setattr(eval_service, "_git_file_at_commit", binding_file)

    errors = eval_service._historical_checkpoint_binding_errors(
        result,
        Path("."),
        ("CP5",),
    )

    assert any(expected_error in error for error in errors)


@pytest.mark.parametrize(
    ("mode", "expected_error"),
    [
        ("cp5_ancestry", "CP5 evaluated_commit не является предком CP6 evaluated_commit"),
        ("binding_ancestry", "CP5 pinned binding commit не является предком CP6 evaluated_commit"),
        ("base_ancestry", "IMPLEMENTATION_BASE_SHA не является предком CP6 evaluated_commit"),
        ("missing_path", "CP6 evidence path отсутствует"),
        ("migration", "изменяет запрещённое дерево backend/migrations"),
    ],
)
def test_cp6_git_contract_rejects_ancestry_path_and_migration_drift(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    expected_error: str,
) -> None:
    result = _cp6_checkpoint_result(evaluated_commit="e" * 40)
    cp5_commit = result["checkpoint_results"]["CP5"]["evaluated_commit"]
    cp5_binding = HISTORICAL_BINDING_COMMITS["CP5"]
    implementation_base = result["IMPLEMENTATION_BASE_SHA"]
    missing_path = eval_service.CP6_REFERENCED_FILES[0]

    monkeypatch.setattr(eval_service, "_historical_checkpoint_binding_errors", lambda *args: [])
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "e" * 40)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda repo_root, ancestor, descendant: not (
            (mode == "cp5_ancestry" and ancestor == cp5_commit and descendant == "e" * 40)
            or (
                mode == "binding_ancestry"
                and ancestor == cp5_binding
                and descendant == "e" * 40
            )
            or (
                mode == "base_ancestry"
                and ancestor == implementation_base
                and descendant == "e" * 40
            )
        ),
    )
    monkeypatch.setattr(
        eval_service,
        "_git_path_exists_at_commit",
        lambda repo_root, commit, path: not (mode == "missing_path" and path == missing_path),
    )
    monkeypatch.setattr(
        eval_service,
        "_git_diff_is_empty",
        lambda repo_root, base, commit, paths: mode != "migration",
    )
    for checkpoint in (1, 2, 3, 4, 5):
        monkeypatch.setattr(eval_service, f"_cp{checkpoint}_schema_errors", lambda document: [])
        monkeypatch.setattr(
            eval_service,
            f"_cp{checkpoint}_git_errors",
            lambda document, repo_root: [],
        )

    errors = eval_service._cp6_git_errors(result, Path("."))

    assert any(expected_error in error for error in errors)


def test_cp5_git_contract_remains_scoped_to_cp1_through_cp4(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result = _cp5_checkpoint_result(evaluated_commit="d" * 40)
    historical_checks: list[tuple[str, ...]] = []

    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda repo_root, sha: True)
    monkeypatch.setattr(eval_service, "_git_head", lambda repo_root: "d" * 40)
    monkeypatch.setattr(eval_service, "_git_is_ancestor", lambda *args: True)
    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", lambda *args: True)
    monkeypatch.setattr(eval_service, "_git_diff_is_empty", lambda *args: True)
    monkeypatch.setattr(
        eval_service,
        "_historical_checkpoint_binding_errors",
        lambda document, repo_root, checkpoints=None: (
            historical_checks.append(tuple(checkpoints or ())) or []
        ),
    )
    for checkpoint in (1, 2, 3, 4):
        monkeypatch.setattr(eval_service, f"_cp{checkpoint}_schema_errors", lambda document: [])
        monkeypatch.setattr(
            eval_service,
            f"_cp{checkpoint}_git_errors",
            lambda document, repo_root: [],
        )

    assert eval_service._cp5_git_errors(result, Path(".")) == []
    assert historical_checks == [("CP1", "CP2", "CP3", "CP4")]


def test_cp6_checkpoint_verify_rejects_template_and_accepts_bound_evidence() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    template = _cp6_source_template_result(repo_root)
    bound = _cp6_checkpoint_result(evaluated_commit="e" * 40)

    assert evaluate_verification(
        template,
        scope="checkpoint",
        checkpoint="CP6",
    ).passed is False
    assert evaluate_verification(
        bound,
        scope="checkpoint",
        checkpoint="CP6",
    ).passed is True


CP7_EXPECTED_COMMANDS = {
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

CP7_EXPECTED_EVIDENCE = {
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
        "document": "docs/product-reset/UX_EVAL_RU.md",
        "artifact_root": "artifacts/product-reset/CP7/ux",
        "minimum_total": 90,
        "minimum_category": 8,
        "required_categories": 10,
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


def _cp7_source_template_result(repo_root: Path) -> dict[str, object]:
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    result["checkpoint"] = "CP6"
    result["completed_checkpoints"] = ["CP1", "CP2", "CP3", "CP4", "CP5", "CP6"]
    result["failed_gates"] = ["CP7", "external_demo"]
    result["checkpoint_results"]["CP7"] = {
        "passed": False,
        "missing": ["command_evidence_pending"],
        "evaluated_commit": None,
        "evidence": {
            "schema_version": 1,
            **copy.deepcopy(CP7_EXPECTED_EVIDENCE),
            "ux_manifest": None,
            "operations_run": None,
            "commands": [],
        },
    }
    result["local_hard_gates_passed"] = False
    result["hard_gates_passed"] = False
    result["full_eval_passed"] = False
    result["external_demo"] = {
        "permission_status": "not_granted",
        "status": "blocked_permission",
        "app_sha": None,
    }
    return result


def _valid_cp7_operations_run(evaluated_commit: str) -> dict[str, object]:
    return {
        "run_id": f"20260724T120000Z-{evaluated_commit[:12]}-deadbeef",
        "evaluated_commit": evaluated_commit,
        "manifest_sha256": "1" * 64,
    }


def _valid_cp7_ux_manifest(evaluated_commit: str) -> dict[str, object]:
    return {
        "evaluated_commit": evaluated_commit,
        "document_path": "docs/product-reset/UX_EVAL_RU.md",
        "document_sha256": "7" * 64,
        "ux_total": 90,
        "ux_categories": {
            category_id: score
            for category_id, score in zip(
                eval_service.UX_CATEGORY_LABELS,
                (9, 10, 9, 9, 9, 9, 9, 8, 9, 9),
                strict=True,
            )
        },
        "artifacts": [
            {
                "id": f"artifact-{index}",
                "path": (
                    f"artifacts/product-reset/CP7/ux/after/artifact-{index}.png"
                ),
                "sha256": f"{index:064x}",
            }
            for index in range(1, 13)
        ],
    }


def _valid_cp7_evidence(evaluated_commit: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        **copy.deepcopy(CP7_EXPECTED_EVIDENCE),
        "ux_manifest": _valid_cp7_ux_manifest(evaluated_commit),
        "operations_run": _valid_cp7_operations_run(evaluated_commit),
        "commands": [
            {
                "id": command_id,
                "command": command,
                "expected_exit_code": 0,
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
            for command_id, command in CP7_EXPECTED_COMMANDS.items()
        ],
    }


def _cp7_checkpoint_result(repo_root: Path, evaluated_commit: str) -> dict[str, object]:
    result = _cp7_source_template_result(repo_root)
    result["commit"] = evaluated_commit
    result["checkpoint"] = "CP7"
    result["completed_checkpoints"] = [
        "CP1",
        "CP2",
        "CP3",
        "CP4",
        "CP5",
        "CP6",
        "CP7",
    ]
    result["failed_gates"] = ["external_demo"]
    result["checkpoint_results"]["CP7"] = {
        "passed": True,
        "missing": [],
        "evaluated_commit": evaluated_commit,
        "evidence": _valid_cp7_evidence(evaluated_commit),
    }
    result["local_hard_gates_passed"] = True
    result["hard_gates_passed"] = False
    result["full_eval_passed"] = False
    return result


def test_cp7_source_template_requires_exact_full_local_contract() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_source_template_result(repo_root)

    assert eval_service.CP7_REQUIRED_COMMANDS == CP7_EXPECTED_COMMANDS
    assert eval_service.CP7_REQUIRED_EVIDENCE == CP7_EXPECTED_EVIDENCE
    assert eval_service._cp7_schema_errors(
        result,
        validate_command_results=False,
    ) == []
    assert result["checkpoint_results"]["CP7"]["passed"] is False
    assert result["failed_gates"] == ["CP7", "external_demo"]
    assert result["local_hard_gates_passed"] is False
    assert result["hard_gates_passed"] is False
    assert result["full_eval_passed"] is False


def test_local_cp7_can_only_leave_external_demo_failed() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_checkpoint_result(repo_root, "e" * 40)

    assert result["local_hard_gates_passed"] is True
    assert result["hard_gates_passed"] is False
    assert result["full_eval_passed"] is False
    assert result["failed_gates"] == ["external_demo"]
    assert result["external_demo"] == {
        "permission_status": "not_granted",
        "status": "blocked_permission",
        "app_sha": None,
    }
    assert compute_full_eval_passed(result) is False


@pytest.mark.parametrize(
    ("mutation", "expected_error"),
    [
        ("missing_command", "точном порядке"),
        ("failed_command", "не подтвердил expected exit/count contract"),
        ("missing_operations", "operations_run"),
        ("wrong_external", "external_demo"),
    ],
)
def test_cp7_schema_fails_closed_on_local_gate_drift(
    mutation: str,
    expected_error: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_checkpoint_result(repo_root, "e" * 40)
    evidence = result["checkpoint_results"]["CP7"]["evidence"]
    if mutation == "missing_command":
        evidence["commands"].pop()
    elif mutation == "failed_command":
        evidence["commands"][0]["exit_code"] = 1
        evidence["commands"][0]["outcome"] = "automated_failure"
    elif mutation == "missing_operations":
        evidence["operations_run"] = None
    else:
        evidence["external_demo"]["permission_status"] = "granted"

    errors = eval_service._cp7_schema_errors(result)

    assert any(expected_error in error for error in errors)


def test_cp7_verification_rejects_manual_green_flags(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_checkpoint_result(repo_root, "e" * 40)
    result["hard_gates_passed"] = True
    result["full_eval_passed"] = True
    monkeypatch.setattr(
        eval_service,
        "_cp7_git_errors",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(eval_service, "cp7_ux_evidence_errors", lambda *_args: [])
    monkeypatch.setattr(eval_service, "cp7_operations_evidence_errors", lambda *_args: [])

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP7",
        repo_root=repo_root,
    )

    assert verification.passed is False
    assert "hard_gates_passed должен оставаться false до EXT-DEMO" in verification.errors
    assert "full_eval_passed не соответствует вычисленному финальному состоянию" in (
        verification.errors
    )


def _write_cp7_operations_artifacts(
    repo_root: Path,
    evaluated_commit: str,
) -> dict[str, object]:
    operations_root = repo_root / "artifacts/product-reset/CP7/ops"
    run_id = f"20260724T120000Z-{evaluated_commit[:12]}-deadbeef"
    run_root = operations_root / "runs" / run_id
    backup_root = run_root / "backup"
    backup_root.mkdir(parents=True)
    (operations_root / "latest-run.txt").write_text(f"{run_id}\n", encoding="utf-8")

    result = {
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
    counts = {
        "users": 8,
        "rubrics": 4,
        "stories": 35,
        "archived": 5,
        "scenarios": 35,
        "scenario_rows": 0,
    }
    smoke = {
        "health": 200,
        "root": 200,
        "unauthenticated": 401,
        "authenticated": True,
    }
    files = {
        "result.json": json.dumps(result, sort_keys=True).encode(),
        "counts-before.json": json.dumps(counts, sort_keys=True).encode(),
        "counts-after.json": json.dumps(counts, sort_keys=True).encode(),
        "smoke-before.json": json.dumps(smoke, sort_keys=True).encode(),
        "smoke-after.json": json.dumps(smoke, sort_keys=True).encode(),
        "source-preparation.log": (
            "source_root=temporary\n"
            f"tracked_commit={evaluated_commit}\n"
            "appledouble_files=0\n"
            "real_env_files=0\n"
            "secret_like_files=0\n"
        ).encode(),
    }
    for relative_path in (
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
    ):
        files[relative_path] = f"{relative_path}: passed\n".encode()
    for relative_path, content in files.items():
        (run_root / relative_path).write_bytes(content)
    backup = b"synthetic-postgres-dump"
    (backup_root / "postgres.dump").write_bytes(backup)
    backup_digest = eval_service.hashlib.sha256(backup).hexdigest()
    (backup_root / "postgres.dump.sha256").write_text(
        f"{backup_digest}  postgres.dump\n",
        encoding="utf-8",
    )
    required_files = {
        **{
            relative_path: eval_service.hashlib.sha256(content).hexdigest()
            for relative_path, content in files.items()
        },
        "backup/postgres.dump": backup_digest,
        "backup/postgres.dump.sha256": eval_service.hashlib.sha256(
            (backup_root / "postgres.dump.sha256").read_bytes()
        ).hexdigest(),
    }
    manifest = {
        "schema_version": 1,
        "run_id": run_id,
        "evaluated_commit": evaluated_commit,
        "project_name": "nn-product-reset-eval-final",
        "restore_project_name": "nn-product-reset-eval-final-restore",
        "logs_validation": "passed",
        "cleanup": "passed",
        "files": required_files,
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    (run_root / "manifest.json").write_bytes(manifest_bytes)
    return {
        "run_id": run_id,
        "evaluated_commit": evaluated_commit,
        "manifest_sha256": eval_service.hashlib.sha256(manifest_bytes).hexdigest(),
    }


def test_cp7_operations_evidence_binds_exact_source_counts_auth_and_checksum(
    tmp_path: Path,
) -> None:
    evaluated_commit = "e" * 40
    expected = _write_cp7_operations_artifacts(tmp_path, evaluated_commit)

    assert eval_service.load_cp7_operations_evidence(
        tmp_path,
        evaluated_commit=evaluated_commit,
    ) == expected

    latest = tmp_path / "artifacts/product-reset/CP7/ops/latest-run.txt"
    run_root = latest.parent / "runs" / latest.read_text(encoding="utf-8").strip()
    smoke_after = run_root / "smoke-after.json"
    smoke_after.write_text(
        json.dumps(
            {
                "health": 200,
                "root": 200,
                "unauthenticated": 401,
                "authenticated": False,
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="manifest file hash"):
        eval_service.load_cp7_operations_evidence(
            tmp_path,
            evaluated_commit=evaluated_commit,
        )


@pytest.mark.parametrize(
    "failure_line",
    [
        "backend-1  | Traceback (most recent call last):\nbackend-1  | boom\n",
        "2026-07-24 12:00:00.000 UTC [42] ERROR: database failed\n",
        "2026/07/24 12:00:00 [alert] 42#42: gateway failed\n",
        "Unhandled exception while serving request\n",
    ],
)
def test_cp7_operations_manifest_rejects_unhandled_failure_log(
    tmp_path: Path,
    failure_line: str,
) -> None:
    evaluated_commit = "e" * 40
    _write_cp7_operations_artifacts(tmp_path, evaluated_commit)
    latest = tmp_path / "artifacts/product-reset/CP7/ops/latest-run.txt"
    run_root = latest.parent / "runs" / latest.read_text(encoding="utf-8").strip()
    log_path = run_root / "application-start.log"
    log_path.write_text(failure_line, encoding="utf-8")
    manifest_path = run_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"]["application-start.log"] = eval_service.hashlib.sha256(
        log_path.read_bytes()
    ).hexdigest()
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="unhandled failure marker"):
        eval_service.load_cp7_operations_evidence(
            tmp_path,
            evaluated_commit=evaluated_commit,
        )


def test_cp7_operations_cleanup_fails_closed_on_leftover_resources(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evaluated_commit = "e" * 40
    _write_cp7_operations_artifacts(tmp_path, evaluated_commit)

    def fake_run(command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
        output = "leftover-volume\n" if command[1:3] == ["volume", "ls"] else ""
        return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")

    monkeypatch.setattr(eval_service.subprocess, "run", fake_run)

    with pytest.raises(ValueError, match="cleanup оставил volumes"):
        eval_service.load_cp7_operations_evidence(
            tmp_path,
            evaluated_commit=evaluated_commit,
            check_cleanup=True,
        )


@pytest.mark.parametrize("mutation", ["pointer_symlink", "file_symlink", "extra_file"])
def test_cp7_operations_evidence_rejects_symlink_and_extra_files(
    tmp_path: Path,
    mutation: str,
) -> None:
    evaluated_commit = "e" * 40
    _write_cp7_operations_artifacts(tmp_path, evaluated_commit)
    operations_root = tmp_path / "artifacts/product-reset/CP7/ops"
    pointer = operations_root / "latest-run.txt"
    run_id = pointer.read_text(encoding="utf-8").strip()
    run_root = operations_root / "runs" / run_id
    if mutation == "pointer_symlink":
        pointer_copy = tmp_path / "latest-run-copy.txt"
        pointer_copy.write_text(f"{run_id}\n", encoding="utf-8")
        pointer.unlink()
        pointer.symlink_to(pointer_copy)
    elif mutation == "file_symlink":
        result_path = run_root / "result.json"
        result_copy = tmp_path / "result-copy.json"
        result_copy.write_bytes(result_path.read_bytes())
        result_path.unlink()
        result_path.symlink_to(result_copy)
    else:
        (run_root / "unexpected.log").write_text("passed\n", encoding="utf-8")

    with pytest.raises(ValueError, match="symbolic|символ|exact regular-file set"):
        eval_service.load_cp7_operations_evidence(
            tmp_path,
            evaluated_commit=evaluated_commit,
        )


@pytest.mark.parametrize("mutation", ["root_symlink", "parent_symlink"])
def test_cp7_operations_evidence_rejects_symlinked_root_or_parent(
    tmp_path: Path,
    mutation: str,
) -> None:
    evaluated_commit = "e" * 40
    _write_cp7_operations_artifacts(tmp_path, evaluated_commit)
    operations_root = tmp_path / "artifacts/product-reset/CP7/ops"
    if mutation == "root_symlink":
        relocated = tmp_path / "relocated-ops"
        operations_root.rename(relocated)
        operations_root.symlink_to(relocated, target_is_directory=True)
    else:
        parent = operations_root.parent
        relocated = tmp_path / "relocated-cp7"
        parent.rename(relocated)
        parent.symlink_to(relocated, target_is_directory=True)

    with pytest.raises(ValueError, match="символическ"):
        eval_service.load_cp7_operations_evidence(
            tmp_path,
            evaluated_commit=evaluated_commit,
        )


def test_cp7_runner_owns_exact_commands_and_computes_local_only_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_root = Path(__file__).resolve().parents[2]
    result_path = tmp_path / "docs/product-reset/EVAL_RESULT.json"
    result_path.parent.mkdir(parents=True)
    result_path.write_text(
        json.dumps(_cp7_source_template_result(source_root), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    evaluated_commit = "e" * 40
    calls: list[tuple[str, str]] = []

    def executor(
        repo_root: Path,
        command_spec: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        command_id = str(command_spec["id"])
        command = str(command_spec["command"])
        calls.append((command_id, command))
        if command_id == "frontend-clean-npm-ci":
            output = "added 321 packages"
        elif command_id == "frontend-production-build":
            output = "155 modules transformed"
        elif command_id.startswith("browser-"):
            output = "25 passed"
        elif command_id == "backend-full-suite":
            output = "700 passed"
        elif command_id == "frontend-full-suite":
            output = "Tests 118 passed"
        else:
            output = "OK"
        return subprocess.CompletedProcess(
            ["sh", "-lc", command],
            0,
            stdout=output,
            stderr="",
        )

    ux_document = {
        "ux_total": 90,
        "categories": {
            category_id: {"score": score}
            for category_id, score in zip(
                eval_service.UX_CATEGORY_LABELS,
                (9, 10, 9, 9, 9, 9, 9, 8, 9, 9),
                strict=True,
            )
        },
    }
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda _root: set())
    monkeypatch.setattr(eval_service, "_git_head", lambda _root: evaluated_commit)
    monkeypatch.setattr(
        eval_service,
        "load_ux_eval_evidence",
        lambda *_args, **_kwargs: ux_document,
    )
    monkeypatch.setattr(
        eval_service,
        "load_cp7_operations_evidence",
        lambda *_args, **_kwargs: _valid_cp7_operations_run(evaluated_commit),
    )
    monkeypatch.setattr(
        eval_service,
        "build_cp7_ux_manifest",
        lambda *_args, **_kwargs: _valid_cp7_ux_manifest(evaluated_commit),
    )
    monkeypatch.setattr(eval_service, "cp7_ux_evidence_errors", lambda *_args: [])
    monkeypatch.setattr(eval_service, "cp7_operations_evidence_errors", lambda *_args: [])
    monkeypatch.setattr(
        eval_service,
        "_cp7_git_errors",
        lambda *_args, **_kwargs: [],
    )

    bound = run_checkpoint(tmp_path, "CP7", command_executor=executor)

    assert calls == list(CP7_EXPECTED_COMMANDS.items())
    assert bound["checkpoint_results"]["CP7"]["passed"] is True
    assert bound["checkpoint_results"]["CP7"]["evaluated_commit"] == evaluated_commit
    assert bound["completed_checkpoints"] == [
        "CP1",
        "CP2",
        "CP3",
        "CP4",
        "CP5",
        "CP6",
        "CP7",
    ]
    assert bound["failed_gates"] == ["external_demo"]
    assert bound["local_hard_gates_passed"] is True
    assert bound["hard_gates_passed"] is False
    assert bound["full_eval_passed"] is False


def test_cp7_production_registry_pins_exact_cp6_subtree() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    result["checkpoint_results"]["CP6"]["evidence"]["commands"][0][
        "reproducibility"
    ]["summary"] = "успешно; количество=571"

    errors = eval_service._historical_checkpoint_binding_errors(
        result,
        repo_root,
        ("CP6",),
    )

    assert errors == ["CP6 evidence не совпадает с pinned binding"]


@pytest.mark.parametrize(
    ("mode", "expected_error"),
    [
        ("unavailable", "CP6 pinned binding commit недоступен"),
        ("invalid_json", "CP6 pinned binding evidence содержит невалидный JSON"),
        ("missing_subtree", "CP6 subtree отсутствует в pinned binding evidence"),
    ],
)
def test_cp7_cp6_binding_fails_closed_when_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    expected_error: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )
    if mode == "unavailable":
        monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: False)
    elif mode == "invalid_json":
        monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: True)
        monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: "{")
    else:
        monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: True)
        monkeypatch.setattr(
            eval_service,
            "_git_file_at_commit",
            lambda *_args: json.dumps({"checkpoint_results": {}}),
        )

    errors = eval_service._historical_checkpoint_binding_errors(
        result,
        repo_root,
        ("CP6",),
    )

    assert any(expected_error in error for error in errors)


def test_cp7_requires_cp6_binding_ancestry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_checkpoint_result(repo_root, "e" * 40)
    cp6_binding = HISTORICAL_BINDING_COMMITS["CP6"]
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_git_head", lambda *_args: "e" * 40)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda _root, ancestor, descendant: not (
            ancestor == cp6_binding and descendant == "e" * 40
        ),
    )
    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_cp6_schema_errors", lambda *_args: [])
    monkeypatch.setattr(eval_service, "_cp6_git_errors", lambda *_args: [])
    monkeypatch.setattr(
        eval_service,
        "_git_changed_paths",
        lambda *_args: {"docs/product-reset/EVAL_RESULT.json"},
    )

    errors = eval_service._cp7_git_errors(result, repo_root)

    assert "CP6 pinned binding commit не является предком CP7 evaluated_commit" in errors


def test_tracked_eval_result_is_bound_to_cp7_evidence_commit() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = json.loads(
        (repo_root / "docs/product-reset/EVAL_RESULT.json").read_text(encoding="utf-8")
    )

    assert (
        eval_service.CP7_BINDING_COMMIT
        == "2194f5986146c3677bc7da794683bf00d164ae30"
    )
    assert result["checkpoint"] == "CP7"
    assert result["local_hard_gates_passed"] is True
    assert result["failed_gates"] == ["external_demo"]
    assert eval_service._cp7_binding_subtree_errors(result, repo_root) == []


def test_cp7_green_document_checkpoint_verify_passes_after_binding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_checkpoint_result(repo_root, "e" * 40)
    monkeypatch.setattr(eval_service, "cp7_ux_evidence_errors", lambda *_args: [])
    monkeypatch.setattr(eval_service, "cp7_operations_evidence_errors", lambda *_args: [])
    monkeypatch.setattr(
        eval_service,
        "_cp7_git_errors",
        lambda *_args, **_kwargs: [],
    )

    verification = evaluate_verification(
        result,
        scope="checkpoint",
        checkpoint="CP7",
        repo_root=repo_root,
    )

    assert verification.passed is True
    assert verification.errors == ()


@pytest.mark.parametrize(
    ("mode", "expected_error"),
    [
        ("unavailable", "CP7 binding commit недоступен"),
        ("blob", "CP7 binding evidence недоступен"),
        ("invalid", "CP7 binding evidence содержит невалидный JSON"),
        ("nonobject", "CP7 binding evidence должен быть JSON-объектом"),
        ("missing", "CP7 subtree отсутствует в binding evidence"),
        ("mutated", "CP7 evidence не совпадает с exact binding subtree"),
    ],
)
def test_cp7_binding_fails_closed_on_unavailable_or_mutated_subtree(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    expected_error: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_checkpoint_result(repo_root, "e" * 40)
    binding_commit = "b" * 40
    monkeypatch.setattr(eval_service, "CP7_BINDING_COMMIT", binding_commit)
    monkeypatch.setattr(eval_service, "_git_head", lambda *_args: "f" * 40)
    monkeypatch.setattr(eval_service, "_git_is_ancestor", lambda *_args: True)
    if mode == "unavailable":
        monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: False)
    else:
        monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: True)
        if mode == "blob":
            payload: str | None = None
        elif mode == "invalid":
            payload = "{"
        elif mode == "nonobject":
            payload = "[]"
        elif mode == "missing":
            payload = json.dumps({"checkpoint_results": {}})
        else:
            pinned = copy.deepcopy(result)
            pinned["checkpoint_results"]["CP7"]["evidence"]["operations_run"][
                "manifest_sha256"
            ] = "9" * 64
            payload = json.dumps(pinned)
        monkeypatch.setattr(
            eval_service,
            "_git_file_at_commit",
            lambda *_args: payload,
        )

    errors = eval_service._cp7_binding_subtree_errors(result, repo_root)

    assert any(expected_error in error for error in errors)


@pytest.mark.parametrize(
    ("broken_edge", "expected_error"),
    [
        ("source_binding", "CP7 evaluated_commit не является предком binding commit"),
        ("binding_head", "CP7 binding commit не является предком текущего HEAD"),
    ],
)
def test_cp7_binding_requires_source_binding_head_ancestry(
    monkeypatch: pytest.MonkeyPatch,
    broken_edge: str,
    expected_error: str,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_checkpoint_result(repo_root, "e" * 40)
    binding_commit = "b" * 40
    head = "f" * 40
    monkeypatch.setattr(eval_service, "CP7_BINDING_COMMIT", binding_commit)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_git_file_at_commit", lambda *_args: json.dumps(result))
    monkeypatch.setattr(eval_service, "_git_head", lambda *_args: head)
    monkeypatch.setattr(
        eval_service,
        "_git_is_ancestor",
        lambda _root, ancestor, descendant: not (
            (broken_edge == "source_binding" and ancestor == "e" * 40 and descendant == binding_commit)
            or (broken_edge == "binding_head" and ancestor == binding_commit and descendant == head)
        ),
    )

    errors = eval_service._cp7_binding_subtree_errors(result, repo_root)

    assert expected_error in errors


@pytest.mark.parametrize("executor_raises", [False, True])
def test_cp7_runner_always_removes_sha_namespaced_backend_and_frontend_temp(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    executor_raises: bool,
) -> None:
    evaluated_commit = "e" * 40
    backend_root = tmp_path / f"newscast-product-reset-cp7-backend-{evaluated_commit}"
    frontend_root = tmp_path / f"newscast-product-reset-cp7-frontend-{evaluated_commit}"
    monkeypatch.setattr(
        eval_service,
        "_cp7_backend_temp_root",
        lambda _commit: backend_root,
    )
    monkeypatch.setattr(
        eval_service,
        "_cp7_frontend_temp_root",
        lambda _commit: frontend_root,
    )
    monkeypatch.setattr(eval_service, "_git_head", lambda _root: evaluated_commit)
    monkeypatch.setattr(eval_service, "_git_dirty_paths", lambda _root: set())
    calls = 0

    def executor(
        _repo_root: Path,
        command_spec: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        nonlocal calls
        calls += 1
        backend_root.mkdir(parents=True, exist_ok=True)
        frontend_root.mkdir(parents=True, exist_ok=True)
        if executor_raises and calls == 1:
            raise RuntimeError("synthetic launch failure")
        command_id = str(command_spec["id"])
        if command_id == "frontend-clean-npm-ci":
            output = "added 321 packages"
        elif command_id == "frontend-production-build":
            output = "155 modules transformed"
        elif command_id.startswith("browser-"):
            output = "25 passed"
        elif command_id.endswith("full-suite"):
            output = "118 passed"
        else:
            output = "OK"
        return subprocess.CompletedProcess(["sh"], 0, stdout=output, stderr="")

    records = eval_service._run_cp7_commands(
        tmp_path,
        evaluated_commit,
        executor,
    )

    assert len(records) == len(CP7_EXPECTED_COMMANDS)
    assert backend_root.exists() is False
    assert frontend_root.exists() is False
    if executor_raises:
        assert records[0]["outcome"] == "automated_failure"


def test_cp7_local_state_clears_operations_findings_only_on_success() -> None:
    success = {
        "operations_findings": ["clean rehearsal pending"],
        "local_hard_gates_passed": False,
        "hard_gates_passed": False,
        "full_eval_passed": False,
    }
    eval_service._sync_cp7_local_state(success, evidence_errors=[])
    assert success["operations_findings"] == []
    assert success["local_hard_gates_passed"] is True
    assert success["hard_gates_passed"] is False
    assert success["full_eval_passed"] is False

    failed = {
        "operations_findings": ["clean rehearsal pending"],
        "local_hard_gates_passed": False,
        "hard_gates_passed": False,
        "full_eval_passed": False,
    }
    eval_service._sync_cp7_local_state(
        failed,
        evidence_errors=["CP7 operations evidence missing"],
    )
    assert failed["operations_findings"] == ["clean rehearsal pending"]
    assert failed["local_hard_gates_passed"] is False
    assert failed["hard_gates_passed"] is False
    assert failed["full_eval_passed"] is False


def test_cp7_rejects_post_binding_runtime_drift(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    result = _cp7_checkpoint_result(repo_root, "e" * 40)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_git_head", lambda *_args: "f" * 40)
    monkeypatch.setattr(eval_service, "_git_is_ancestor", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_cp6_schema_errors", lambda *_args: [])
    monkeypatch.setattr(eval_service, "_cp6_git_errors", lambda *_args: [])
    monkeypatch.setattr(
        eval_service,
        "_historical_checkpoint_binding_errors",
        lambda *_args: [],
    )
    monkeypatch.setattr(
        eval_service,
        "_git_changed_paths",
        lambda _root, _base, target: (
            {"docs/product-reset/EVAL_RESULT.json"}
            if target == eval_service.CP7_BINDING_COMMIT
            else {"frontend/src/App.tsx"}
        ),
    )

    errors = eval_service._cp7_git_errors(
        result,
        repo_root,
        require_cp7_binding=False,
    )

    assert "CP7 post-binding drift содержит запрещённые пути: frontend/src/App.tsx" in (
        errors
    )


def test_cp7_binding_diff_must_only_contain_eval_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    evaluated_commit = "e" * 40
    binding_commit = "b" * 40
    head = "f" * 40
    result = _cp7_checkpoint_result(repo_root, evaluated_commit)
    monkeypatch.setattr(eval_service, "CP7_BINDING_COMMIT", binding_commit)
    monkeypatch.setattr(eval_service, "_git_commit_exists", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_git_head", lambda *_args: head)
    monkeypatch.setattr(eval_service, "_git_is_ancestor", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_git_path_exists_at_commit", lambda *_args: True)
    monkeypatch.setattr(eval_service, "_cp6_schema_errors", lambda *_args: [])
    monkeypatch.setattr(eval_service, "_cp6_git_errors", lambda *_args: [])
    monkeypatch.setattr(
        eval_service,
        "_historical_checkpoint_binding_errors",
        lambda *_args: [],
    )

    def changed_paths(_repo_root: Path, base: str, target: str) -> set[str]:
        if (base, target) == (evaluated_commit, binding_commit):
            return {
                "docs/product-reset/EVAL_RESULT.json",
                "frontend/src/App.tsx",
            }
        return set()

    monkeypatch.setattr(eval_service, "_git_changed_paths", changed_paths)

    errors = eval_service._cp7_git_errors(
        result,
        repo_root,
        require_cp7_binding=False,
    )

    assert any("CP7 binding diff" in error for error in errors)
