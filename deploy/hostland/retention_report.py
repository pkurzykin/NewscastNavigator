#!/usr/bin/env python3
"""Report backup chain availability without decrypting or deleting files."""

import argparse
import json
import re
import stat
import sys
from pathlib import Path


POINT_RE = re.compile(r"(db-\d{8}T\d{6}Z-production\.dump|full-\d{8}T\d{6}Z-production\.tar)\.age\Z")
SYNTHETIC_RE = re.compile(r"(db-\d{8}T\d{6}Z-synthetic\.dump|full-\d{8}T\d{6}Z-synthetic\.tar)\.age\Z")
SHA_RE = re.compile(r"[a-f0-9]{64}\Z")
COMMIT_RE = re.compile(r"[a-f0-9]{40}\Z")


def load_points(path):
    items = json.loads(path.read_text())
    if not isinstance(items, list):
        raise ValueError("Export index must be a JSON list")
    points = []
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Invalid export index item")
        kind = item.get("kind")
        name = item.get("name")
        if kind == "synthetic":
            if not isinstance(name, str) or not SYNTHETIC_RE.fullmatch(name):
                raise ValueError("Export index kind does not match point name")
            continue
        if kind != "production":
            raise ValueError("Invalid export index kind")
        if (
            not isinstance(name, str) or not POINT_RE.fullmatch(name)
            or name in seen or not isinstance(item.get("sha256"), str)
            or not SHA_RE.fullmatch(item["sha256"])
            or type(item.get("bytes")) is not int or item["bytes"] <= 0
            or not isinstance(item.get("source_commit"), str)
            or not COMMIT_RE.fullmatch(item["source_commit"])
            or type(item.get("created_unix")) is not int or item["created_unix"] <= 0
        ):
            raise ValueError("Invalid production point in export index")
        seen.add(name)
        points.append(item)
    return points


def is_regular(path):
    try:
        return stat.S_ISREG(path.lstat().st_mode)
    except FileNotFoundError:
        return False


def home_has_point(root, item):
    name = item["name"]
    ciphertext = root / name
    checksum = root / (name + ".sha256")
    if not is_regular(ciphertext) or not is_regular(checksum):
        return False
    if ciphertext.stat().st_size != item["bytes"]:
        return False
    return checksum.read_text() == f'{item["sha256"]}  {name}\n'


def build_report(points, root):
    db_points = [item for item in points if item["name"].startswith("db-")]
    full_points = [item for item in points if item["name"].startswith("full-")]
    valid = {item["name"] for item in points if home_has_point(root, item)}
    full_commits = {item["source_commit"] for item in full_points}
    db_without_full = sum(item["source_commit"] not in full_commits for item in db_points)
    home_missing_or_invalid = len(points) - len(valid)
    latest_db = max(db_points, key=lambda item: (item["created_unix"], item["name"]), default=None)
    matching = (
        [item for item in full_points if item["source_commit"] == latest_db["source_commit"]]
        if latest_db else []
    )
    latest_full = max(matching, key=lambda item: (item["created_unix"], item["name"]), default=None)
    latest_ready = bool(
        latest_db and latest_full and latest_db["name"] in valid and latest_full["name"] in valid
    )
    chains = []
    for commit in sorted({item["source_commit"] for item in points}):
        chain = [item for item in points if item["source_commit"] == commit]
        home = [item for item in chain if item["name"] in valid]
        chains.append({
            "source_commit": commit,
            "db_points": sum(item["name"].startswith("db-") for item in chain),
            "full_points": sum(item["name"].startswith("full-") for item in chain),
            "home_db_points": sum(item["name"].startswith("db-") for item in home),
            "home_full_points": sum(item["name"].startswith("full-") for item in home),
            "vds_bytes": sum(item["bytes"] for item in chain),
            "home_bytes_matching_index": sum(item["bytes"] for item in home),
        })
    return {
        "vds_db_points": len(db_points),
        "vds_full_points": len(full_points),
        "vds_db_without_full": db_without_full,
        "vds_total_bytes": sum(item["bytes"] for item in points),
        "home_bytes_matching_index": sum(item["bytes"] for item in points if item["name"] in valid),
        "home_missing_or_invalid": home_missing_or_invalid,
        "chains": chains,
        "latest_db": latest_db["name"] if latest_db else None,
        "latest_full": latest_full["name"] if latest_full else None,
        "latest_chain_ready_at_home": latest_ready,
        "status": "ready" if latest_ready and not db_without_full and not home_missing_or_invalid else "attention",
        "ciphertext_rehashed": False,
        "policy_approved": False,
        "deleted": 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-index", type=Path, required=True)
    parser.add_argument("--snapshots", type=Path, required=True)
    args = parser.parse_args()
    try:
        if not args.snapshots.is_dir() or args.snapshots.is_symlink():
            raise ValueError("Unsafe snapshots directory")
        points = load_points(args.export_index)
        report = build_report(points, args.snapshots)
    except (OSError, ValueError, UnicodeError) as exc:
        print(f"Retention report failed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
