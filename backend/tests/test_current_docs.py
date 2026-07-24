from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]

CURRENT_DOCS = (
    "README.md",
    "backend/README.md",
    "deploy/README.md",
    "docs/README_RU.md",
    "docs/ARCHITECTURE_RU.md",
    "docs/CAPTIONPANELS_CONTRACT_RU.md",
    "docs/DEPLOYMENT_UBUNTU_RU.md",
    "docs/ENGINEERING_PLAN_RU.md",
    "docs/GIT_WORKFLOW_RU.md",
    "docs/LOCAL_DEV_WORKFLOW_RU.md",
    "docs/THIRD_PARTY_NOTICES.md",
    "docs/WEB_SMOKE_CHECKLIST_RU.md",
    "docs/product-reset/DEMO_RUNBOOK_RU.md",
)

REMOVED_DOCS = (
    "docs/LEGACY_DATA_MIGRATION_RU.md",
    "docs/PROJECT_WORKFLOW_ARCHITECTURE_RU.md",
    "docs/STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md",
    "docs/contracts/INTEGRATION_ROADMAP_RU.md",
    "docs/contracts/STORY_EXCHANGE_RFC_RU.md",
)

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
    assert not any((REPO_ROOT / "docs/superpowers/plans").glob("*"))
    assert not any((REPO_ROOT / "docs/superpowers/specs").glob("*"))


def test_current_docs_describe_only_the_product_reset_runtime() -> None:
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
    assert "Финальная сверка Commit 7.4" in operations_inventory
    assert "docs/PROJECT_WORKFLOW_ARCHITECTURE_RU.md" in denylist
    assert "docs/contracts/" in denylist
    assert "docs/superpowers/" in denylist
