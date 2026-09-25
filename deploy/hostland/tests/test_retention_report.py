"""Read-only inventory of VDS export points and home snapshots."""

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "home_retention.sh"
COMMIT = "a" * 40


def point(name, payload, created, source_commit=COMMIT):
    return {
        "name": name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
        "kind": "production",
        "source_commit": source_commit,
        "created_unix": created,
    }


def write_snapshot(root, item, payload):
    (root / item["name"]).write_bytes(payload)
    (root / (item["name"] + ".sha256")).write_text(
        f'{item["sha256"]}  {item["name"]}\n'
    )


class RetentionReportTest(unittest.TestCase):
    def test_reports_current_matching_chain_without_changing_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshots = root / "snapshots"
            snapshots.mkdir()
            full = point("full-20260923T182129Z-production.tar.age", b"full", 200)
            older = point("db-20260925T170001Z-production.dump.age", b"old", 300)
            latest = point("db-20260925T170501Z-production.dump.age", b"new", 400)
            index = root / "index.json"
            index.write_text(json.dumps([full, older, latest]))
            for item, payload in ((full, b"full"), (older, b"old"), (latest, b"new")):
                write_snapshot(snapshots, item, payload)
            before = {p.name: p.read_bytes() for p in snapshots.iterdir()}

            result = subprocess.run(
                ["bash", str(SCRIPT), "--dry-run", "--export-index", str(index),
                 "--snapshots", str(snapshots)], capture_output=True, text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["vds_db_points"], 2)
            self.assertEqual(report["vds_full_points"], 1)
            self.assertEqual(report["latest_db"], latest["name"])
            self.assertEqual(report["latest_full"], full["name"])
            self.assertTrue(report["latest_chain_ready_at_home"])
            self.assertEqual(report.get("status"), "ready")
            self.assertEqual(report.get("vds_total_bytes"), 10)
            self.assertEqual(report.get("home_bytes_matching_index"), 10)
            self.assertEqual(report.get("chains"), [{
                "source_commit": COMMIT,
                "db_points": 2,
                "full_points": 1,
                "home_db_points": 2,
                "home_full_points": 1,
                "vds_bytes": 10,
                "home_bytes_matching_index": 10,
            }])
            self.assertIs(report.get("ciphertext_rehashed"), False)
            self.assertIs(report.get("policy_approved"), False)
            self.assertEqual(report["deleted"], 0)
            self.assertEqual(before, {p.name: p.read_bytes() for p in snapshots.iterdir()})

    def test_flags_database_without_matching_full_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshots = root / "snapshots"
            snapshots.mkdir()
            db = point("db-20260925T170501Z-production.dump.age", b"database", 400)
            index = root / "index.json"
            index.write_text(json.dumps([db]))
            write_snapshot(snapshots, db, b"database")

            result = subprocess.run(
                ["bash", str(SCRIPT), "--dry-run", "--export-index", str(index),
                 "--snapshots", str(snapshots)], capture_output=True, text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report.get("vds_db_without_full"), 1)
            self.assertIsNone(report["latest_full"])
            self.assertEqual(report.get("status"), "attention")

    def test_full_from_another_release_cannot_complete_database_chain(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshots = root / "snapshots"
            snapshots.mkdir()
            full = point(
                "full-20260923T182129Z-production.tar.age", b"full", 200,
                source_commit="b" * 40,
            )
            db = point("db-20260925T170501Z-production.dump.age", b"database", 400)
            index = root / "index.json"
            index.write_text(json.dumps([full, db]))
            write_snapshot(snapshots, full, b"full")
            write_snapshot(snapshots, db, b"database")

            result = subprocess.run(
                ["bash", str(SCRIPT), "--dry-run", "--export-index", str(index),
                 "--snapshots", str(snapshots)], capture_output=True, text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertFalse(report["latest_chain_ready_at_home"])
            self.assertEqual(report["vds_db_without_full"], 1)
            self.assertEqual(len(report["chains"]), 2)

    def test_flags_missing_home_full_without_claiming_ready_chain(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshots = root / "snapshots"
            snapshots.mkdir()
            full = point("full-20260923T182129Z-production.tar.age", b"full", 200)
            db = point("db-20260925T170501Z-production.dump.age", b"database", 400)
            index = root / "index.json"
            index.write_text(json.dumps([full, db]))
            write_snapshot(snapshots, db, b"database")

            result = subprocess.run(
                ["bash", str(SCRIPT), "--dry-run", "--export-index", str(index),
                 "--snapshots", str(snapshots)], capture_output=True, text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertFalse(report["latest_chain_ready_at_home"])
            self.assertEqual(report.get("home_missing_or_invalid"), 1)
            self.assertEqual(report.get("status"), "attention")

    def test_rejects_duplicate_production_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshots = root / "snapshots"
            snapshots.mkdir()
            db = point("db-20260925T170501Z-production.dump.age", b"database", 400)
            index = root / "index.json"
            index.write_text(json.dumps([db, db]))

            result = subprocess.run(
                ["bash", str(SCRIPT), "--dry-run", "--export-index", str(index),
                 "--snapshots", str(snapshots)], capture_output=True, text=True,
            )

            self.assertEqual(result.returncode, 2)
            self.assertIn("Invalid production point", result.stderr)

    def test_rejects_production_name_labeled_synthetic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshots = root / "snapshots"
            snapshots.mkdir()
            db = point("db-20260925T170501Z-production.dump.age", b"database", 400)
            db["kind"] = "synthetic"
            index = root / "index.json"
            index.write_text(json.dumps([db]))

            result = subprocess.run(
                ["bash", str(SCRIPT), "--dry-run", "--export-index", str(index),
                 "--snapshots", str(snapshots)], capture_output=True, text=True,
            )

            self.assertEqual(result.returncode, 2)
            self.assertIn("kind", result.stderr.lower())

    def test_symlinked_checksum_does_not_count_as_home_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshots = root / "snapshots"
            snapshots.mkdir()
            db = point("db-20260925T170501Z-production.dump.age", b"database", 400)
            index = root / "index.json"
            index.write_text(json.dumps([db]))
            (snapshots / db["name"]).write_bytes(b"database")
            checksum = root / "elsewhere.sha256"
            checksum.write_text(f'{db["sha256"]}  {db["name"]}\n')
            (snapshots / (db["name"] + ".sha256")).symlink_to(checksum)

            result = subprocess.run(
                ["bash", str(SCRIPT), "--dry-run", "--export-index", str(index),
                 "--snapshots", str(snapshots)], capture_output=True, text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report.get("home_missing_or_invalid"), 1)
            self.assertEqual(report["deleted"], 0)


if __name__ == "__main__":
    unittest.main()
