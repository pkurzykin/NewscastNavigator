"""Verified access to the small, frozen Product Reset evidence set in tests."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path


SOURCE_COMMIT = "09d4c52f085f6961d88366b439408f8ba4dc3e45"
GIT_EVIDENCE = frozenset({
    "docs/product-reset/ARCHITECTURE_INVENTORY_RU.md",
    "docs/product-reset/EVAL_COMMANDS.json",
    "docs/product-reset/LEGACY_DENYLIST.txt",
    "docs/product-reset/OPERATIONS_INVENTORY_RU.md",
    "docs/product-reset/PROGRESS.md",
    "docs/product-reset/RISK_REGISTER_RU.md",
})
WORKTREE_EVIDENCE = frozenset({
    "docs/product-reset/DEMO_EVIDENCE.json",
    "docs/product-reset/EVAL_RESULT.json",
    "docs/product-reset/UX_EVAL_RU.md",
})
_STORAGE = {**dict.fromkeys(GIT_EVIDENCE, "git"), **dict.fromkeys(WORKTREE_EVIDENCE, "worktree")}


def read_evidence_bytes(
    repo_root: Path,
    relative_path: str,
    *,
    expected_source_commit: str = SOURCE_COMMIT,
) -> bytes:
    """Read an allowlisted item only when its schema-2 manifest hash matches."""
    if relative_path not in _STORAGE:
        raise ValueError(f"evidence path not allowed: {relative_path}")
    manifest_path = repo_root / "docs/archive/EVIDENCE_MANIFEST.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError("evidence manifest unavailable or invalid") from exc
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 2:
        raise ValueError("evidence manifest requires schema_version 2")
    commit = manifest.get("source_commit")
    if commit != expected_source_commit or not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("evidence source_commit differs from the approved Git snapshot")
    files = manifest.get("files")
    if not isinstance(files, list):
        raise ValueError("evidence manifest files must be a list")
    entries: dict[str, dict[str, str]] = {}
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("invalid evidence manifest entry")
        path = item.get("path")
        digest = item.get("sha256")
        storage = item.get("storage")
        if path not in _STORAGE or storage != _STORAGE.get(path):
            raise ValueError(f"evidence path or storage not allowed: {path}")
        if path in entries or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"invalid or duplicate evidence sha256: {path}")
        entries[path] = item
    if relative_path not in entries:
        raise ValueError(f"evidence path missing from manifest: {relative_path}")

    if _STORAGE[relative_path] == "git":
        result = subprocess.run(
            ["git", "show", f"{commit}:{relative_path}"],
            cwd=repo_root,
            capture_output=True,
            check=False,
        )
        if result.returncode:
            raise ValueError(f"Git blob unavailable: {relative_path} at {commit}")
        content = result.stdout
    else:
        try:
            content = (repo_root / relative_path).read_bytes()
        except OSError as exc:
            raise ValueError(f"worktree evidence unavailable: {relative_path}") from exc
    actual = hashlib.sha256(content).hexdigest()
    if actual != entries[relative_path]["sha256"]:
        raise ValueError(f"evidence sha256 mismatch: {relative_path}")
    return content


def read_evidence_text(repo_root: Path, relative_path: str) -> str:
    return read_evidence_bytes(repo_root, relative_path).decode("utf-8")
