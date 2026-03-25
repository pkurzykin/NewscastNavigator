from __future__ import annotations

import json
from collections.abc import Iterable
from html import escape
from typing import Any


DEFAULT_EDITOR_FONT_FAMILY = "PT Sans"
DEFAULT_EDITOR_FILL_COLOR = "#ffffff"
LEGACY_DEFAULT_EDITOR_FILL_COLOR = "#f4f6f9"


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


def normalize_file_bundle_items(raw_value: Any) -> list[dict[str, str]]:
    if not isinstance(raw_value, list):
        return []

    normalized: list[dict[str, str]] = []
    for item in raw_value:
        if not isinstance(item, dict):
            continue
        normalized.append(
            {
                "file_name": str(item.get("file_name") or "").strip(),
                "tc_in": str(item.get("tc_in") or "").strip()[:16],
                "tc_out": str(item.get("tc_out") or "").strip()[:16],
            }
        )
    return normalized


def structured_data_from_storage(
    *,
    block_type: str,
    text: str,
    content_json: str | None,
) -> dict[str, Any]:
    payload = parse_json_object(content_json)
    file_bundles = normalize_file_bundle_items(payload.get("file_bundles"))
    normalized_block = (block_type or "").strip().lower()
    if normalized_block != "zk_geo":
        return {"file_bundles": file_bundles} if file_bundles else {}

    geo = str(payload.get("geo") or "").strip()
    text_lines = normalize_text_lines(payload.get("text_lines"))
    if not text_lines:
        text_lines = normalize_text_lines(text)
    normalized_payload: dict[str, Any] = {
        "geo": geo,
        "text_lines": text_lines,
    }
    if file_bundles:
        normalized_payload["file_bundles"] = file_bundles
    return normalized_payload


def build_structured_storage(
    *,
    block_type: str,
    text: str,
    structured_data: dict[str, Any] | None,
) -> tuple[str, str]:
    payload = structured_data or {}
    file_bundles = normalize_file_bundle_items(payload.get("file_bundles"))
    normalized_block = (block_type or "").strip().lower()
    if normalized_block != "zk_geo":
        normalized_payload: dict[str, Any] = {}
        if file_bundles:
            normalized_payload["file_bundles"] = file_bundles
        return (text or "").strip(), dump_json_object(normalized_payload)

    geo = str(payload.get("geo") or "").strip()
    text_lines = normalize_text_lines(payload.get("text_lines"))
    if not text_lines:
        text_lines = normalize_text_lines(text)

    normalized_payload: dict[str, Any] = {
        "geo": geo,
        "text_lines": text_lines,
    }
    if file_bundles:
        normalized_payload["file_bundles"] = file_bundles
    return ("\n".join(text_lines), dump_json_object(normalized_payload))


def build_editor_plain_targets(
    *,
    block_type: str,
    text: str,
    speaker_text: str,
    structured_data: dict[str, Any] | None,
) -> dict[str, str]:
    normalized_block = (block_type or "").strip().lower()
    targets: dict[str, str] = {
        "text": (text or "").strip(),
    }

    if normalized_block == "snh":
        lines = normalize_text_lines(speaker_text)
        targets["speaker_fio"] = lines[0] if len(lines) >= 1 else ""
        targets["speaker_position"] = lines[1] if len(lines) >= 2 else ""
        return targets

    if normalized_block == "zk_geo":
        payload = structured_data if isinstance(structured_data, dict) else {}
        geo = str(payload.get("geo") or "").strip()
        text_lines = normalize_text_lines(payload.get("text_lines"))
        targets["text"] = "\n".join(text_lines) if text_lines else (text or "").strip()
        targets["geo"] = geo
        return targets

    return targets


def _rich_text_html_from_plain_text(value: str) -> str:
    normalized = str(value or "").replace("\u00a0", " ").replace("\r", "").rstrip("\n")
    if not normalized:
        return ""
    return escape(normalized).replace("\n", "<br>")


def normalize_rich_text_payload(
    raw_value: dict[str, Any] | None,
    *,
    block_type: str,
    text: str,
    speaker_text: str,
    structured_data: dict[str, Any] | None,
    formatting: dict[str, Any] | None,
) -> dict[str, Any]:
    payload = raw_value if isinstance(raw_value, dict) else {}
    raw_targets = payload.get("targets") if isinstance(payload.get("targets"), dict) else {}
    formatting_payload = formatting if isinstance(formatting, dict) else {}
    raw_html_map = (
        formatting_payload.get("html_by_target")
        if isinstance(formatting_payload.get("html_by_target"), dict)
        else {}
    )
    default_targets = build_editor_plain_targets(
        block_type=block_type,
        text=text,
        speaker_text=speaker_text,
        structured_data=structured_data,
    )

    normalized_targets: dict[str, dict[str, Any]] = {}
    for key, plain_text in default_targets.items():
        source = raw_targets.get(key) if isinstance(raw_targets, dict) else {}
        if not isinstance(source, dict):
            source = {}

        normalized_text = str(source.get("text") if source.get("text") is not None else plain_text)
        normalized_html = str(source.get("html") or raw_html_map.get(key) or "").strip()
        item: dict[str, Any] = {
            "editor": str(source.get("editor") or "legacy_html").strip() or "legacy_html",
            "text": normalized_text,
            "html": normalized_html or _rich_text_html_from_plain_text(normalized_text),
        }
        if source.get("doc") is not None:
            item["doc"] = source.get("doc")
        normalized_targets[key] = item

    return {
        "schema_version": 1,
        "targets": normalized_targets,
    }


def build_initial_rich_text_json(
    *,
    block_type: str,
    text: str,
    speaker_text: str,
    structured_data: dict[str, Any] | None,
    formatting: dict[str, Any] | None = None,
) -> str:
    return dump_json_object(
        normalize_rich_text_payload(
            {},
            block_type=block_type,
            text=text,
            speaker_text=speaker_text,
            structured_data=structured_data,
            formatting=formatting or {},
        )
    )


def rich_text_from_storage(
    *,
    block_type: str,
    text: str,
    speaker_text: str,
    content_json: str | None,
    formatting_json: str | None,
    rich_text_json: str | None,
) -> dict[str, Any]:
    structured_data = structured_data_from_storage(
        block_type=block_type,
        text=text,
        content_json=content_json,
    )
    return normalize_rich_text_payload(
        parse_json_object(rich_text_json),
        block_type=block_type,
        text=text,
        speaker_text=speaker_text,
        structured_data=structured_data,
        formatting=parse_json_object(formatting_json),
    )


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
            "fill_color": (
                DEFAULT_EDITOR_FILL_COLOR
                if str(source.get("fill_color") or default_value["fill_color"]).strip().lower()
                == LEGACY_DEFAULT_EDITOR_FILL_COLOR
                else str(source.get("fill_color") or default_value["fill_color"]).strip()
                or DEFAULT_EDITOR_FILL_COLOR
            ),
        }
        if isinstance(raw_html_map, dict):
            html_value = str(raw_html_map.get(key) or "")
            if html_value.strip():
                normalized_html_map[key] = html_value

    return {
        "targets": normalized_targets,
        "html_by_target": normalized_html_map,
    }
