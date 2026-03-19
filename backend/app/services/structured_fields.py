from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any


DEFAULT_EDITOR_FONT_FAMILY = "PT Sans"
DEFAULT_EDITOR_FILL_COLOR = "#f4f6f9"


def parse_json_object(raw_value: str | None) -> dict[str, Any]:
    if not raw_value:
        return {}
    try:
        payload = json.loads(raw_value)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def dump_json_object(payload: dict[str, Any] | None) -> str:
    if not payload:
        return ""
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def normalize_string_list(values: Iterable[Any] | None, *, max_length: int | None = None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = str(value or "").strip()
        if not text:
            continue
        if max_length is not None:
            text = text[:max_length]
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def parse_string_list_json(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    try:
        payload = json.loads(raw_value)
    except Exception:
        return []
    if not isinstance(payload, list):
        return []
    return normalize_string_list(payload)


def dump_string_list_json(values: Iterable[Any] | None) -> str:
    items = normalize_string_list(values)
    if not items:
        return ""
    return json.dumps(items, ensure_ascii=False, separators=(",", ":"))


def normalize_positive_int_list(values: Iterable[Any] | None) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for value in values or []:
        try:
            item = int(value)
        except Exception:
            continue
        if item <= 0 or item in seen:
            continue
        seen.add(item)
        normalized.append(item)
    return normalized


def parse_int_list_json(raw_value: str | None, *, fallback: int | None = None) -> list[int]:
    if raw_value:
        try:
            payload = json.loads(raw_value)
        except Exception:
            payload = None
        if isinstance(payload, list):
            items = normalize_positive_int_list(payload)
            if items:
                return items
    if fallback and fallback > 0:
        return [fallback]
    return []


def dump_int_list_json(values: Iterable[Any] | None) -> str:
    items = normalize_positive_int_list(values)
    if not items:
        return ""
    return json.dumps(items, ensure_ascii=False, separators=(",", ":"))


def normalize_text_lines(raw_value: Any) -> list[str]:
    if isinstance(raw_value, list):
        source = raw_value
    else:
        source = str(raw_value or "").splitlines()
    normalized: list[str] = []
    for value in source:
        line = str(value or "").strip()
        if line:
            normalized.append(line)
    return normalized


def structured_data_from_storage(
    *,
    block_type: str,
    text: str,
    content_json: str | None,
) -> dict[str, Any]:
    normalized_block = (block_type or "").strip().lower()
    if normalized_block != "zk_geo":
        return {}

    payload = parse_json_object(content_json)
    geo = str(payload.get("geo") or "").strip()
    text_lines = normalize_text_lines(payload.get("text_lines"))
    if not text_lines:
        text_lines = normalize_text_lines(text)
    return {
        "geo": geo,
        "text_lines": text_lines,
    }


def build_structured_storage(
    *,
    block_type: str,
    text: str,
    structured_data: dict[str, Any] | None,
) -> tuple[str, str]:
    normalized_block = (block_type or "").strip().lower()
    if normalized_block != "zk_geo":
        return (text or "").strip(), ""

    payload = structured_data or {}
    geo = str(payload.get("geo") or "").strip()
    text_lines = normalize_text_lines(payload.get("text_lines"))
    if not text_lines:
        text_lines = normalize_text_lines(text)

    normalized_payload = {
        "geo": geo,
        "text_lines": text_lines,
    }
    return ("\n".join(text_lines), dump_json_object(normalized_payload))


def _default_format_targets(block_type: str) -> dict[str, dict[str, Any]]:
    normalized_block = (block_type or "").strip().lower()
    targets: dict[str, dict[str, Any]] = {
        "text": {
            "font_family": DEFAULT_EDITOR_FONT_FAMILY,
            "bold": False,
            "italic": False,
            "strikethrough": False,
            "fill_color": DEFAULT_EDITOR_FILL_COLOR,
        }
    }

    if normalized_block == "snh":
        targets["speaker_fio"] = {
            "font_family": DEFAULT_EDITOR_FONT_FAMILY,
            "bold": True,
            "italic": True,
            "strikethrough": False,
            "fill_color": DEFAULT_EDITOR_FILL_COLOR,
        }
        targets["speaker_position"] = {
            "font_family": DEFAULT_EDITOR_FONT_FAMILY,
            "bold": True,
            "italic": True,
            "strikethrough": False,
            "fill_color": DEFAULT_EDITOR_FILL_COLOR,
        }
        targets["text"] = {
            "font_family": DEFAULT_EDITOR_FONT_FAMILY,
            "bold": False,
            "italic": True,
            "strikethrough": False,
            "fill_color": DEFAULT_EDITOR_FILL_COLOR,
        }
    elif normalized_block == "zk_geo":
        targets["geo"] = {
            "font_family": DEFAULT_EDITOR_FONT_FAMILY,
            "bold": False,
            "italic": True,
            "strikethrough": False,
            "fill_color": DEFAULT_EDITOR_FILL_COLOR,
        }
    elif normalized_block == "life":
        targets["text"] = {
            "font_family": DEFAULT_EDITOR_FONT_FAMILY,
            "bold": False,
            "italic": True,
            "strikethrough": False,
            "fill_color": DEFAULT_EDITOR_FILL_COLOR,
        }

    return targets


def normalize_row_formatting(raw_value: dict[str, Any] | None, *, block_type: str) -> dict[str, Any]:
    payload = raw_value if isinstance(raw_value, dict) else {}
    raw_targets = payload.get("targets")
    raw_html_map = payload.get("html_by_target")
    default_targets = _default_format_targets(block_type)
    normalized_targets: dict[str, dict[str, Any]] = {}
    normalized_html_map: dict[str, str] = {}

    for key, default_value in default_targets.items():
        source = raw_targets.get(key) if isinstance(raw_targets, dict) else {}
        if not isinstance(source, dict):
            source = {}
        normalized_targets[key] = {
            "font_family": str(source.get("font_family") or default_value["font_family"]).strip()
            or DEFAULT_EDITOR_FONT_FAMILY,
            "bold": bool(source.get("bold", default_value["bold"])),
            "italic": bool(source.get("italic", default_value["italic"])),
            "strikethrough": bool(
                source.get("strikethrough", default_value["strikethrough"])
            ),
            "fill_color": str(source.get("fill_color") or default_value["fill_color"]).strip()
            or DEFAULT_EDITOR_FILL_COLOR,
        }
        if isinstance(raw_html_map, dict):
            html_value = str(raw_html_map.get(key) or "")
            if html_value.strip():
                normalized_html_map[key] = html_value

    return {
        "targets": normalized_targets,
        "html_by_target": normalized_html_map,
    }
