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


def _longest_common_subsequence(before: list[str], after: list[str]) -> set[str]:
    lengths = [[0] * (len(after) + 1) for _ in range(len(before) + 1)]
    for before_index, before_uid in enumerate(before, start=1):
        for after_index, after_uid in enumerate(after, start=1):
            if before_uid == after_uid:
                lengths[before_index][after_index] = lengths[before_index - 1][after_index - 1] + 1
            else:
                lengths[before_index][after_index] = max(
                    lengths[before_index - 1][after_index],
                    lengths[before_index][after_index - 1],
                )

    common: set[str] = set()
    before_index = len(before)
    after_index = len(after)
    while before_index and after_index:
        if before[before_index - 1] == after[after_index - 1]:
            common.add(before[before_index - 1])
            before_index -= 1
            after_index -= 1
        elif lengths[before_index - 1][after_index] >= lengths[before_index][after_index - 1]:
            before_index -= 1
        else:
            after_index -= 1
    return common


def build_scenario_diff(
    before_rows: Iterable[object | Mapping[str, Any]],
    after_rows: Iterable[object | Mapping[str, Any]],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    before_values = sorted((_row_dict(row) for row in before_rows), key=lambda row: row["order_index"])
    after_values = sorted((_row_dict(row) for row in after_rows), key=lambda row: row["order_index"])
    before = {row["segment_uid"]: row for row in before_values}
    after = {row["segment_uid"]: row for row in after_values}
    shared_uids = before.keys() & after.keys()
    stable_uids = _longest_common_subsequence(
        [row["segment_uid"] for row in before_values if row["segment_uid"] in shared_uids],
        [row["segment_uid"] for row in after_values if row["segment_uid"] in shared_uids],
    )
    moved_uids = shared_uids - stable_uids
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
        was_moved = segment_uid in moved_uids
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
