from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_cp2_removes_old_project_runtime_except_exact_temporary_bridge() -> None:
    removed_paths = {
        "backend/app/api/routes/projects.py",
        "backend/app/api/routes/revisions.py",
        "backend/app/api/routes/workspace.py",
        "backend/app/api/routes/exports.py",
        "backend/app/schemas/project.py",
        "backend/app/schemas/project_text_state.py",
        "backend/app/schemas/revisions.py",
        "backend/app/schemas/workspace.py",
        "backend/app/services/export_service.py",
    }
    removed_paths.update(
        path.relative_to(REPO_ROOT).as_posix()
        for path in (REPO_ROOT / "backend/app/services").glob("project_*.py")
    )

    assert all(not (REPO_ROOT / path).exists() for path in removed_paths)


def test_cp3_denylist_forbids_all_temporary_bridge_files() -> None:
    sections: dict[str, set[str]] = {}
    current_section: set[str] | None = None
    for raw_line in (REPO_ROOT / "docs/product-reset/LEGACY_DENYLIST.txt").read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            current_section = sections.setdefault(line[1:-1], set())
            continue
        assert current_section is not None
        current_section.add(line)

    assert sections["allowed_until_cp3"] == set()
    assert {
        "backend/app/api/routes/editor.py",
        "backend/app/schemas/editor.py",
        "frontend/src/pages/EditorPage.tsx",
        "frontend/src/features/scenario/legacyBridgeApi.ts",
        "frontend/src/features/scenario/legacyBridgeTypes.ts",
    } <= sections["forbidden_now"]


def test_cp3_runtime_has_no_bridge_identifiers() -> None:
    bridge_paths = {
        "backend/app/api/routes/editor.py",
        "backend/app/schemas/editor.py",
        "frontend/src/pages/EditorPage.tsx",
        "frontend/src/features/scenario/legacyBridgeApi.ts",
        "frontend/src/features/scenario/legacyBridgeTypes.ts",
    }
    assert all(not (REPO_ROOT / path).exists() for path in bridge_paths)
    importers = {
        path.relative_to(REPO_ROOT).as_posix()
        for path in (REPO_ROOT / "frontend/src").rglob("*.ts*")
        if not path.name.startswith("._")
        and "/__tests__/" not in path.as_posix()
        and not path.name.endswith(".test.ts")
        and not path.name.endswith(".test.tsx")
        and "legacyBridge" in path.read_text(encoding="utf-8")
    }
    assert importers == set()
