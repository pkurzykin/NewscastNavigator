from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from typing import Any

from app.services.scenario_serialization import ROW_FIELDS


CONTENT_FIELDS = tuple(field for field in ROW_FIELDS if field not in {"segment_uid", "order_index"})


def _row_dict(row: object | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(row, Mapping):
        return {field: row.get(field) for field in ROW_FIELDS}
    return {field: getattr(row, field) for field in ROW_FIELDS}


def scenario_snapshot_hash(rows: Iterable[object | Mapping[str, Any]]) -> str:
    normalized = [_row_dict(row) for row in rows]
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_scenario_diff(
    before_rows: Iterable[object | Mapping[str, Any]],
    after_rows: Iterable[object | Mapping[str, Any]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    before = {_row_dict(row)["segment_uid"]: _row_dict(row) for row in before_rows}
    after = {_row_dict(row)["segment_uid"]: _row_dict(row) for row in after_rows}
    changes: list[dict[str, Any]] = []
    added = removed = changed = moved = 0

    for segment_uid in sorted(before.keys() | after.keys()):
        old = before.get(segment_uid)
        new = after.get(segment_uid)
        if old is None:
            added += 1
            changes.append({
                "segment_uid": segment_uid,
                "kind": "added",
                "moved": False,
                "changed_fields": [],
                "before": None,
                "after": new,
            })
            continue
        if new is None:
            removed += 1
            changes.append({
                "segment_uid": segment_uid,
                "kind": "removed",
                "moved": False,
                "changed_fields": [],
                "before": old,
                "after": None,
            })
            continue
        changed_fields = [field for field in CONTENT_FIELDS if old[field] != new[field]]
        was_moved = old["order_index"] != new["order_index"]
        if changed_fields:
            changed += 1
        if was_moved:
            moved += 1
        if changed_fields or was_moved:
            changes.append({
                "segment_uid": segment_uid,
                "kind": "changed" if changed_fields else "moved",
                "moved": was_moved,
                "changed_fields": changed_fields,
                "before": old,
                "after": new,
            })

    summary = {
        "added": added,
        "removed": removed,
        "changed": changed,
        "moved": moved,
        "total": len(changes),
    }
    return summary, changes

