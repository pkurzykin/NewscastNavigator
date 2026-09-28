"""Safety contract for the privileged, production-only VDS backup pruner."""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vds_prune import PruneError, prune_one, validate_request  # noqa: E402
import vds_prune  # noqa: E402


NOW = int(datetime(2026, 9, 28, 18, tzinfo=timezone.utc).timestamp())
COMMIT = "a" * 40


class BackupPruneTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.export = self.base / "export"
        self.journal = self.base / "journal"
        self.export.mkdir()
        self.journal.mkdir()
        self.full = self.add_point("full", NOW - 60 * 86400)
        self.old = self.add_point("db", NOW - 31 * 86400)
        self.add_point("db", NOW - 2 * 86400)
        self.add_point("db", NOW - 1 * 86400)

    def add_point(self, type_, created, commit=COMMIT):
        stamp = datetime.fromtimestamp(created, timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        suffix = "dump" if type_ == "db" else "tar"
        name = f"{type_}-{stamp}-production.{suffix}.age"
        payload = f"synthetic:{name}".encode()
        item = {
            "name": name, "kind": "production", "source_commit": commit,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "bytes": len(payload), "created_unix": created,
        }
        (self.export / name).write_bytes(payload)
        (self.export / (name + ".json")).write_text(json.dumps(item))
        return item

    def request(self, item=None, **updates):
        item = item or self.old
        return dict(version=1, home_unix=NOW, name=item["name"],
                    sha256=item["sha256"], bytes=item["bytes"], **updates)

    def prune(self, item=None, **updates):
        return prune_one(self.request(item, **updates), self.export,
                         self.journal, NOW, synchronized=True)

    def test_deletes_only_old_requested_pair_then_returns_idempotent_receipt(self):
        receipt = self.prune()
        self.assertEqual(receipt, {"status": "deleted", "name": self.old["name"],
                                   "sha256": self.old["sha256"], "bytes": self.old["bytes"]})
        self.assertFalse((self.export / self.old["name"]).exists())
        self.assertFalse((self.export / (self.old["name"] + ".json")).exists())
        self.assertTrue((self.export / self.full["name"]).exists())
        self.assertEqual(self.prune()["status"], "already_deleted")

    def test_rejects_live_point_digest_size_and_path(self):
        newest = max((json.loads(p.read_text()) for p in self.export.glob("db-*.json")),
                     key=lambda x: x["created_unix"])
        with self.assertRaises(PruneError):
            self.prune(newest)
        for request in (
            dict(self.request(), sha256="0" * 64),
            dict(self.request(), bytes=self.old["bytes"] + 1),
            dict(self.request(), name="../" + self.old["name"]),
            dict(self.request(), name="db-20260828T180000Z-synthetic.dump.age"),
        ):
            with self.assertRaises(PruneError):
                prune_one(request, self.export, self.journal, NOW, synchronized=True)
        self.assertTrue((self.export / self.old["name"]).exists())

    def test_rejects_unsynchronized_or_distant_home_clock(self):
        with self.assertRaises(PruneError):
            prune_one(self.request(), self.export, self.journal, NOW, synchronized=False)
        with self.assertRaises(PruneError):
            prune_one(dict(self.request(), home_unix=NOW - 61), self.export,
                      self.journal, NOW, synchronized=True)

    def test_rejects_unknown_or_orphan_or_symlink_entries(self):
        extra = self.export / "unexpected.txt"
        extra.write_text("stop")
        with self.assertRaises(PruneError):
            self.prune()
        extra.unlink()
        (self.export / (self.full["name"] + ".json")).unlink()
        with self.assertRaises(PruneError):
            self.prune()
        (self.export / (self.full["name"] + ".json")).write_text(json.dumps(self.full))
        archive = self.export / self.full["name"]
        archive.unlink()
        archive.symlink_to(self.export / self.old["name"])
        with self.assertRaises(PruneError):
            self.prune()

    def test_future_or_malformed_point_blocks_whole_prune(self):
        future = self.add_point("db", NOW + 61)
        with self.assertRaises(PruneError):
            self.prune()
        (self.export / future["name"]).unlink()
        (self.export / (future["name"] + ".json")).unlink()
        target_meta = self.export / (self.old["name"] + ".json")
        target_meta.write_text('{"name":"x","name":"y"}')
        with self.assertRaises(PruneError):
            self.prune()

    def test_synthetic_pair_is_never_a_candidate(self):
        name = self.old["name"].replace("production", "synthetic")
        (self.export / name).write_bytes(b"synthetic")
        (self.export / (name + ".json")).write_text("{}")
        self.assertEqual(self.prune()["status"], "deleted")
        self.assertTrue((self.export / name).exists())

    def test_orphan_synthetic_rehearsal_archive_does_not_block_production(self):
        name = self.old["name"].replace("production", "synthetic")
        (self.export / name).write_bytes(b"synthetic orphan")
        self.assertEqual(self.prune()["status"], "deleted")
        self.assertTrue((self.export / name).exists())

    def test_quarantined_synthetic_rehearsal_metadata_is_ignored(self):
        fixture = self.export / ".invalid-full-20260923T135610Z-synthetic.tar.age.json"
        fixture.write_text("{}")
        damaged = self.export / "full-20260923T135610Z-synthetic.tar.age.INVALID"
        damaged.write_bytes(b"synthetic invalid fixture")
        self.assertEqual(self.prune()["status"], "deleted")
        self.assertTrue(fixture.exists())
        self.assertTrue(damaged.exists())

    def test_vds_enforces_daily_cap_independently_of_home(self):
        another_old = self.add_point("db", NOW - 32 * 86400)
        with patch.object(vds_prune, "MAX_DB_PER_RUN", 1):
            self.assertEqual(self.prune(another_old)["status"], "deleted")
            with self.assertRaises(PruneError):
                self.prune(self.old)
        self.assertTrue((self.export / self.old["name"]).exists())

    def test_recovers_intent_after_only_ciphertext_was_removed(self):
        def interrupted(stage):
            if stage == "after_ciphertext":
                raise RuntimeError("synthetic interruption")

        with self.assertRaises(RuntimeError):
            prune_one(self.request(), self.export, self.journal, NOW,
                      synchronized=True, checkpoint=interrupted)
        self.assertFalse((self.export / self.old["name"]).exists())
        self.assertTrue((self.export / (self.old["name"] + ".json")).exists())
        self.assertEqual(self.prune()["status"], "deleted")
        self.assertEqual(self.prune()["status"], "already_deleted")

    def test_recovers_intent_after_both_files_were_removed(self):
        def interrupted(stage):
            if stage == "after_metadata":
                raise RuntimeError("synthetic interruption")

        with self.assertRaises(RuntimeError):
            prune_one(self.request(), self.export, self.journal, NOW,
                      synchronized=True, checkpoint=interrupted)
        self.assertEqual(self.prune()["status"], "already_deleted")

    def test_rechecks_clock_after_digest_and_before_unlink(self):
        with self.assertRaises(PruneError):
            prune_one(self.request(), self.export, self.journal, NOW,
                      synchronized=True, clock_now=lambda: NOW + 61)
        self.assertTrue((self.export / self.old["name"]).exists())

    def test_full_deletion_preserves_recent_eight_weeks_and_db_release(self):
        for path in self.export.iterdir():
            path.unlink()
        old_full = self.add_point("full", NOW - 70 * 86400, commit="b" * 40)
        old_db = self.add_point("db", NOW - 35 * 86400, commit="b" * 40)
        for weeks_ago in range(8):
            self.add_point("full", NOW - weeks_ago * 7 * 86400, commit=COMMIT)
        self.add_point("db", NOW - 2 * 86400)
        self.add_point("db", NOW - 1 * 86400)
        with self.assertRaises(PruneError):
            self.prune(old_full)
        self.assertEqual(self.prune(old_db)["status"], "deleted")
        self.assertEqual(self.prune(old_full)["status"], "deleted")
        self.assertEqual(len(list(self.export.glob("full-*.age"))), 8)

    def test_rejects_orphan_without_journal_and_corrupt_target(self):
        (self.export / (self.old["name"] + ".json")).unlink()
        with self.assertRaises(PruneError):
            self.prune()
        (self.export / (self.old["name"] + ".json")).write_text(json.dumps(self.old))
        (self.export / self.old["name"]).write_bytes(b"wrong")
        with self.assertRaises(PruneError):
            self.prune()

    def test_request_strict_schema_and_forced_command_only(self):
        for request in ({}, dict(self.request(), extra="x"),
                        dict(self.request(), version=True),
                        dict(self.request(), home_unix="now")):
            with self.assertRaises(PruneError):
                validate_request(request)
        script = ROOT / "backup_prune_allowlist.sh"
        for command in ("id", "prune ../secret", "prune; id", "get " + self.old["name"]):
            result = subprocess.run(["bash", str(script)], input=json.dumps(self.request()),
                                    text=True, capture_output=True,
                                    env=dict(os.environ, SSH_ORIGINAL_COMMAND=command))
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
