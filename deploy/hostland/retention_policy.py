#!/usr/bin/env python3
"""Conservative, side-effect-free retention policy for production backups."""

from __future__ import annotations

import re
from datetime import datetime, timezone


DB_SECONDS = 30 * 86400
FULL_SECONDS = 8 * 7 * 86400
MAX_DB_PER_RUN = 576
MAX_FULL_PER_RUN = 1
NAME_RE = re.compile(
    r"(db-\d{8}T\d{6}Z-production\.dump|full-\d{8}T\d{6}Z-production\.tar)\.age\Z"
)
SHA_RE = re.compile(r"[a-f0-9]{64}\Z")
COMMIT_RE = re.compile(r"[a-f0-9]{40}\Z")


class PolicyError(ValueError):
    """The complete index is unsafe for automatic deletion."""


def _validate(points: list[dict], now_unix: int) -> None:
    if type(now_unix) is not int or now_unix <= 0:
        raise PolicyError("Invalid current time")
    if not isinstance(points, list) or not points:
        raise PolicyError("No production backup points")
    names: set[str] = set()
    for item in points:
        if not isinstance(item, dict):
            raise PolicyError("Invalid point metadata")
        name = item.get("name")
        if (
            item.get("kind") != "production"
            or not isinstance(name, str)
            or not NAME_RE.fullmatch(name)
            or name in names
            or not isinstance(item.get("sha256"), str)
            or not SHA_RE.fullmatch(item["sha256"])
            or not isinstance(item.get("source_commit"), str)
            or not COMMIT_RE.fullmatch(item["source_commit"])
            or type(item.get("bytes")) is not int
            or item["bytes"] <= 0
            or type(item.get("created_unix")) is not int
            or item["created_unix"] <= 0
        ):
            raise PolicyError("Invalid or duplicate production backup point")
        if item["created_unix"] > now_unix + 60:
            raise PolicyError("Backup point has a future timestamp")
        named_at = int(datetime.strptime(
            name.split("-")[1], "%Y%m%dT%H%M%SZ"
        ).replace(tzinfo=timezone.utc).timestamp())
        max_build_seconds = 300 if name.startswith("db-") else 3600
        if not named_at <= item["created_unix"] <= named_at + max_build_seconds:
            raise PolicyError("Backup metadata time differs from filename")
        names.add(name)


def _week(item: dict) -> str:
    year, week, _ = datetime.fromtimestamp(
        item["created_unix"], timezone.utc
    ).isocalendar()
    return f"{year:04d}-W{week:02d}"


def plan_retention(points: list[dict], now_unix: int) -> dict:
    """Return exact names to keep/delete; raise if the index is incomplete.

    A deletion runner must perform its own filesystem, clock, and remote-copy
    checks. This function never infers that an index item was delivered home.
    """
    _validate(points, now_unix)
    db = sorted(
        (item for item in points if item["name"].startswith("db-")),
        key=lambda item: (item["created_unix"], item["name"]),
    )
    full = sorted(
        (item for item in points if item["name"].startswith("full-")),
        key=lambda item: (item["created_unix"], item["name"]),
    )
    if not db or not full:
        raise PolicyError("No complete DB and full backup chain")
    all_full_commits = {item["source_commit"] for item in full}
    if any(item["source_commit"] not in all_full_commits for item in db):
        raise PolicyError("DB point has no matching full release bundle")

    keep: set[str] = set()
    for item in db:
        if item["created_unix"] >= now_unix - DB_SECONDS:
            keep.add(item["name"])
    keep.update(item["name"] for item in db[-2:])
    delete_db = [item["name"] for item in db if item["name"] not in keep]
    delete_db = delete_db[:MAX_DB_PER_RUN]
    # Points beyond the daily cap still count as retained for full dependencies.
    keep.update(item["name"] for item in db if item["name"] not in delete_db)

    by_week: dict[str, dict] = {}
    for item in full:
        by_week[_week(item)] = item
    kept_weeks = sorted(by_week, reverse=True)[:8]
    if len(by_week) < 8:
        keep.update(item["name"] for item in full)
    else:
        keep.update(by_week[week]["name"] for week in kept_weeks)
        keep.update(
            item["name"] for item in full
            if item["created_unix"] >= now_unix - FULL_SECONDS
        )
    retained_commits = {
        item["source_commit"] for item in db if item["name"] in keep
    }
    for commit in retained_commits:
        matching = [item for item in full if item["source_commit"] == commit]
        keep.add(matching[-1]["name"])

    delete_full = [
        item["name"] for item in full
        if item["name"] not in keep and item["created_unix"] < now_unix - FULL_SECONDS
    ][:MAX_FULL_PER_RUN]
    keep.update(item["name"] for item in full if item["name"] not in delete_full)
    return {
        "keep": sorted(keep),
        "delete_db": delete_db,
        "delete_full": delete_full,
        "kept_weeks": kept_weeks,
        "policy": {"db_days": 30, "full_weeks": 8},
    }
