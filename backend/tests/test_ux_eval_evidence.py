from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

from app.services import product_reset_eval as eval_service


REPO_ROOT = Path(__file__).resolve().parents[2]


def _artifact(
    artifact_id: str,
    *,
    kind: str,
    phase: str,
    viewport: str,
    surface: str,
) -> dict[str, object]:
    suffix = "json" if kind == "axe_json" else "png"
    content = f"{artifact_id}\n".encode()
    return {
        "id": artifact_id,
        "kind": kind,
        "phase": phase,
        "viewport": viewport,
        "surface": surface,
        "path": f"artifacts/product-reset/CP7/ux/{phase}/{artifact_id}.{suffix}",
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def _valid_document() -> dict[str, object]:
    artifacts: list[dict[str, object]] = []
    for phase in ("before", "after"):
        for surface in ("stories", "production"):
            for project, viewport in (
                ("chromium-1366", "1366x768"),
                ("chromium-1920", "1920x1080"),
            ):
                artifacts.append(
                    _artifact(
                        f"{phase}-{surface}-{project}",
                        kind="screenshot",
                        phase=phase,
                        viewport=viewport,
                        surface=surface,
                    )
                )
    for surface in ("stories", "production", "notifications", "dialog"):
        artifacts.append(
            _artifact(
                f"axe-{surface}-chromium-1366",
                kind="axe_json",
                phase="axe",
                viewport="1366x768",
                surface=surface,
            )
        )

    after_screen_ids = [
        str(item["id"])
        for item in artifacts
        if item["kind"] == "screenshot" and item["phase"] == "after"
    ]
    categories = {
        category_id: {
            "label": label,
            "score": 9,
            "rationale": f"Проверено по экрану {label.lower()} и browser hard gate.",
            "screens": [after_screen_ids[index % len(after_screen_ids)]],
        }
        for index, (category_id, label) in enumerate(eval_service.UX_CATEGORY_LABELS.items())
    }
    before_ids = [
        str(item["id"])
        for item in artifacts
        if item["kind"] == "screenshot" and item["phase"] == "before"
    ]
    return {
        "schema_version": 1,
        "ux_total": 90,
        "categories": categories,
        "artifacts": artifacts,
        "defects": [
            {
                "id": "UX-01",
                "status": "fixed",
                "description": "Личный блок занимал лишнюю высоту на ноутбуке.",
                "before_artifact": before_ids[0],
                "after_artifact": after_screen_ids[0],
            }
        ],
        "visual_iteration": {
            "before_summary": "Проверен принятый экран Editorial Air до UX hard gate.",
            "changes": ["Уплотнена личная очередь и закреплён один главный action."],
            "after_summary": "Шесть строк и общий список остаются видимыми на 1366x768.",
        },
        "comparison": {
            "summary": "После итерации список занимает главное пространство на обоих viewport.",
            "before_artifacts": before_ids,
            "after_artifacts": after_screen_ids,
        },
    }


def _write_markdown(repo_root: Path, document: dict[str, object]) -> None:
    target = repo_root / eval_service.UX_EVAL_RELATIVE_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "# UX eval\n\n"
        "<!-- UX_EVAL_MACHINE_READABLE_BEGIN -->\n"
        "```json\n"
        f"{json.dumps(document, ensure_ascii=False, indent=2)}\n"
        "```\n"
        "<!-- UX_EVAL_MACHINE_READABLE_END -->\n",
        encoding="utf-8",
    )


def _write_artifacts(repo_root: Path, document: dict[str, object]) -> None:
    for item in document["artifacts"]:
        path = repo_root / str(item["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f"{item['id']}\n".encode())


def test_tracked_ux_eval_has_exact_categories_and_source_contract() -> None:
    document = eval_service.load_ux_eval_evidence(
        REPO_ROOT,
        require_artifacts=False,
    )

    assert list(document["categories"]) == list(eval_service.UX_CATEGORY_LABELS)
    assert eval_service.validate_ux_eval_document(
        document,
        repo_root=REPO_ROOT,
        require_artifacts=False,
    ) == []


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("missing_category", "точные 10 категорий"),
        ("unknown_category", "точные 10 категорий"),
        ("wrong_label", "label"),
        ("bool_score", "целым числом"),
        ("float_score", "целым числом"),
        ("score_above_ten", "от 0 до 10"),
        ("score_below_eight", "не ниже 8"),
        ("empty_rationale", "обоснование"),
        ("missing_screen", "after screenshot"),
        ("wrong_total", "сумме категорий"),
        ("total_below_ninety", "не ниже 90"),
    ],
)
def test_ux_contract_fails_closed_on_category_and_score_drift(
    mutation: str,
    expected: str,
) -> None:
    document = _valid_document()
    categories = document["categories"]
    first_id = next(iter(categories))

    if mutation == "missing_category":
        categories.pop(first_id)
    elif mutation == "unknown_category":
        categories["unknown"] = categories.pop(first_id)
    elif mutation == "wrong_label":
        categories[first_id]["label"] = "Неизвестная категория"
    elif mutation == "bool_score":
        categories[first_id]["score"] = True
    elif mutation == "float_score":
        categories[first_id]["score"] = 9.0
    elif mutation == "score_above_ten":
        categories[first_id]["score"] = 11
        document["ux_total"] = 92
    elif mutation == "score_below_eight":
        categories[first_id]["score"] = 7
        document["ux_total"] = 88
    elif mutation == "empty_rationale":
        categories[first_id]["rationale"] = " "
    elif mutation == "missing_screen":
        categories[first_id]["screens"] = []
    elif mutation == "wrong_total":
        document["ux_total"] = 91
    elif mutation == "total_below_ninety":
        for category in categories.values():
            category["score"] = 8
        document["ux_total"] = 80

    errors = eval_service.validate_ux_eval_document(document)

    assert any(expected in error for error in errors)


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("path_escape", "внутри artifacts/product-reset/CP7/ux"),
        ("absolute_path", "относительным"),
        ("bad_hash", "SHA256"),
        ("missing_before", "полный before/after screenshot matrix"),
        ("missing_axe", "полный axe surface matrix"),
        ("duplicate_id", "уникальными"),
        ("unknown_screen", "неизвестный artifact"),
        ("wrong_screen_phase", "after screenshot"),
        ("missing_defect", "список недостатков"),
        ("missing_iteration", "visual_iteration"),
        ("missing_comparison", "comparison"),
    ],
)
def test_ux_contract_fails_closed_on_manifest_and_rationale_drift(
    mutation: str,
    expected: str,
) -> None:
    document = _valid_document()
    artifacts = document["artifacts"]
    first_category = next(iter(document["categories"].values()))

    if mutation == "path_escape":
        artifacts[0]["path"] = "artifacts/product-reset/CP7/ux/before/../../secret.png"
    elif mutation == "absolute_path":
        artifacts[0]["path"] = "/tmp/evidence.png"
    elif mutation == "bad_hash":
        artifacts[0]["sha256"] = "0"
    elif mutation == "missing_before":
        artifacts.pop(0)
    elif mutation == "missing_axe":
        artifacts.pop()
    elif mutation == "duplicate_id":
        artifacts[1]["id"] = artifacts[0]["id"]
    elif mutation == "unknown_screen":
        first_category["screens"] = ["missing"]
    elif mutation == "wrong_screen_phase":
        first_category["screens"] = [artifacts[0]["id"]]
    elif mutation == "missing_defect":
        document["defects"] = []
    elif mutation == "missing_iteration":
        document["visual_iteration"] = {}
    elif mutation == "missing_comparison":
        document["comparison"] = {}

    errors = eval_service.validate_ux_eval_document(document)

    assert any(expected in error for error in errors)


def test_boundary_mode_requires_artifacts_and_exact_hashes(tmp_path: Path) -> None:
    document = _valid_document()
    _write_markdown(tmp_path, document)

    with pytest.raises(ValueError, match="artifact отсутствует"):
        eval_service.load_ux_eval_evidence(tmp_path, require_artifacts=True)

    _write_artifacts(tmp_path, document)
    loaded = eval_service.load_ux_eval_evidence(tmp_path, require_artifacts=True)
    assert loaded["ux_total"] == 90

    first = tmp_path / str(document["artifacts"][0]["path"])
    first.write_text("tampered\n", encoding="utf-8")
    with pytest.raises(ValueError, match="SHA256 не совпадает"):
        eval_service.load_ux_eval_evidence(tmp_path, require_artifacts=True)


def test_eval_result_must_match_ux_document_exactly() -> None:
    document = _valid_document()
    result = {
        "ux_total": 90,
        "ux_categories": {
            category_id: category["score"]
            for category_id, category in document["categories"].items()
        },
    }
    assert eval_service.ux_eval_result_alignment_errors(result, document) == []

    result["ux_categories"]["overall_hierarchy"] = 8
    assert eval_service.ux_eval_result_alignment_errors(result, document) == [
        "ux_categories не совпадает с UX_EVAL_RU.md"
    ]


def test_cp7_evaluator_boundary_binds_document_result_and_local_artifacts(
    tmp_path: Path,
) -> None:
    document = _valid_document()
    _write_markdown(tmp_path, document)
    _write_artifacts(tmp_path, document)
    evaluated_commit = "e" * 40
    result = {
        "ux_total": 90,
        "ux_categories": {
            category_id: category["score"]
            for category_id, category in document["categories"].items()
        },
        "checkpoint_results": {
            "CP7": {
                "evaluated_commit": evaluated_commit,
                "evidence": {
                    "ux_manifest": eval_service.build_cp7_ux_manifest(
                        tmp_path,
                        evaluated_commit=evaluated_commit,
                    )
                },
            }
        },
    }

    assert eval_service.cp7_ux_evidence_errors(result, tmp_path) == []

    result["ux_total"] = 91
    assert eval_service.cp7_ux_evidence_errors(result, tmp_path) == [
        "ux_total не совпадает с UX_EVAL_RU.md"
    ]


def test_cp7_ux_manifest_binds_document_and_every_required_artifact(
    tmp_path: Path,
) -> None:
    document = _valid_document()
    _write_markdown(tmp_path, document)
    _write_artifacts(tmp_path, document)
    evaluated_commit = "e" * 40

    manifest = eval_service.build_cp7_ux_manifest(
        tmp_path,
        evaluated_commit=evaluated_commit,
    )

    assert manifest["evaluated_commit"] == evaluated_commit
    assert manifest["document_path"] == eval_service.UX_EVAL_RELATIVE_PATH
    assert manifest["document_sha256"] == hashlib.sha256(
        (tmp_path / eval_service.UX_EVAL_RELATIVE_PATH).read_bytes()
    ).hexdigest()
    assert manifest["ux_total"] == 90
    assert manifest["ux_categories"] == {
        category_id: 9 for category_id in eval_service.UX_CATEGORY_LABELS
    }
    assert manifest["artifacts"] == [
        {
            "id": item["id"],
            "path": item["path"],
            "sha256": item["sha256"],
        }
        for item in document["artifacts"]
    ]


def test_cp7_ux_manifest_fails_closed_on_score_document_and_artifact_mutation(
    tmp_path: Path,
) -> None:
    document = _valid_document()
    _write_markdown(tmp_path, document)
    _write_artifacts(tmp_path, document)
    evaluated_commit = "e" * 40
    manifest = eval_service.build_cp7_ux_manifest(
        tmp_path,
        evaluated_commit=evaluated_commit,
    )
    result = {
        "ux_total": 90,
        "ux_categories": {
            category_id: 9 for category_id in eval_service.UX_CATEGORY_LABELS
        },
        "checkpoint_results": {
            "CP7": {
                "evaluated_commit": evaluated_commit,
                "evidence": {"ux_manifest": manifest},
            }
        },
    }

    assert eval_service.cp7_ux_evidence_errors(result, tmp_path) == []

    result["ux_total"] = 91
    assert "ux_total" in " ".join(
        eval_service.cp7_ux_evidence_errors(result, tmp_path)
    )
    result["ux_total"] = 90

    markdown_path = tmp_path / eval_service.UX_EVAL_RELATIVE_PATH
    markdown_path.write_text(
        markdown_path.read_text(encoding="utf-8").replace(
            "Проверено по экрану",
            "Повторно проверено по экрану",
            1,
        ),
        encoding="utf-8",
    )
    assert "ux_manifest" in " ".join(
        eval_service.cp7_ux_evidence_errors(result, tmp_path)
    )

    _write_markdown(tmp_path, document)
    artifact_path = tmp_path / str(document["artifacts"][0]["path"])
    artifact_path.write_text("tampered\n", encoding="utf-8")
    assert "SHA256" in " ".join(
        eval_service.cp7_ux_evidence_errors(result, tmp_path)
    )


def test_ux_boundary_rejects_symlinked_document_and_artifact(
    tmp_path: Path,
) -> None:
    document = _valid_document()
    _write_markdown(tmp_path, document)
    _write_artifacts(tmp_path, document)
    artifact_path = tmp_path / str(document["artifacts"][0]["path"])
    artifact_copy = tmp_path / "artifact-copy.png"
    artifact_copy.write_bytes(artifact_path.read_bytes())
    artifact_path.unlink()
    artifact_path.symlink_to(artifact_copy)

    with pytest.raises(ValueError, match="символической ссылкой"):
        eval_service.load_ux_eval_evidence(tmp_path, require_artifacts=True)

    artifact_path.unlink()
    artifact_path.write_bytes(artifact_copy.read_bytes())
    document_path = tmp_path / eval_service.UX_EVAL_RELATIVE_PATH
    document_copy = tmp_path / "ux-eval-copy.md"
    document_copy.write_bytes(document_path.read_bytes())
    document_path.unlink()
    document_path.symlink_to(document_copy)

    with pytest.raises(ValueError, match="символической ссылкой"):
        eval_service.load_ux_eval_evidence(tmp_path, require_artifacts=True)


@pytest.mark.parametrize("mutation", ["root_symlink", "parent_symlink"])
def test_ux_boundary_rejects_symlinked_artifact_root_or_parent(
    tmp_path: Path,
    mutation: str,
) -> None:
    document = _valid_document()
    _write_markdown(tmp_path, document)
    _write_artifacts(tmp_path, document)
    artifact_root = tmp_path / str(eval_service.UX_ARTIFACT_ROOT)
    if mutation == "root_symlink":
        relocated = tmp_path / "relocated-ux"
        artifact_root.rename(relocated)
        artifact_root.symlink_to(relocated, target_is_directory=True)
    else:
        parent = artifact_root.parent
        relocated = tmp_path / "relocated-cp7"
        parent.rename(relocated)
        parent.symlink_to(relocated, target_is_directory=True)

    with pytest.raises(ValueError, match="символическ"):
        eval_service.load_ux_eval_evidence(tmp_path, require_artifacts=True)


@pytest.mark.parametrize("mutation", ["extra_file", "extra_directory"])
def test_ux_boundary_rejects_unexpected_filesystem_entries(
    tmp_path: Path,
    mutation: str,
) -> None:
    document = _valid_document()
    _write_markdown(tmp_path, document)
    _write_artifacts(tmp_path, document)
    artifact_root = tmp_path / str(eval_service.UX_ARTIFACT_ROOT)
    if mutation == "extra_file":
        (artifact_root / "unexpected.txt").write_text("unexpected\n", encoding="utf-8")
        expected = "exact regular-file set"
    else:
        (artifact_root / "unexpected").mkdir()
        expected = "неожиданные каталоги"

    with pytest.raises(ValueError, match=expected):
        eval_service.load_ux_eval_evidence(tmp_path, require_artifacts=True)
