from __future__ import annotations

from datetime import datetime
import hashlib
from ipaddress import ip_address
import json
from pathlib import PurePosixPath, PureWindowsPath
import re
from typing import Any
from urllib.parse import urlsplit

from app.domain.codes import FUNCTION_CODES


DATASET_SCHEMA_VERSION = 1
DATASET_CLASSIFICATION = "sanitized_demo"
BLOCK_TYPES = {"podvodka", "zk", "zk_geo", "life", "snh"}
SAFE_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SINGLE_WORD_NAME_PATTERN = re.compile(r"^[^\W\d_]+$", re.UNICODE)
EMAIL_PATTERN = re.compile(r"(?<![\w.-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?\d[\s().-]*){7,}\d(?!\d)")
URL_LIKE_PATTERN = re.compile(r"\b(?:https?|file)://[^\s]+", re.IGNORECASE)
NUMERIC_HOST_COMPONENT_PATTERN = re.compile(
    r"(?:[0-9]+|0x[0-9a-f]+)",
    re.IGNORECASE,
)
LOCAL_PATH_FRAGMENT_PATTERN = re.compile(
    r"(?:"
    r"file://|"
    r"\\\\|"
    r"(?<!\w)[A-Za-z]:[\\/]|"
    r"(?<!\w)(?:~|\.\.?)[\\/]|"
    r"(?<![\w<])/(?=[^\s/>])"
    r")",
    re.IGNORECASE,
)
FORBIDDEN_KEY_PARTS = {
    "address",
    "birthdate",
    "colleagueid",
    "contact",
    "credential",
    "email",
    "employeeid",
    "familyname",
    "firstname",
    "fullname",
    "identity",
    "lastname",
    "mail",
    "middlename",
    "mobile",
    "passport",
    "patronymic",
    "personaladdress",
    "personnelnumber",
    "phone",
    "realname",
    "secret",
    "surname",
    "password",
    "telegram",
    "telephone",
    "whatsapp",
}
USER_KEYS = {"key", "display_name", "position", "functions"}
STORY_KEYS = {
    "external_id",
    "approved_for_demo",
    "title",
    "rubric",
    "author_key",
    "priority",
    "aired_at",
    "archived_at",
    "materials",
    "completion",
    "scenario_rows",
}
COMPLETION_KEYS = {
    "editorial_ready",
    "proofread",
    "video_ready",
    "titles_ready",
    "external_approval",
}
ROW_KEYS = {
    "segment_uid",
    "block_type",
    "text",
    "speaker_text",
    "file_name",
    "tc_in",
    "tc_out",
    "additional_comment",
    "structured_data",
    "formatting",
    "rich_text",
}


def _canonical_json(payload: object) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def dataset_sha256(payload: object) -> str:
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


def _unexpected_keys(value: dict[str, Any], allowed: set[str], path: str) -> list[str]:
    return [
        f"{path}.{key}: field is not allowed in sanitized demo data"
        for key in sorted(set(value) - allowed)
    ]


def _parse_timestamp(value: object, path: str, errors: list[str]) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: required ISO-8601 timestamp")
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        errors.append(f"{path}: invalid ISO-8601 timestamp")
        return None
    if parsed.tzinfo is None:
        errors.append(f"{path}: timezone is required")
        return None
    return parsed


def _looks_like_local_path(value: str) -> bool:
    stripped = value.strip()
    try:
        parsed = urlsplit(stripped)
    except ValueError:
        return True
    if parsed.scheme.casefold() in {"http", "https"} and parsed.netloc:
        return False
    if parsed.scheme.casefold() == "file":
        return True
    relative_or_share_prefixes = (
        "\\\\",
        "//",
        "~/",
        "~\\",
        "./",
        ".\\",
        "../",
        "..\\",
    )
    if stripped.startswith(relative_or_share_prefixes):
        return True
    if PurePosixPath(stripped).is_absolute():
        return True
    return bool(PureWindowsPath(stripped).drive)


def _is_public_hostname(hostname: str) -> bool:
    normalized = hostname.casefold().rstrip(".")
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return False
    try:
        address = ip_address(normalized)
    except ValueError:
        return not all(
            NUMERIC_HOST_COMPONENT_PATTERN.fullmatch(component)
            for component in normalized.split(".")
        )
    return address.is_global and not address.is_multicast


def _without_valid_public_urls(value: str) -> tuple[str, bool, bool]:
    malformed_url = False
    non_public_url = False

    def replace(match: re.Match[str]) -> str:
        nonlocal malformed_url, non_public_url
        candidate = match.group(0)
        try:
            parsed = urlsplit(candidate)
            hostname = parsed.hostname
            _ = parsed.port
        except ValueError:
            malformed_url = True
            return candidate
        if parsed.scheme.casefold() not in {"http", "https"}:
            return candidate
        if not parsed.netloc or not hostname:
            malformed_url = True
            return candidate
        if (
            parsed.username is not None
            or parsed.password is not None
            or not _is_public_hostname(hostname)
        ):
            non_public_url = True
            return candidate
        return ""

    return URL_LIKE_PATTERN.sub(replace, value), malformed_url, non_public_url


def _contains_local_path_fragment(value: str) -> bool:
    if _looks_like_local_path(value):
        return True
    for match in LOCAL_PATH_FRAGMENT_PATTERN.finditer(value):
        candidate = value[match.start() :].split(maxsplit=1)[0]
        if _looks_like_local_path(candidate):
            return True
    return False


def _scan_forbidden_values(value: object, path: str, errors: list[str]) -> None:
    if isinstance(value, dict):
        for key in sorted(value):
            normalized_key = re.sub(r"[^a-z0-9]", "", str(key).casefold())
            if any(part in normalized_key for part in FORBIDDEN_KEY_PARTS):
                errors.append(f"{path}.{key}: identity, contact, or secret field is forbidden")
            _scan_forbidden_values(value[key], f"{path}.{key}", errors)
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _scan_forbidden_values(item, f"{path}[{index}]", errors)
        return
    if not isinstance(value, str):
        return
    if EMAIL_PATTERN.search(value):
        errors.append(f"{path}: email-like value is forbidden")
    (
        value_without_public_urls,
        malformed_url,
        non_public_url,
    ) = _without_valid_public_urls(value)
    if malformed_url:
        errors.append(f"{path}: malformed URL is forbidden")
    if non_public_url:
        errors.append(f"{path}: non-public URL is forbidden")
    field_name = path.rsplit(".", 1)[-1]
    normalized_datetime = value.strip()
    if normalized_datetime.endswith("Z"):
        normalized_datetime = normalized_datetime[:-1] + "+00:00"
    try:
        datetime.fromisoformat(normalized_datetime)
        is_iso_datetime = True
    except ValueError:
        is_iso_datetime = False
    if (
        field_name not in {"aired_at", "archived_at"}
        and not is_iso_datetime
        and PHONE_PATTERN.search(value_without_public_urls)
    ):
        errors.append(f"{path}: phone-like value is forbidden")
    if _contains_local_path_fragment(value_without_public_urls):
        errors.append(f"{path}: real or local path is forbidden")


def _validate_users(value: object, errors: list[str]) -> set[str]:
    if not isinstance(value, list) or not value:
        errors.append("users: expected a non-empty list")
        return set()
    keys: set[str] = set()
    for index, user in enumerate(value):
        path = f"users[{index}]"
        if not isinstance(user, dict):
            errors.append(f"{path}: expected object")
            continue
        errors.extend(_unexpected_keys(user, USER_KEYS, path))
        key = user.get("key")
        if not isinstance(key, str) or not SAFE_KEY_PATTERN.fullmatch(key):
            errors.append(f"{path}.key: expected lowercase sanitized key")
        elif key in keys:
            errors.append(f"{path}.key: duplicate key")
        else:
            keys.add(key)
        display_name = user.get("display_name")
        if (
            not isinstance(display_name, str)
            or not SINGLE_WORD_NAME_PATTERN.fullmatch(display_name.strip())
        ):
            errors.append(f"{path}.display_name: expected one-word pseudonym")
        position = user.get("position")
        if not isinstance(position, str) or not position.strip():
            errors.append(f"{path}.position: expected non-empty position")
        functions = user.get("functions")
        if not isinstance(functions, list) or not functions:
            errors.append(f"{path}.functions: expected non-empty list")
        elif (
            any(not isinstance(code, str) or code not in FUNCTION_CODES for code in functions)
            or len(set(functions)) != len(functions)
        ):
            errors.append(f"{path}.functions: contains unknown or duplicate function")
    return keys


def _validate_rubrics(value: object, errors: list[str]) -> set[str]:
    if not isinstance(value, list) or not value:
        errors.append("rubrics: expected a non-empty list")
        return set()
    rubrics: set[str] = set()
    for index, rubric in enumerate(value):
        if not isinstance(rubric, str) or not rubric.strip():
            errors.append(f"rubrics[{index}]: expected non-empty string")
            continue
        normalized = rubric.strip()
        if normalized in rubrics:
            errors.append(f"rubrics[{index}]: duplicate rubric")
        rubrics.add(normalized)
    return rubrics


def _validate_rows(value: object, story_path: str, errors: list[str]) -> None:
    if not isinstance(value, list) or not value:
        errors.append(f"{story_path}.scenario_rows: expected a non-empty list")
        return
    segment_uids: set[str] = set()
    for index, row in enumerate(value):
        path = f"{story_path}.scenario_rows[{index}]"
        if not isinstance(row, dict):
            errors.append(f"{path}: expected object")
            continue
        errors.extend(_unexpected_keys(row, ROW_KEYS, path))
        segment_uid = row.get("segment_uid")
        if not isinstance(segment_uid, str) or not SAFE_KEY_PATTERN.fullmatch(segment_uid):
            errors.append(f"{path}.segment_uid: expected stable sanitized identifier")
        elif segment_uid in segment_uids:
            errors.append(f"{path}.segment_uid: duplicate identifier")
        else:
            segment_uids.add(segment_uid)
        if row.get("block_type") not in BLOCK_TYPES:
            errors.append(f"{path}.block_type: unsupported block type")
        for field in (
            "text",
            "speaker_text",
            "file_name",
            "tc_in",
            "tc_out",
            "additional_comment",
        ):
            if not isinstance(row.get(field), str):
                errors.append(f"{path}.{field}: expected string")
        for field in ("structured_data", "formatting", "rich_text"):
            if not isinstance(row.get(field), dict):
                errors.append(f"{path}.{field}: expected object")


def _validate_stories(
    value: object,
    *,
    user_keys: set[str],
    rubrics: set[str],
    errors: list[str],
) -> None:
    if not isinstance(value, list) or not value:
        errors.append("stories: expected a non-empty list")
        return
    external_ids: set[str] = set()
    for index, story in enumerate(value):
        path = f"stories[{index}]"
        if not isinstance(story, dict):
            errors.append(f"{path}: expected object")
            continue
        errors.extend(_unexpected_keys(story, STORY_KEYS, path))
        external_id = story.get("external_id")
        if not isinstance(external_id, str) or not SAFE_KEY_PATTERN.fullmatch(external_id):
            errors.append(f"{path}.external_id: expected stable sanitized identifier")
        elif external_id in external_ids:
            errors.append(f"{path}.external_id: duplicate identifier")
        else:
            external_ids.add(external_id)
        if story.get("approved_for_demo") is not True:
            errors.append(f"{path}.approved_for_demo: explicit approval is required")
        if not isinstance(story.get("title"), str) or not story["title"].strip():
            errors.append(f"{path}.title: expected non-empty string")
        if story.get("rubric") not in rubrics:
            errors.append(f"{path}.rubric: unknown rubric")
        if story.get("author_key") not in user_keys:
            errors.append(f"{path}.author_key: unknown user key")
        if story.get("priority") not in {"standard", "high"}:
            errors.append(f"{path}.priority: expected standard or high")
        aired_at = _parse_timestamp(story.get("aired_at"), f"{path}.aired_at", errors)
        archived_at = _parse_timestamp(
            story.get("archived_at"),
            f"{path}.archived_at",
            errors,
        )
        if aired_at and archived_at and archived_at < aired_at:
            errors.append(f"{path}.archived_at: must not precede aired_at")
        if story.get("materials") != []:
            errors.append(f"{path}.materials: sanitized demo import requires an empty list")
        completion = story.get("completion")
        if not isinstance(completion, dict):
            errors.append(f"{path}.completion: expected object")
        else:
            errors.extend(_unexpected_keys(completion, COMPLETION_KEYS, f"{path}.completion"))
            for field in (
                "editorial_ready",
                "proofread",
                "video_ready",
                "titles_ready",
            ):
                if completion.get(field) is not True:
                    errors.append(f"{path}.completion.{field}: expected true")
            if completion.get("external_approval") != "approved":
                errors.append(
                    f"{path}.completion.external_approval: expected approved"
                )
        _validate_rows(story.get("scenario_rows"), path, errors)


def validate_demo_dataset(payload: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["dataset: expected object"]
    allowed_top_level = {
        "schema_version",
        "data_classification",
        "users",
        "rubrics",
        "stories",
    }
    errors.extend(_unexpected_keys(payload, allowed_top_level, "dataset"))
    if payload.get("schema_version") != DATASET_SCHEMA_VERSION:
        errors.append("schema_version: expected 1")
    if payload.get("data_classification") != DATASET_CLASSIFICATION:
        errors.append("data_classification: expected sanitized_demo")
    user_keys = _validate_users(payload.get("users"), errors)
    rubrics = _validate_rubrics(payload.get("rubrics"), errors)
    _validate_stories(
        payload.get("stories"),
        user_keys=user_keys,
        rubrics=rubrics,
        errors=errors,
    )
    _scan_forbidden_values(payload, "dataset", errors)
    return sorted(set(errors))


def build_validation_report(payload: object) -> dict[str, object]:
    users = payload.get("users", []) if isinstance(payload, dict) else []
    rubrics = payload.get("rubrics", []) if isinstance(payload, dict) else []
    stories = payload.get("stories", []) if isinstance(payload, dict) else []
    scenario_rows = sum(
        len(story.get("scenario_rows", []))
        for story in stories
        if isinstance(story, dict) and isinstance(story.get("scenario_rows"), list)
    ) if isinstance(stories, list) else 0
    errors = validate_demo_dataset(payload)
    return {
        "schema_version": DATASET_SCHEMA_VERSION,
        "valid": not errors,
        "dataset_sha256": dataset_sha256(payload),
        "counts": {
            "users": len(users) if isinstance(users, list) else 0,
            "rubrics": len(rubrics) if isinstance(rubrics, list) else 0,
            "stories": len(stories) if isinstance(stories, list) else 0,
            "scenario_rows": scenario_rows,
        },
        "errors": errors,
    }
