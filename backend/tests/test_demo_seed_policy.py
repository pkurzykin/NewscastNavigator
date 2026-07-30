from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest

import synthetic_data_policy as policy
from app.db.models import Story, User
from app.db.session import SessionLocal
from app.services.demo_seed import build_demo_seed_payload, seed_demo_data
from sqlalchemy import func, select


TESTS_ROOT = Path(__file__).resolve().parent
POLICY_PATH = TESTS_ROOT / "synthetic_data_policy.py"
CONTRACT_PATH = TESTS_ROOT / "fixtures/synthetic_demo_contract.json"
APPROVED_FICTIONAL_DISPLAY_NAMES = [
    "Астра",
    "Вега",
    "Искра",
    "Лира",
    "Маяк",
    "Орион",
    "Руна",
    "Сфера",
    "Такт",
    "Факел",
    "Эфир",
    "Янтарь",
]
REQUIRED_FUNCTION_SETS = [
    ["chief"],
    ["author", "chief"],
    ["author", "chief_editor"],
    ["author"],
    ["author", "proofreader"],
    ["video_editor"],
    ["designer"],
    ["operator"],
]


def test_synthetic_seed_contract_files_exist() -> None:
    missing = [
        str(path.relative_to(TESTS_ROOT))
        for path in (POLICY_PATH, CONTRACT_PATH)
        if not path.is_file()
    ]

    assert missing == []


def _contract() -> dict[str, object]:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def _valid_demo_data() -> dict[str, object]:
    contract = _contract()
    names = contract["allowed_display_names"]
    required_sets = contract["required_function_sets"]
    users = [
        {
            "id": f"synthetic-user-{index:02d}",
            "display_name": names[index],
            "position": "Сотрудник",
            "functions": functions,
            "synthetic": True,
        }
        for index, functions in enumerate(required_sets, start=0)
    ]
    stories = [
        {
            "id": f"synthetic-story-{index:02d}",
            "lifecycle": "active" if index <= 30 else "archived",
            "title": f"Синтетический сюжет {index:02d}",
            "materials": [
                {
                    "title": "Учебный материал",
                    "location": f"https://media-{index:02d}.demo.invalid/story/{index:02d}",
                }
            ],
        }
        for index in range(1, 36)
    ]
    return {
        "data_classification": "synthetic",
        "users": users,
        "stories": stories,
    }


def _validator() -> object:
    assert hasattr(policy, "validate_synthetic_demo_data"), "reusable validator is missing"
    return policy.validate_synthetic_demo_data


def test_fixture_is_a_contract_not_a_runtime_seed() -> None:
    contract = _contract()

    assert contract["schema_version"] == 1
    assert contract["purpose"] == "cp2_synthetic_demo_seed_contract"
    assert contract["contract_only"] is True
    assert contract["runtime_seed"] is False
    assert contract["data_classification"] == "synthetic"
    assert "users" not in contract
    assert "stories" not in contract


def test_fixture_declares_exact_story_and_function_targets() -> None:
    contract = _contract()

    assert contract["story_targets"] == {"active": 30, "archived": 5}
    assert contract["required_function_sets"] == REQUIRED_FUNCTION_SETS
    assert contract["allowed_display_names"] == APPROVED_FICTIONAL_DISPLAY_NAMES


def test_contract_rejects_a_redefined_fictional_name_allowlist() -> None:
    contract = deepcopy(_contract())
    contract["allowed_display_names"][0] = "ПодменённыйПсевдоним"

    assert policy.validate_synthetic_demo_contract(contract) == [
        "contract.allowed_display_names: expected exact approved fictional pseudonym allowlist"
    ]


def test_contract_rejects_duplicate_required_function_combinations() -> None:
    contract = deepcopy(_contract())
    contract["required_function_sets"].append(["chief"])

    assert policy.validate_synthetic_demo_contract(contract) == [
        "contract.required_function_sets: expected exact duplicate-free required role matrix"
    ]


def test_reusable_validator_accepts_the_complete_synthetic_contract() -> None:
    validate = _validator()

    assert validate(_valid_demo_data(), _contract()) == []


def test_validator_reports_exact_story_count_with_an_actionable_path() -> None:
    data = _valid_demo_data()
    data["stories"].pop()

    assert _validator()(data, _contract()) == ["stories.archived: expected 5, found 4"]


def test_validator_requires_every_single_and_combined_function_case() -> None:
    data = _valid_demo_data()
    data["users"] = [
        user for user in data["users"] if set(user["functions"]) != {"author", "chief"}
    ]

    assert _validator()(data, _contract()) == [
        "users.functions: missing required combination [author, chief]"
    ]


@pytest.mark.parametrize(
    "display_name",
    ["Имя Фамилия", "Имя-Фамилия", "ПодменённыйПсевдоним"],
)
def test_validator_rejects_non_curated_or_surname_like_display_names(display_name: str) -> None:
    data = _valid_demo_data()
    data["users"][0]["display_name"] = display_name

    errors = _validator()(data, _contract())

    assert errors == [
        f"users[0].display_name: {display_name!r} is not an allowed fictional single-word name"
    ]


def test_validator_rejects_real_person_markers_and_identity_fields() -> None:
    data = _valid_demo_data()
    data["users"][0]["synthetic"] = False
    data["users"][0]["profile"] = {
        "fullName": "Имя Фамилия",
        "surname": "Фамилия",
    }

    assert _validator()(data, _contract()) == [
        "users[0].profile.fullName: real-person or colleague identity field is forbidden",
        "users[0].profile.surname: real-person or colleague identity field is forbidden",
        "users[0].synthetic: expected true for every synthetic user",
    ]


def test_validator_rejects_nested_contact_fields_and_values_deterministically() -> None:
    data = _valid_demo_data()
    data["users"][0]["profile"] = {
        "contact": {"email": "fixture@example.invalid"},
        "note": "Тестовый телефон +0 (000) 000-00-00",
    }

    assert _validator()(data, _contract()) == [
        "users[0].profile.contact: contact, email, or phone field is forbidden",
        "users[0].profile.contact.email: contact, email, or phone field is forbidden",
        "users[0].profile.contact.email: email-like value is forbidden",
        "users[0].profile.note: phone-like value is forbidden",
    ]


def test_validator_cannot_bypass_contact_policy_with_compound_field_names() -> None:
    data = _valid_demo_data()
    data["users"][0]["profile"] = {
        "contactInfo": {},
        "personalEmail": None,
        "phoneNumber": None,
    }

    assert _validator()(data, _contract()) == [
        "users[0].profile.contactInfo: contact, email, or phone field is forbidden",
        "users[0].profile.personalEmail: contact, email, or phone field is forbidden",
        "users[0].profile.phoneNumber: contact, email, or phone field is forbidden",
    ]


def test_validator_finds_email_values_embedded_in_notes() -> None:
    data = _valid_demo_data()
    data["users"][0]["profile"] = {"note": "Связь: fixture@example.invalid"}

    assert _validator()(data, _contract()) == [
        "users[0].profile.note: email-like value is forbidden"
    ]


def test_validator_accepts_canonical_material_with_safe_location_and_no_url() -> None:
    data = _valid_demo_data()

    assert set(data["stories"][0]["materials"][0]) == {"title", "location"}
    assert _validator()(data, _contract()) == []


@pytest.mark.parametrize(
    ("material_location", "message"),
    [
        ("https://example.com/news", "material URL host must end with '.invalid'"),
        ("https://demo.invalid.example.com/news", "material URL host must end with '.invalid'"),
        ("not-a-url", "material location must be an absolute https URL"),
        ("file:///opt/news/video.mov", "local file URL is forbidden"),
    ],
)
def test_validator_parses_every_material_location(
    material_location: str,
    message: str,
) -> None:
    data = _valid_demo_data()
    data["stories"][0]["materials"][0]["location"] = material_location

    errors = _validator()(data, _contract())

    assert errors == [f"stories[0].materials[0].location: {message}"]


def test_validator_rejects_material_location_that_is_a_local_path() -> None:
    data = _valid_demo_data()
    data["stories"][0]["materials"][0]["location"] = "/opt/fixture/video.mov"

    assert _validator()(data, _contract()) == [
        "stories[0].materials[0].location: local filesystem path is forbidden"
    ]


def test_validator_parses_nested_material_location_and_host_fields() -> None:
    data = _valid_demo_data()
    data["stories"][0]["materials"][0]["metadata"] = {
        "originHost": "media.example.com",
        "previewLocation": "https://media.example.com/preview",
    }

    assert _validator()(data, _contract()) == [
        "stories[0].materials[0].metadata.originHost: material host must end with '.invalid'",
        "stories[0].materials[0].metadata.previewLocation: material URL host must end "
        "with '.invalid'",
    ]


def test_iso_date_and_timestamp_values_are_not_phone_like() -> None:
    assert policy._looks_like_phone("2026-07-11") is False
    assert policy._looks_like_phone("2026-07-11T12:34:56Z") is False
    assert policy._looks_like_phone("Тестовый телефон +0 (000) 000-00-00") is True


@pytest.mark.parametrize(
    "local_path",
    [
        "/opt/fixture/video.mov",
        "/Volumes/Fixture/video.mov",
        r"\\fixture-host\fixture-share\video.mov",
        r"X:\Fixture\video.mov",
        "/home/fixture/video.mov",
        "~/Fixture/video.mov",
        "../Fixture/video.mov",
    ],
)
def test_validator_rejects_local_paths_stored_in_global_url_fields(local_path: str) -> None:
    data = _valid_demo_data()
    data["stories"][0]["metadata"] = {"asset": {"url": local_path}}

    assert _validator()(data, _contract()) == [
        "stories[0].metadata.asset.url: local filesystem path is forbidden"
    ]


def test_actual_demo_seed_payload_satisfies_cp1_reusable_policy() -> None:
    payload = build_demo_seed_payload()

    assert policy.validate_synthetic_demo_data(payload, _contract()) == []
    assert len([story for story in payload["stories"] if story["lifecycle"] == "active"]) == 30
    assert len([story for story in payload["stories"] if story["lifecycle"] == "archived"]) == 5


def test_actual_demo_seed_persists_exact_counts_and_is_idempotent() -> None:
    with SessionLocal() as db:
        seed_demo_data(db)
        seed_demo_data(db)
        assert db.scalar(select(func.count(User.id))) == 8
        assert db.scalar(select(func.count(Story.id)).where(Story.archived_at.is_(None))) == 30
        assert db.scalar(select(func.count(Story.id)).where(Story.archived_at.is_not(None))) == 5
        archived_without_air = db.scalar(
            select(func.count(Story.id)).where(
                Story.archived_at.is_not(None), Story.aired_at.is_(None)
            )
        )
        assert archived_without_air == 0


@pytest.mark.parametrize(
    "local_path",
    [
        r"\\server\share\video.mov",
        r"C:\News\video.mov",
        "D:/News/video.mov",
        "/Volumes/News/video.mov",
        "/opt/newscast/video.mov",
        "/Users/editor/video.mov",
        "/home/editor/video.mov",
        "~/News/video.mov",
        "../News/video.mov",
    ],
)
def test_validator_rejects_local_paths_at_any_nested_location(local_path: str) -> None:
    data = _valid_demo_data()
    data["stories"][0]["metadata"] = {"delivery": {"source": local_path}}

    errors = _validator()(data, _contract())

    assert errors == ["stories[0].metadata.delivery.source: local filesystem path is forbidden"]
