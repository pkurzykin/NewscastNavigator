from __future__ import annotations

from copy import deepcopy
import importlib

import pytest
from sqlalchemy import func, select

from app.db.models import (
    ExternalApprovalCycle,
    Scenario,
    ScenarioRevision,
    ScenarioRow,
    Story,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.db.session import SessionLocal


def _validation_module():
    try:
        return importlib.import_module("app.services.demo_dataset_validation")
    except ModuleNotFoundError:
        pytest.fail("app.services.demo_dataset_validation is missing")


def _import_module():
    try:
        return importlib.import_module("scripts.import_demo_dataset")
    except ModuleNotFoundError:
        pytest.fail("scripts.import_demo_dataset is missing")


def _valid_dataset() -> dict[str, object]:
    return {
        "schema_version": 1,
        "data_classification": "sanitized_demo",
        "users": [
            {
                "key": "astra",
                "display_name": "Астра",
                "position": "Начальник",
                "functions": ["chief"],
            }
        ],
        "rubrics": ["Новости"],
        "stories": [
            {
                "external_id": "approved-story-001",
                "approved_for_demo": True,
                "title": "Завершённый демонстрационный сюжет",
                "rubric": "Новости",
                "author_key": "astra",
                "priority": "standard",
                "aired_at": "2026-07-20T12:00:00Z",
                "archived_at": "2026-07-20T13:00:00Z",
                "materials": [],
                "completion": {
                    "editorial_ready": True,
                    "proofread": True,
                    "video_ready": True,
                    "titles_ready": True,
                    "external_approval": "approved",
                },
                "scenario_rows": [
                    {
                        "segment_uid": "demo-segment-001",
                        "block_type": "podvodka",
                        "text": "Синтетический текст завершённого сюжета.",
                        "speaker_text": "",
                        "file_name": "",
                        "tc_in": "",
                        "tc_out": "",
                        "additional_comment": "",
                        "structured_data": {},
                        "formatting": {},
                        "rich_text": {},
                    }
                ],
            }
        ],
    }


def test_validator_accepts_sanitized_completed_dataset() -> None:
    validate = _validation_module().validate_demo_dataset

    assert validate(_valid_dataset()) == []


@pytest.mark.parametrize(
    ("mutate", "expected_fragment"),
    [
        (
            lambda data: data.update(data_classification="synthetic"),
            "data_classification",
        ),
        (
            lambda data: data["users"][0].update(display_name="Имя Фамилия"),
            "display_name",
        ),
        (
            lambda data: data["users"][0].update(contact={"email": "person@example.invalid"}),
            "contact",
        ),
        (
            lambda data: data["stories"][0].update(approved_for_demo=False),
            "approved_for_demo",
        ),
        (
            lambda data: data["stories"][0].update(archived_at=None),
            "archived_at",
        ),
        (
            lambda data: data["stories"][0]["completion"].update(
                external_approval="changes_requested"
            ),
            "external_approval",
        ),
        (
            lambda data: data["stories"][0]["scenario_rows"][0].update(
                file_name="/Volumes/newsroom/private.mov"
            ),
            "file_name",
        ),
    ],
)
def test_validator_rejects_unsanitized_or_incomplete_dataset(
    mutate,
    expected_fragment: str,
) -> None:
    data = deepcopy(_valid_dataset())
    mutate(data)

    errors = _validation_module().validate_demo_dataset(data)

    assert errors
    assert any(expected_fragment in error for error in errors)


@pytest.mark.parametrize(
    "forbidden_key",
    [
        "mail",
        "mobile",
        "telephone",
        "whatsapp",
        "colleague_id",
        "colleagueId",
        "real_name",
        "realName",
        "family_name",
        "familyName",
        "first_name",
        "patronymic",
        "telegram",
        "employee_id",
        "employeeId",
        "personal_address",
    ],
)
def test_validator_rejects_nested_identity_and_contact_keys(
    forbidden_key: str,
) -> None:
    data = deepcopy(_valid_dataset())
    row = data["stories"][0]["scenario_rows"][0]
    row["structured_data"] = {"nested": {forbidden_key: "redacted-value"}}

    errors = _validation_module().validate_demo_dataset(data)

    assert any(forbidden_key in error for error in errors)


@pytest.mark.parametrize(
    "real_path",
    [
        "/secret.mov",
        "/srv",
        "../private.mov",
        "./private.mov",
        r"C:\News\private.mov",
        "D:/News/private.mov",
        r"\\newsroom\share\private.mov",
        "/srv/newscast/private/story.mov",
        "/mnt/newsroom/story.mov",
        "~/Desktop/story.mov",
        "/var/lib/newscast/story.mov",
        "/custom/newsroom/story.mov",
    ],
)
def test_validator_rejects_nested_broad_absolute_paths(real_path: str) -> None:
    data = deepcopy(_valid_dataset())
    row = data["stories"][0]["scenario_rows"][0]
    row["structured_data"] = {"nested": [{"source": real_path}]}

    errors = _validation_module().validate_demo_dataset(data)

    assert any("path is forbidden" in error for error in errors)


def test_validator_allows_iso_timestamps_and_public_http_urls() -> None:
    data = deepcopy(_valid_dataset())
    row = data["stories"][0]["scenario_rows"][0]
    row["structured_data"] = {
        "published_at": "2026-07-20T12:00:00+03:00",
        "public_https_url": "https://example.invalid/assets/demo/story.mp4",
        "public_http_url": "http://example.invalid/assets/demo/story.mp4",
    }

    assert _validation_module().validate_demo_dataset(data) == []


def test_validation_report_is_redacted_and_does_not_copy_dataset_text() -> None:
    module = _validation_module()
    data = _valid_dataset()
    report = module.build_validation_report(data)

    assert report == {
        "schema_version": 1,
        "valid": True,
        "dataset_sha256": module.dataset_sha256(data),
        "counts": {"users": 1, "rubrics": 1, "stories": 1, "scenario_rows": 1},
        "errors": [],
    }
    assert "Синтетический текст" not in str(report)


def test_importer_creates_one_complete_archived_story_aggregate() -> None:
    importer = _import_module().import_demo_dataset
    with SessionLocal() as db:
        result = importer(db, _valid_dataset())

        assert result == {"users": 1, "rubrics": 1, "stories": 1, "scenario_rows": 1}
        story = db.scalar(select(Story))
        assert story is not None
        assert story.aired_at is not None
        assert story.archived_at is not None
        scenario = db.scalar(select(Scenario).where(Scenario.story_id == story.id))
        assert scenario is not None
        assert scenario.revision_no == 1
        assert db.scalar(
            select(func.count()).select_from(ScenarioRow).where(
                ScenarioRow.scenario_id == scenario.id
            )
        ) == 1
        assert db.scalar(
            select(func.count()).select_from(ScenarioRevision).where(
                ScenarioRevision.scenario_id == scenario.id
            )
        ) == 1
        workflow = db.get(StoryWorkflowState, story.id)
        production = db.get(StoryProductionState, story.id)
        assert workflow is not None
        assert workflow.editorial_revision == 1
        assert workflow.proofread_revision == 1
        assert production is not None
        assert production.video_ready_at is not None
        assert production.titles_ready_at is not None
        cycle = db.scalar(
            select(ExternalApprovalCycle).where(ExternalApprovalCycle.story_id == story.id)
        )
        assert cycle is not None
        assert cycle.result == "approved"
        imported_user = db.scalar(select(User).where(User.username == "demo-astra"))
        assert imported_user is not None
        assert imported_user.is_active is False


def test_importer_refuses_database_with_existing_story_without_mutation() -> None:
    importer = _import_module().import_demo_dataset
    with SessionLocal() as db:
        importer(db, _valid_dataset())
        original_story_count = db.scalar(select(func.count()).select_from(Story))

        with pytest.raises(ValueError, match="empty|пуст"):
            importer(db, _valid_dataset())

        assert db.scalar(select(func.count()).select_from(Story)) == original_story_count


def test_importer_validates_before_database_mutation() -> None:
    importer = _import_module().import_demo_dataset
    invalid = _valid_dataset()
    invalid["stories"][0]["approved_for_demo"] = False

    with SessionLocal() as db:
        with pytest.raises(ValueError, match="approved_for_demo"):
            importer(db, invalid)

        assert db.scalar(select(func.count()).select_from(User)) == 0
        assert db.scalar(select(func.count()).select_from(Story)) == 0
