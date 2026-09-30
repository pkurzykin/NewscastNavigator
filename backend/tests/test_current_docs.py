from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]

CURRENT_DOCS = (
    "README.md",
    "backend/README.md",
    "frontend/README.md",
    "docs/DOCUMENTATION_POLICY_RU.md",
    "docs/guides/USER_GUIDE_RU.md",
    "docs/operations/HOME_TEST_WORKFLOW_RU.md",
    "deploy/README.md",
    "docs/README_RU.md",
    "docs/PROJECT_STATE_RU.md",
    "docs/engineering/PROJECT_AGENTS_RU.md",
    "docs/operations/RELEASE_WORKFLOW_RU.md",
    "docs/product/SPEC_RU.md",
    "docs/product/EVAL_RUBRIC_RU.md",
    "docs/engineering/ARCHITECTURE_RU.md",
    "docs/engineering/CAPTIONPANELS_CONTRACT_RU.md",
    "docs/operations/DEMO_DEPLOYMENT_RU.md",
    "docs/engineering/DEVELOPMENT_RU.md",
    "docs/engineering/GIT_WORKFLOW_RU.md",
    "docs/engineering/LOCAL_DEV_WORKFLOW_RU.md",
    "docs/engineering/THIRD_PARTY_NOTICES.md",
    "docs/operations/WEB_SMOKE_CHECKLIST_RU.md",
    "docs/operations/DEMO_RUNBOOK_RU.md",
)

REMOVED_DOCS = (
    "docs/LEGACY_DATA_MIGRATION_RU.md",
    "docs/PROJECT_WORKFLOW_ARCHITECTURE_RU.md",
    "docs/STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md",
    "docs/contracts/INTEGRATION_ROADMAP_RU.md",
    "docs/contracts/STORY_EXCHANGE_RFC_RU.md",
)

HISTORICAL_HOSTLAND_DOCS = {
    "docs/archive/2026-hostland-migration/plans/2026-09-20-hostland-initial-hardening.md",
    "docs/archive/2026-hostland-migration/plans/2026-09-20-hostland-os-runtime.md",
    "docs/archive/2026-hostland-migration/plans/2026-09-20-hostland-synthetic-rehearsal.md",
    "docs/archive/2026-hostland-migration/specs/2026-09-20-hostland-migration-inventory.md",
    "docs/archive/2026-hostland-migration/specs/2026-09-20-hostland-os-runtime-result.md",
    "docs/archive/2026-hostland-migration/specs/2026-09-20-hostland-production-migration-design.md",
    "docs/archive/2026-hostland-migration/specs/2026-09-20-hostland-synthetic-rehearsal-result.md",
    "docs/archive/2026-hostland-migration/specs/2026-09-23-hostland-cp4-cp5-result.md",
    "docs/archive/2026-hostland-migration/specs/2026-09-23-hostland-cp6-readiness.md",
}

REMOVED_LEGACY_PLANS = {
    "docs/superpowers/plans/2026-04-29-ui-redesign-implementation-plan.md",
    "docs/superpowers/plans/2026-05-07-ui-rescue-foundation.md",
    "docs/superpowers/plans/2026-05-08-ui-redesign-replacement-rebuild.md",
    "docs/superpowers/plans/2026-05-14-ux-product-stabilization-plan.md",
    "docs/superpowers/plans/2026-05-21-mvp-newsroom-ui-stabilization-implementation-plan.md",
    "docs/superpowers/specs/2026-04-22-docs-rebaseline-design.md",
    "docs/superpowers/specs/2026-04-22-workflow-ux-stabilization-plan.md",
    "docs/superpowers/specs/2026-04-29-ui-redesign-concept-design.md",
    "docs/superpowers/specs/2026-05-20-mvp-newsroom-design-handoff.md",
    "docs/superpowers/specs/2026-05-20-mvp-newsroom-service-design.md",
    "docs/superpowers/specs/2026-05-20-mvp-newsroom-ui-design.md",
}

FORBIDDEN_STALE_REFERENCES = (
    "bootstrap_runtime.py",
    "dev_native_backend.sh",
    "dev_native_frontend.sh",
    "import_legacy_sqlite.py",
    "setup_backend_venv.sh",
    "status_prod_stack.sh",
    "update_prod_stack.sh",
    "web-dev.env.example",
    "web-prod.env.example",
    "PROJECT_WORKFLOW_ARCHITECTURE_RU.md",
    "STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md",
    "LEGACY_DATA_MIGRATION_RU.md",
)


def test_current_document_set_exists_and_replaced_legacy_docs_are_removed() -> None:
    assert [path for path in CURRENT_DOCS if not (REPO_ROOT / path).is_file()] == []
    assert [path for path in REMOVED_DOCS if (REPO_ROOT / path).exists()] == []
    assert not any((REPO_ROOT / "docs/archive/2026-04").glob("*"))
    assert not any((REPO_ROOT / "docs/contracts").glob("*"))
    assert all(not (REPO_ROOT / path).exists() for path in REMOVED_LEGACY_PLANS)
    historical_docs = {
        path.relative_to(REPO_ROOT).as_posix()
        for path in (REPO_ROOT / "docs/archive/2026-hostland-migration").rglob("*.md")
        if path.is_file() and not path.name.startswith("._")
    }
    assert historical_docs == HISTORICAL_HOSTLAND_DOCS


def test_current_docs_describe_only_the_current_product_runtime() -> None:
    combined = "\n".join(
        (REPO_ROOT / path).read_text(encoding="utf-8")
        for path in CURRENT_DOCS
    )

    assert "Один сюжет — один актуальный сценарий" in combined
    assert "/stories/:id/scenario" in combined
    assert "deploy/compose.demo.yaml" in combined
    assert "requirements.lock" in combined

    stale = sorted(reference for reference in FORBIDDEN_STALE_REFERENCES if reference in combined)
    assert stale == []


def test_current_docs_preserve_author_notice_without_generated_legal_agreement() -> None:
    combined = "\n".join(
        (REPO_ROOT / path).read_text(encoding="utf-8")
        for path in CURRENT_DOCS
    )

    assert "Инициатор и разработчик: Павел Курзыкин" in combined
    assert "© 2026 Павел Курзыкин. Все права защищены." in combined
    assert not (REPO_ROOT / "LICENSE").exists()
    assert not (REPO_ROOT / "LICENSE.md").exists()


def test_final_inventory_and_denylist_bind_current_document_boundary() -> None:
    architecture_inventory = (
        REPO_ROOT / "docs/product-reset/ARCHITECTURE_INVENTORY_RU.md"
    ).read_text(encoding="utf-8")
    operations_inventory = (
        REPO_ROOT / "docs/product-reset/OPERATIONS_INVENTORY_RU.md"
    ).read_text(encoding="utf-8")
    denylist = (REPO_ROOT / "docs/product-reset/LEGACY_DENYLIST.txt").read_text(
        encoding="utf-8"
    )

    assert "Финальная сверка Commit 7.4" in architecture_inventory
    assert "актуальный operations inventory" in operations_inventory
    assert "docs/PROJECT_WORKFLOW_ARCHITECTURE_RU.md" in denylist
    assert "docs/contracts/" in denylist
    forbidden = denylist.split("[forbidden_now]", 1)[1].split("[allowed_until_cp3]", 1)[0]
    assert REMOVED_LEGACY_PLANS <= set(forbidden.splitlines())


def test_deployment_restore_example_is_isolated_and_uses_canonical_rehearsal() -> None:
    deployment = (REPO_ROOT / "docs/operations/DEMO_DEPLOYMENT_RU.md").read_text(
        encoding="utf-8"
    )

    assert "./deploy/scripts/backup_db.sh" in deployment
    assert 'BACKUP_DIR="${HOME}/newscast-backups/product-reset-demo"' in deployment
    assert '--output-file "$BACKUP_FILE"' in deployment
    assert deployment.index('BACKUP_DIR="${HOME}/newscast-backups/product-reset-demo"') < (
        deployment.index('BACKUP_FILE="$BACKUP_DIR/postgres.dump"')
    )
    assert deployment.index('BACKUP_FILE="$BACKUP_DIR/postgres.dump"') < (
        deployment.index('--output-file "$BACKUP_FILE"')
    )
    assert "Backup создаёт только exact dump и SHA-256 checksum." in deployment
    assert "Backup содержит exact dump, SHA-256 checksum и atomic latest pointer." not in deployment
    assert 'PROJECT_NAME="nn-product-reset-eval-' in deployment
    assert '$(date -u +%Y%m%d%H%M%S)"' in deployment
    assert "%Y%m%dT%H%M%SZ" not in deployment
    assert "--compose-file deploy/compose.demo.yaml" in deployment
    assert "--env-file deploy/env/demo.env" in deployment
    assert "up -d --wait db" in deployment
    assert "down -v --remove-orphans" in deployment
    assert "trap cleanup EXIT" in deployment
    assert "./deploy/scripts/rehearse_clean_deploy.sh" in deployment
    assert "counts comparison и authenticated smoke" in deployment


def test_operations_inventory_assigns_latest_pointer_to_rehearsal_only() -> None:
    inventory = (REPO_ROOT / "docs/product-reset/OPERATIONS_INVENTORY_RU.md").read_text(
        encoding="utf-8"
    )
    backup_row = next(
        line for line in inventory.splitlines() if "`deploy/scripts/backup_db.sh`" in line
    )
    rehearsal_row = next(
        line
        for line in inventory.splitlines()
        if "`deploy/scripts/rehearse_clean_deploy.sh`" in line
    )

    assert "exact dump, checksum" in backup_row
    assert "atomic pointer" not in backup_row
    assert "atomic latest pointer" in rehearsal_row
