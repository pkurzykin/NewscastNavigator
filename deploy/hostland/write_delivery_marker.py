"""Publish an atomic marker only after the home pull verified a production chain."""

import argparse
import json
import os
from pathlib import Path
import re
import tempfile
import time


NAME = re.compile(r"(?:db-\d{8}T\d{6}Z-production\.dump|full-\d{8}T\d{6}Z-production\.tar)\.age\Z")
DIGEST = re.compile(r"[a-f0-9]{64}\Z")
COMMIT = re.compile(r"[a-f0-9]{40}\Z")


def write_marker(rows_path: Path, snapshots: Path, output: Path, *, now: int | None = None) -> None:
    rows = []
    for line in rows_path.read_text().splitlines():
        name, digest, size, commit, created = line.split("\t")
        if not NAME.fullmatch(name) or not DIGEST.fullmatch(digest) or not COMMIT.fullmatch(commit):
            raise ValueError("Invalid backup index")
        row = {"name": name, "digest": digest, "size": int(size),
               "commit": commit, "created": int(created)}
        if row["size"] <= 0 or row["created"] <= 0:
            raise ValueError("Invalid backup metadata")
        rows.append(row)
    db = max((row for row in rows if row["name"].startswith("db-")),
             key=lambda row: row["created"], default=None)
    if db is None:
        raise ValueError("No production DB point")
    full = max((row for row in rows if row["name"].startswith("full-") and
                row["commit"] == db["commit"]), key=lambda row: row["created"], default=None)
    if full is None:
        raise ValueError("No matching full release bundle")
    for row in (db, full):
        archive = snapshots / row["name"]
        sidecar = snapshots / (row["name"] + ".sha256")
        if archive.is_symlink() or sidecar.is_symlink() or not archive.is_file() or not sidecar.is_file():
            raise ValueError("Verified backup file missing or unsafe")
        if archive.stat().st_size != row["size"]:
            raise ValueError("Verified backup size changed")
        if sidecar.read_text() != f'{row["digest"]}  {row["name"]}\n':
            raise ValueError("Verified backup checksum sidecar changed")
    if output.parent.is_symlink():
        raise ValueError("Unsafe monitor directory")
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    evidence = {
        "db_created_unix": db["created"],
        "db_name": db["name"],
        "full_name": full["name"],
        "source_commit": db["commit"],
        "verified_unix": int(time.time() if now is None else now),
    }
    fd, temporary = tempfile.mkstemp(prefix=".latest-", dir=output.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(evidence, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=Path, required=True)
    parser.add_argument("--snapshots", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    write_marker(args.rows, args.snapshots, args.output)
