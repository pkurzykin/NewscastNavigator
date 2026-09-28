#!/usr/bin/python3
"""Privileged, production-only VDS endpoint for one approved backup deletion.

The SSH key runs this program through a fixed forced command and sudo rule.
No path, policy, or batch size can be supplied by the caller. The two writer
locks and the prune lock are held for the complete transaction.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from retention_policy import MAX_DB_PER_RUN, MAX_FULL_PER_RUN, NAME_RE, PolicyError, plan_retention
import retention_policy


EXPORT_DIR = Path("/var/lib/newscast-backup/export/files")
JOURNAL_DIR = Path("/var/lib/newscast-backup/prune-journal")
SYNTHETIC_RE = re.compile(
    r"(?:db-\d{8}T\d{6}Z-synthetic\.dump|full-\d{8}T\d{6}Z-synthetic\.tar)\.age(?:\.json)?\Z"
)
KNOWN_LOCKS = {".db-backup.lock", ".full-backup.lock"}
# A quarantined synthetic metadata fixture from the restore rehearsal remains
# in the live export directory. It is never a production deletion candidate.
QUARANTINED_SYNTHETIC_RE = re.compile(
    r"(?:\.invalid-full-\d{8}T\d{6}Z-synthetic\.tar\.age\.json|"
    r"full-\d{8}T\d{6}Z-synthetic\.tar\.age\.INVALID)\Z"
)
POINT_KEYS = {"name", "kind", "source_commit", "sha256", "bytes", "created_unix"}
REQUEST_KEYS = {"version", "home_unix", "name", "sha256", "bytes"}


class PruneError(ValueError):
    """No file should be removed for this request."""


def _no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PruneError("Duplicate JSON key")
        result[key] = value
    return result


def validate_request(request: dict) -> None:
    if (
        type(request) is not dict
        or set(request) != REQUEST_KEYS
        or type(request["version"]) is not int
        or request["version"] != 1
        or type(request["home_unix"]) is not int
        or request["home_unix"] <= 0
        or type(request["name"]) is not str
        or not NAME_RE.fullmatch(request["name"])
        or type(request["sha256"]) is not str
        or not re.fullmatch(r"[a-f0-9]{64}", request["sha256"])
        or type(request["bytes"]) is not int
        or request["bytes"] <= 0
    ):
        raise PruneError("Invalid prune request")


def _read_json(path: Path) -> dict:
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_size > 4096:
        raise PruneError("Unsafe metadata or journal file")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "r", encoding="utf-8") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_ino != st.st_ino or opened.st_dev != st.st_dev
                or opened.st_size > 4096 or opened.st_nlink != 1):
            raise PruneError("Metadata changed during scan")
        value = json.load(stream, object_pairs_hook=_no_duplicates)
    if type(value) is not dict:
        raise PruneError("Invalid JSON object")
    return value


def _validate_point(item: dict, name: str) -> None:
    if set(item) != POINT_KEYS or item.get("name") != name:
        raise PruneError("Invalid point metadata")
    if (
        item.get("kind") != "production"
        or not NAME_RE.fullmatch(name)
        or type(item.get("sha256")) is not str
        or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
        or type(item.get("source_commit")) is not str
        or not re.fullmatch(r"[a-f0-9]{40}", item["source_commit"])
        or type(item.get("bytes")) is not int
        or item["bytes"] <= 0
        or type(item.get("created_unix")) is not int
        or item["created_unix"] <= 0
    ):
        raise PruneError("Invalid production point")


def _regular(path: Path) -> os.stat_result:
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        raise PruneError("Unsafe backup file")
    return st


def _scan(export_dir: Path, incomplete_name: str | None = None) -> tuple[list[dict], dict[str, tuple[bool, bool]]]:
    if not export_dir.is_dir() or export_dir.is_symlink():
        raise PruneError("Unsafe export directory")
    names = set()
    for path in export_dir.iterdir():
        _regular(path)
        if path.name in KNOWN_LOCKS or QUARANTINED_SYNTHETIC_RE.fullmatch(path.name):
            continue
        if path.name.endswith(".json"):
            base = path.name[:-5]
        else:
            base = path.name
        if SYNTHETIC_RE.fullmatch(path.name):
            # Rehearsal fixtures are outside production retention, including
            # intentionally incomplete synthetic restore checks.
            continue
        if NAME_RE.fullmatch(base):
            names.add(base)
        else:
            raise PruneError("Unexpected file in export directory")

    points = []
    presence = {}
    for name in sorted(names):
        archive = export_dir / name
        meta = export_dir / (name + ".json")
        has_archive = archive.exists()
        has_meta = meta.exists()
        if not has_archive or not has_meta:
            if name != incomplete_name or not NAME_RE.fullmatch(name):
                raise PruneError("Incomplete backup point")
        presence[name] = (has_archive, has_meta)
        if has_meta:
            item = _read_json(meta)
            _validate_point(item, name)
            if has_archive and _regular(archive).st_size != item["bytes"]:
                raise PruneError("Backup size differs from metadata")
            points.append(item)
    return points, presence


def _matching_request(item: dict, request: dict) -> bool:
    return all(item[key] == request[key] for key in ("name", "sha256", "bytes"))


def _clock_guard(request: dict, now_unix: int, synchronized: bool) -> None:
    if not synchronized or type(now_unix) is not int or abs(now_unix - request["home_unix"]) > 60:
        raise PruneError("Unsynchronized VDS or home clock")


def _journal_path(journal_dir: Path, name: str) -> Path:
    if not journal_dir.is_dir() or journal_dir.is_symlink():
        raise PruneError("Unsafe prune journal directory")
    return journal_dir / (name + ".json")


def _write_journal(path: Path, item: dict, status: str) -> None:
    data = {"version": 1, "status": status, "point": item}
    _write_atomic_json(path, data)


def _write_atomic_json(path: Path, data: dict) -> None:
    fd, temp_name = tempfile.mkstemp(prefix=".prune-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
        _fsync_dir(path.parent)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def _reserve_daily_slot(journal_dir: Path, name: str, now_unix: int) -> None:
    """Count intent before unlink; a crash may waste a slot, never exceed cap."""
    day = datetime.fromtimestamp(now_unix, timezone.utc).strftime("%Y%m%d")
    path = journal_dir / (".daily-" + day + ".json")
    if path.exists() or path.is_symlink():
        data = _read_json(path)
    else:
        data = {"version": 1, "date": day, "db": 0, "full": 0}
    if (set(data) != {"version", "date", "db", "full"}
            or type(data["version"]) is not int or data["version"] != 1
            or data["date"] != day
            or type(data["db"]) is not int or not 0 <= data["db"] <= MAX_DB_PER_RUN
            or type(data["full"]) is not int or not 0 <= data["full"] <= MAX_FULL_PER_RUN):
        raise PruneError("Invalid daily prune counter")
    key = "db" if name.startswith("db-") else "full"
    limit = MAX_DB_PER_RUN if key == "db" else MAX_FULL_PER_RUN
    if data[key] >= limit:
        raise PruneError("Daily prune cap reached")
    data[key] += 1
    _write_atomic_json(path, data)


def _read_journal(path: Path) -> tuple[str, dict] | None:
    if not path.exists() and not path.is_symlink():
        return None
    record = _read_json(path)
    if (set(record) != {"version", "status", "point"}
            or type(record["version"]) is not int or record["version"] != 1):
        raise PruneError("Invalid prune journal")
    if (type(record["status"]) is not str
            or record["status"] not in {"intent", "done"}
            or type(record["point"]) is not dict):
        raise PruneError("Invalid prune journal status")
    _validate_point(record["point"], path.name[:-5])
    return record["status"], record["point"]


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _check_digest(path: Path, item: dict) -> None:
    st = _regular(path)
    if st.st_size != item["bytes"]:
        raise PruneError("Backup size mismatch")
    digest = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        with os.fdopen(fd, "rb") as stream:
            if os.fstat(stream.fileno()).st_ino != st.st_ino:
                raise PruneError("Backup changed during scan")
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except Exception:
        # os.fdopen owns the descriptor after successful construction.
        raise
    if digest.hexdigest() != item["sha256"]:
        raise PruneError("Backup digest mismatch")


def prune_one(
    request: dict,
    export_dir: Path,
    journal_dir: Path,
    now_unix: int,
    *,
    synchronized: bool,
    checkpoint: Callable[[str], None] | None = None,
    clock_now: Callable[[], int] | None = None,
    sync_check: Callable[[], bool] | None = None,
) -> dict:
    """Prune one exact candidate; caller holds all backup and prune locks."""
    validate_request(request)
    _clock_guard(request, now_unix, synchronized)
    name = request["name"]
    journal_path = _journal_path(journal_dir, name)
    journal = _read_journal(journal_path)
    if journal and not _matching_request(journal[1], request):
        raise PruneError("Request differs from existing prune journal")

    points, presence = _scan(export_dir, name if journal and journal[0] == "intent" else None)
    archive = export_dir / name
    meta = export_dir / (name + ".json")
    if journal and journal[0] == "done":
        if name in presence or archive.exists() or meta.exists():
            raise PruneError("Completed deletion target reappeared")
        return _receipt("already_deleted", request)

    item = next((row for row in points if row["name"] == name), None)
    if journal:
        if item is not None and item != journal[1]:
            raise PruneError("Point metadata differs from prune journal")
        item = journal[1]
        if item["name"] not in {row["name"] for row in points}:
            points.append(item)
    if item is None or not _matching_request(item, request):
        raise PruneError("Requested point absent or differs from metadata")

    try:
        policy = plan_retention(points, now_unix)
    except PolicyError as exc:
        raise PruneError(str(exc)) from exc
    if name not in policy["delete_db"] + policy["delete_full"]:
        raise PruneError("Requested point is protected by retention policy")
    if name.startswith("full-"):
        # The pure policy plans a whole batch, with DB removals before full.
        # This endpoint removes one point per SSH call and must preserve a
        # complete on-disk chain after *each* successful call.
        remaining = [row for row in points if row["name"] != name]
        full_commits = {
            row["source_commit"] for row in remaining
            if row["name"].startswith("full-")
        }
        if any(row["source_commit"] not in full_commits for row in remaining
               if row["name"].startswith("db-")):
            raise PruneError("Full archive still required by a DB point")
    if archive.exists():
        _check_digest(archive, item)
    elif not journal:
        raise PruneError("Missing ciphertext without prune intent")

    # A large full archive can take longer to hash than the 60-second clock
    # window. Production supplies live callbacks; a stale request never reaches
    # the unlink step even if it was valid at the start of the transaction.
    _clock_guard(request, clock_now() if clock_now else now_unix,
                 sync_check() if sync_check else synchronized)
    already_absent = journal is not None and not archive.exists() and not meta.exists()

    if not journal:
        _reserve_daily_slot(journal_dir, name, now_unix)
        _write_journal(journal_path, item, "intent")
        if checkpoint:
            checkpoint("after_intent")
    if archive.exists():
        archive.unlink()
        _fsync_dir(export_dir)
        if checkpoint:
            checkpoint("after_ciphertext")
    if meta.exists():
        meta.unlink()
        _fsync_dir(export_dir)
        if checkpoint:
            checkpoint("after_metadata")
    _write_journal(journal_path, item, "done")
    return _receipt("already_deleted" if already_absent else "deleted", request)


def _receipt(status: str, request: dict) -> dict:
    return {"status": status, "name": request["name"],
            "sha256": request["sha256"], "bytes": request["bytes"]}


@contextmanager
def _lock(path: Path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            raise PruneError("Unsafe lock file")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise PruneError("Backup or prune operation is already running") from exc
        yield
    finally:
        os.close(fd)


def _ntp_synchronized() -> bool:
    result = subprocess.run(
        ["/usr/bin/timedatectl", "show", "-p", "NTPSynchronized", "--value"],
        capture_output=True, text=True, timeout=10, check=False,
    )
    return result.returncode == 0 and result.stdout.strip() == "yes"


def main() -> int:
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1:
            raise PruneError("Prune endpoint requires root and no arguments")
        raw = sys.stdin.buffer.read(2049)
        if len(raw) > 2048:
            raise PruneError("Prune request too large")
        request = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates)
        validate_request(request)
        if (not EXPORT_DIR.is_dir() or EXPORT_DIR.is_symlink()
                or not JOURNAL_DIR.is_dir() or JOURNAL_DIR.is_symlink()):
            raise PruneError("Unsafe backup or journal directory")
        for path in (EXPORT_DIR, JOURNAL_DIR, Path(__file__),
                     Path(retention_policy.__file__)):
            st = path.lstat()
            if st.st_uid != 0 or st.st_mode & 0o022 or stat.S_ISLNK(st.st_mode):
                raise PruneError("Prune code or data path is not root-controlled")
        if stat.S_IMODE(JOURNAL_DIR.stat().st_mode) != 0o700:
            raise PruneError("Prune journal must be root-only")
        with ExitStack() as stack:
            stack.enter_context(_lock(JOURNAL_DIR / ".prune.lock"))
            stack.enter_context(_lock(EXPORT_DIR / ".db-backup.lock"))
            stack.enter_context(_lock(EXPORT_DIR / ".full-backup.lock"))
            receipt = prune_one(request, EXPORT_DIR, JOURNAL_DIR, int(time.time()),
                                synchronized=_ntp_synchronized(),
                                clock_now=lambda: int(time.time()),
                                sync_check=_ntp_synchronized)
        volume = os.statvfs(EXPORT_DIR)
        print(f"VDS_BACKUP_FREE_BYTES={volume.f_bavail * volume.f_frsize}", file=sys.stderr)
        print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))
        return 0
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError) as exc:
        print(f"Backup prune refused: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
