from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest

from historical_evidence import SOURCE_COMMIT, read_evidence_bytes


HISTORICAL_PATH = "docs/product-reset/EVAL_COMMANDS.json"


def _fixture_repo(tmp_path: Path) -> tuple[Path, str, bytes]:
    repo = tmp_path / "source"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    source = repo / HISTORICAL_PATH
    source.parent.mkdir(parents=True)
    content = b'{"commands": []}\n'
    source.write_bytes(content)
    subprocess.run(["git", "-C", str(repo), "add", HISTORICAL_PATH], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
         "commit", "-qm", "source"],
        check=True,
    )
    commit = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    source.unlink()
    return repo, commit, content


def _write_manifest(repo: Path, commit: str, sha256: str) -> None:
    manifest = repo / "docs/archive/EVIDENCE_MANIFEST.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps({
        "schema_version": 2,
        "source_commit": commit,
        "files": [{"path": HISTORICAL_PATH, "sha256": sha256, "storage": "git"}],
    }), encoding="utf-8")


def test_reads_deleted_file_from_verified_git_blob(tmp_path: Path) -> None:
    repo, commit, content = _fixture_repo(tmp_path)
    _write_manifest(repo, commit, hashlib.sha256(content).hexdigest())

    assert read_evidence_bytes(repo, HISTORICAL_PATH, expected_source_commit=commit) == content


def test_rejects_manifest_hash_mismatch(tmp_path: Path) -> None:
    repo, commit, _ = _fixture_repo(tmp_path)
    _write_manifest(repo, commit, "0" * 64)

    with pytest.raises(ValueError, match="sha256 mismatch"):
        read_evidence_bytes(repo, HISTORICAL_PATH, expected_source_commit=commit)


def test_rejects_missing_git_blob(tmp_path: Path) -> None:
    repo, commit, content = _fixture_repo(tmp_path)
    _write_manifest(repo, commit, hashlib.sha256(content).hexdigest())
    # A valid commit with no evidence path must fail instead of falling back to checkout.
    subprocess.run(["git", "-C", str(repo), "rm", "-q", "--cached", "--ignore-unmatch", HISTORICAL_PATH], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
         "commit", "-qm", "removed"],
        check=True,
    )
    absent_commit = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    _write_manifest(repo, absent_commit, hashlib.sha256(content).hexdigest())
    (repo / HISTORICAL_PATH).write_bytes(content)

    with pytest.raises(ValueError, match="Git blob unavailable"):
        read_evidence_bytes(repo, HISTORICAL_PATH, expected_source_commit=absent_commit)


def test_rejects_unlisted_path_and_wrong_source_commit(tmp_path: Path) -> None:
    repo, commit, content = _fixture_repo(tmp_path)
    _write_manifest(repo, commit, hashlib.sha256(content).hexdigest())

    with pytest.raises(ValueError, match="not allowed"):
        read_evidence_bytes(repo, "docs/product-reset/other.txt", expected_source_commit=commit)
    with pytest.raises(ValueError, match="source_commit"):
        read_evidence_bytes(repo, HISTORICAL_PATH, expected_source_commit=SOURCE_COMMIT)
