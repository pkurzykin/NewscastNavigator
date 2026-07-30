"""Reusable structural policy for synthetic Product Reset demo data."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import date, datetime
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
from typing import Any
from urllib.parse import urlsplit


DEFAULT_CONTRACT_PATH = Path(__file__).resolve().parent / "fixtures/synthetic_demo_contract.json"

REQUIRED_FUNCTION_MATRIX = (
    ("chief",),
    ("author", "chief"),
    ("author", "chief_editor"),
    ("author",),
    ("author", "proofreader"),
    ("video_editor",),
    ("designer",),
    ("operator",),
)
REQUIRED_FUNCTION_SETS = {frozenset(functions) for functions in REQUIRED_FUNCTION_MATRIX}
APPROVED_FICTIONAL_DISPLAY_NAMES = (
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
)
CONTACT_KEY_PARTS = {
    "contact",
    "contacts",
    "email",
    "e-mail",
    "mail",
    "phone",
    "telephone",
    "mobile",
    "telegram",
    "whatsapp",
}
IDENTITY_KEY_PARTS = {
    "surname",
    "lastname",
    "last_name",
    "family_name",
    "first_name",
    "full_name",
    "patronymic",
    "middle_name",
    "real_name",
    "colleague_id",
    "employee_id",
    "personnel_number",
}


def load_synthetic_demo_contract(path: Path = DEFAULT_CONTRACT_PATH) -> dict[str, Any]:
    """Load the CP2 seed contract without importing runtime seed code."""

    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("synthetic demo contract must be a JSON object")
    errors = validate_synthetic_demo_contract(value)
    if errors:
        raise ValueError("invalid synthetic demo contract: " + "; ".join(errors))
    return value


def validate_synthetic_demo_contract(contract: object) -> list[str]:
    """Validate that the fixture is an immutable policy manifest, not seed data."""

    errors: list[str] = []
    if not isinstance(contract, Mapping):
        return ["contract: expected object"]

    expected_scalars = {
        "schema_version": 1,
        "purpose": "cp2_synthetic_demo_seed_contract",
        "contract_only": True,
        "runtime_seed": False,
        "data_classification": "synthetic",
    }
    for key, expected in expected_scalars.items():
        if contract.get(key) != expected:
            errors.append(f"contract.{key}: expected {expected!r}")

    for runtime_key in ("users", "stories"):
        if runtime_key in contract:
            errors.append(f"contract.{runtime_key}: runtime seed records are forbidden")

    targets = contract.get("story_targets")
    if targets != {"active": 30, "archived": 5}:
        errors.append("contract.story_targets: expected exactly 30 active and 5 archived")

    declared_matrix = contract.get("required_function_sets")
    if declared_matrix != [list(functions) for functions in REQUIRED_FUNCTION_MATRIX]:
        errors.append(
            "contract.required_function_sets: expected exact duplicate-free required role matrix"
        )

    names = contract.get("allowed_display_names")
    if names != list(APPROVED_FICTIONAL_DISPLAY_NAMES):
        errors.append(
            "contract.allowed_display_names: expected exact approved fictional pseudonym allowlist"
        )

    material_policy = contract.get("material_policy")
    if material_policy != {
        "canonical_fields": ["title", "location"],
        "allowed_schemes": ["https"],
        "required_host_suffix": ".invalid",
    }:
        errors.append("contract.material_policy: expected https URLs on .invalid hosts only")

    structural_policy = contract.get("structural_policy")
    required_structural_flags = {
        "forbid_contact_fields",
        "forbid_contact_values",
        "forbid_local_paths",
        "require_synthetic_user_marker",
        "curated_fictional_display_names_only",
    }
    if not isinstance(structural_policy, Mapping) or any(
        structural_policy.get(flag) is not True for flag in required_structural_flags
    ):
        errors.append("contract.structural_policy: every synthetic-data guard must be enabled")

    return _sorted_errors(errors)


def validate_synthetic_demo_data(data: object, contract: object | None = None) -> list[str]:
    """Return deterministic path-qualified violations for a future CP2 seed payload."""

    if contract is None:
        contract = load_synthetic_demo_contract()
    contract_errors = validate_synthetic_demo_contract(contract)
    if contract_errors:
        return [f"contract: {error}" for error in contract_errors]
    assert isinstance(contract, Mapping)

    if not isinstance(data, Mapping):
        return ["data: expected object"]

    errors: list[str] = []
    if data.get("data_classification") != "synthetic":
        errors.append("data_classification: expected 'synthetic'")

    users = data.get("users")
    if not _is_sequence(users):
        errors.append("users: expected list")
        users = []
    allowed_names = set(contract["allowed_display_names"])
    actual_function_sets: set[frozenset[str]] = set()
    for index, user in enumerate(users):
        path = f"users[{index}]"
        if not isinstance(user, Mapping):
            errors.append(f"{path}: expected object")
            continue
        display_name = user.get("display_name")
        if not _is_single_word_name(display_name) or display_name not in allowed_names:
            errors.append(
                f"{path}.display_name: {display_name!r} is not an allowed fictional "
                "single-word name"
            )
        if user.get("synthetic") is not True:
            errors.append(f"{path}.synthetic: expected true for every synthetic user")
        functions = user.get("functions")
        if _is_sequence(functions) and all(isinstance(item, str) and item for item in functions):
            actual_function_sets.add(frozenset(functions))
        else:
            errors.append(f"{path}.functions: expected non-empty string list")

    required_sets = _function_sets(contract["required_function_sets"])
    missing_sets = sorted(
        required_sets - actual_function_sets,
        key=lambda item: tuple(sorted(item)),
    )
    for missing in missing_sets:
        errors.append(
            "users.functions: missing required combination [" + ", ".join(sorted(missing)) + "]"
        )

    stories = data.get("stories")
    if not _is_sequence(stories):
        errors.append("stories: expected list")
        stories = []
    lifecycle_counts = {"active": 0, "archived": 0}
    for index, story in enumerate(stories):
        path = f"stories[{index}]"
        if not isinstance(story, Mapping):
            errors.append(f"{path}: expected object")
            continue
        lifecycle = story.get("lifecycle")
        if lifecycle in lifecycle_counts:
            lifecycle_counts[lifecycle] += 1
        else:
            errors.append(f"{path}.lifecycle: expected 'active' or 'archived'")
        _validate_materials(story.get("materials"), path, contract, errors)

    targets = contract["story_targets"]
    for lifecycle in ("active", "archived"):
        expected = targets[lifecycle]
        actual = lifecycle_counts[lifecycle]
        if actual != expected:
            errors.append(f"stories.{lifecycle}: expected {expected}, found {actual}")

    _scan_nested_values(data, "", errors)
    return _sorted_errors(errors)


def _validate_materials(
    materials: object,
    story_path: str,
    contract: Mapping[str, Any],
    errors: list[str],
) -> None:
    path = f"{story_path}.materials"
    if not _is_sequence(materials):
        errors.append(f"{path}: expected list")
        return
    for index, material in enumerate(materials):
        material_path = f"{path}[{index}]"
        if not isinstance(material, Mapping):
            errors.append(f"{material_path}: expected object")
            continue
        title = material.get("title")
        if not isinstance(title, str) or not title.strip():
            errors.append(f"{material_path}.title: expected non-empty string")
        location = material.get("location")
        location_path = f"{material_path}.location"
        if not isinstance(location, str):
            errors.append(f"{location_path}: expected string")
        else:
            _validate_material_location(location, location_path, contract, errors)
        _validate_nested_material_fields(material, material_path, contract, errors)


def _validate_nested_material_fields(
    value: object,
    path: str,
    contract: Mapping[str, Any],
    errors: list[str],
) -> None:
    if isinstance(value, Mapping):
        for key in sorted(value, key=lambda item: str(item)):
            child = value[key]
            child_path = f"{path}.{key}"
            compact_key = _compact_key(str(key))
            if compact_key in {"url", "href", "link"} or compact_key.endswith("url"):
                if isinstance(child, str):
                    _validate_material_url(child, child_path, contract, errors)
                else:
                    errors.append(f"{child_path}: expected string")
            elif compact_key == "location" or compact_key.endswith("location"):
                if isinstance(child, str):
                    _validate_material_location(child, child_path, contract, errors)
                else:
                    errors.append(f"{child_path}: expected string")
            elif compact_key == "host" or compact_key.endswith("host"):
                _validate_material_host(child, child_path, contract, errors)
            _validate_nested_material_fields(child, child_path, contract, errors)
        return
    if _is_sequence(value):
        for index, child in enumerate(value):
            _validate_nested_material_fields(child, f"{path}[{index}]", contract, errors)


def _validate_material_location(
    location: str,
    path: str,
    contract: Mapping[str, Any],
    errors: list[str],
) -> None:
    parsed = urlsplit(location)
    if parsed.scheme.casefold() == "file":
        errors.append(f"{path}: local file URL is forbidden")
        return
    if _looks_like_local_path(location):
        errors.append(f"{path}: local filesystem path is forbidden")
        return
    if parsed.scheme.casefold() not in contract["material_policy"]["allowed_schemes"]:
        errors.append(f"{path}: material location must be an absolute https URL")
        return
    _validate_material_url(location, path, contract, errors)


def _validate_material_url(
    url: str,
    path: str,
    contract: Mapping[str, Any],
    errors: list[str],
) -> None:
    parsed = urlsplit(url)
    if parsed.scheme.casefold() == "file":
        errors.append(f"{path}: local file URL is forbidden")
        return
    if _looks_like_local_path(url):
        errors.append(f"{path}: local filesystem path is forbidden")
        return
    allowed_schemes = contract["material_policy"]["allowed_schemes"]
    if parsed.scheme.casefold() not in allowed_schemes or not parsed.netloc or not parsed.hostname:
        errors.append(f"{path}: material URL must be an absolute https URL")
        return
    required_suffix = contract["material_policy"]["required_host_suffix"]
    if not parsed.hostname.casefold().endswith(required_suffix):
        errors.append(f"{path}: material URL host must end with {required_suffix!r}")


def _validate_material_host(
    host: object,
    path: str,
    contract: Mapping[str, Any],
    errors: list[str],
) -> None:
    suffix = contract["material_policy"]["required_host_suffix"]
    if (
        not isinstance(host, str)
        or not host.casefold().endswith(suffix)
        or any(character.isspace() for character in host)
        or any(character in host for character in "/\\@:")
    ):
        errors.append(f"{path}: material host must end with {suffix!r}")


def _scan_nested_values(value: object, path: str, errors: list[str]) -> None:
    if isinstance(value, Mapping):
        for key in sorted(value, key=lambda item: str(item)):
            child_path = f"{path}.{key}" if path else str(key)
            if _key_contains_token(str(key), CONTACT_KEY_PARTS):
                errors.append(f"{child_path}: contact, email, or phone field is forbidden")
            if _key_contains_token(str(key), IDENTITY_KEY_PARTS):
                errors.append(f"{child_path}: real-person or colleague identity field is forbidden")
            _scan_nested_values(value[key], child_path, errors)
        return
    if _is_sequence(value):
        for index, child in enumerate(value):
            _scan_nested_values(child, f"{path}[{index}]", errors)
        return
    if not isinstance(value, str):
        return

    if _looks_like_email(value):
        errors.append(f"{path}: email-like value is forbidden")
    if _looks_like_phone(value):
        errors.append(f"{path}: phone-like value is forbidden")
    if _looks_like_local_path(value):
        if urlsplit(value).scheme.casefold() == "file":
            errors.append(f"{path}: local file URL is forbidden")
        else:
            errors.append(f"{path}: local filesystem path is forbidden")


def _function_sets(value: object) -> set[frozenset[str]]:
    if not _is_sequence(value):
        return set()
    result: set[frozenset[str]] = set()
    for item in value:
        if _is_sequence(item) and all(isinstance(part, str) and part for part in item):
            result.add(frozenset(item))
    return result


def _key_parts(key: str) -> set[str]:
    normalized = key.casefold().replace("-", "_")
    parts = {normalized}
    parts.update(part for part in re.split(r"[^a-zа-яё0-9_]+", normalized) if part)
    parts.update(part for part in normalized.split("_") if part)
    return parts


def _compact_key(key: str) -> str:
    return "".join(character for character in key.casefold() if character.isalnum())


def _key_contains_token(key: str, forbidden_tokens: set[str]) -> bool:
    key_parts = _key_parts(key)
    compact_key = _compact_key(key)
    return bool(key_parts & forbidden_tokens) or any(
        _compact_key(token) in compact_key for token in forbidden_tokens
    )


def _is_sequence(value: object) -> bool:
    return isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray))


def _is_single_word_name(value: object) -> bool:
    return isinstance(value, str) and bool(value) and value.isalpha() and len(value.split()) == 1


def _looks_like_email(value: str) -> bool:
    boundaries = set(" \t\r\n<>()[]{};,\"'")
    for at_index, character in enumerate(value):
        if character != "@":
            continue
        start = at_index - 1
        while start >= 0 and value[start] not in boundaries:
            start -= 1
        end = at_index + 1
        while end < len(value) and value[end] not in boundaries:
            end += 1
        candidate = value[start + 1 : end].strip(".:")
        if candidate.count("@") != 1:
            continue
        local, host = candidate.split("@", maxsplit=1)
        if local and host and "." in host and not host.startswith(".") and not host.endswith("."):
            return True
    return False


def _looks_like_phone(value: str) -> bool:
    if _is_iso_date_or_timestamp(value):
        return False
    phone_characters = set("+0123456789 ()-.\u00a0")
    for start, character in enumerate(value):
        if character not in "+0123456789":
            continue
        end = start
        while end < len(value) and value[end] in phone_characters:
            end += 1
        candidate = value[start:end]
        if sum(character.isdigit() for character in candidate) >= 7:
            return True
    return False


def _is_iso_date_or_timestamp(value: str) -> bool:
    stripped = value.strip()
    try:
        if "T" in stripped:
            normalized = stripped.removesuffix("Z")
            if stripped.endswith("Z"):
                normalized += "+00:00"
            datetime.fromisoformat(normalized)
        else:
            date.fromisoformat(stripped)
    except ValueError:
        return False
    return True


def _looks_like_local_path(value: str) -> bool:
    stripped = value.strip()
    parsed = urlsplit(stripped)
    if parsed.scheme.casefold() in {"http", "https"} and parsed.netloc:
        return False
    if parsed.scheme.casefold() == "file":
        return True
    if stripped.startswith(("\\\\", "//", "~/", "~\\", "./", ".\\", "../", "..\\")):
        return True
    if PurePosixPath(stripped).is_absolute():
        return True
    return bool(PureWindowsPath(stripped).drive)


def _sorted_errors(errors: Sequence[str]) -> list[str]:
    def sort_key(message: str) -> tuple[tuple[str, ...], str]:
        path = message.split(":", maxsplit=1)[0]
        path_parts = tuple(part for part in re.split(r"[.\[]", path) if part)
        return path_parts, message

    return sorted(set(errors), key=sort_key)
