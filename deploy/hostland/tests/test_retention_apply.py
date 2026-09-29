"""Home coordinator integration with a synthetic, restricted VDS endpoint."""

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "home_retention.sh"
NOW = int(datetime(2026, 12, 7, 12, tzinfo=timezone.utc).timestamp())
DAY = 86400
COMMIT = "a" * 40


def point(prefix, age_days, payload):
    created = NOW - age_days * DAY
    stamp = datetime.fromtimestamp(created, timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = (f"db-{stamp}-production.dump.age" if prefix == "db"
            else f"full-{stamp}-production.tar.age")
    return {"name": name, "kind": "production", "sha256": hashlib.sha256(payload).hexdigest(),
            "bytes": len(payload), "source_commit": COMMIT, "created_unix": created}


class HomeRetentionApplyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.base = self.root / "base"
        (self.base / "snapshots").mkdir(parents=True)
        (self.base / "monitor").mkdir()
        self.index = self.root / "index.json"
        self.events = self.root / "events.json"
        self.fail_once = self.root / "fail-once"
        self.list_count = self.root / "list-count"
        self.full = point("full", 8, b"full")
        self.old = point("db", 31, b"old")
        self.newer = point("db", 2, b"newer")
        self.latest = point("db", 0, b"latest")
        self.items = [self.full, self.old, self.newer, self.latest]
        self.index.write_text(json.dumps(self.items))
        for item, payload in zip(self.items, (b"full", b"old", b"newer", b"latest")):
            path = self.base / "snapshots" / item["name"]
            path.write_bytes(payload)
            (path.parent / (path.name + ".sha256")).write_text(
                f'{item["sha256"]}  {item["name"]}\n'
            )
        (self.base / "monitor" / "latest-production.json").write_text(json.dumps({
            "db_created_unix": self.latest["created_unix"], "verified_unix": NOW,
        }))
        self.exporter = self.root / "exporter.py"
        self.exporter.write_text(
            "#!/usr/bin/env python3\nimport json,os\nfrom pathlib import Path\n"
            "index=Path(os.environ['NN_RETENTION_TEST_INDEX'])\n"
            "count=Path(os.environ['NN_RETENTION_TEST_LIST_COUNT'])\n"
            "calls=int(count.read_text())+1 if count.exists() else 1\n"
            "count.write_text(str(calls))\n"
            "if os.environ.get('NN_RETENTION_TEST_REPAIR_ON_SECOND_LIST')=='1' and calls==2:\n"
            "  item=max(json.loads(index.read_text()),key=lambda x:x['created_unix'])\n"
            "  p=Path(os.environ['NN_RETENTION_TEST_BASE'])/'snapshots'/item['name']\n"
            "  p.write_bytes(b'latest')\n"
            "  (p.parent/(p.name+'.sha256')).write_text(item['sha256']+'  '+p.name+'\\n')\n"
            "print(index.read_text(),end='')\n"
        )
        self.pruner = self.root / "pruner.py"
        self.pruner.write_text(
            "#!/usr/bin/env python3\n"
            "import json,os,sys\nfrom pathlib import Path\n"
            "req=json.load(sys.stdin)\n"
            "p=Path(os.environ['NN_RETENTION_TEST_INDEX']); items=json.loads(p.read_text())\n"
            "found=[x for x in items if x['name']==req['name']]\n"
            "if found: p.write_text(json.dumps([x for x in items if x['name']!=req['name']]))\n"
            "flag=Path(os.environ['NN_RETENTION_TEST_FAIL_ONCE'])\n"
            "if flag.exists(): flag.unlink(); sys.exit(9)\n"
            "print(json.dumps({'status':'deleted' if found else 'already_deleted',"
            "'name':req['name'],'sha256':req['sha256'],'bytes':req['bytes']}))\n"
        )
        self.exporter.chmod(0o700)
        self.pruner.chmod(0o700)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        # macOS test host has no flock CLI; lock semantics are checked on Linux.
        shim = self.bin / "flock"
        shim.write_text("#!/bin/sh\nexit 0\n")
        shim.chmod(0o700)

    def run_apply(self, *, stop_after_home_archive=False,
                  repair_after_first_list=False):
        env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                   NN_RETENTION_TEST_MODE="1",
                   NN_RETENTION_TEST_BASE=str(self.base),
                   NN_RETENTION_TEST_INDEX=str(self.index),
                   NN_RETENTION_TEST_EXPORT=str(self.exporter),
                   NN_RETENTION_TEST_PRUNE=str(self.pruner),
                   NN_RETENTION_TEST_FAIL_ONCE=str(self.fail_once),
                   NN_RETENTION_TEST_LIST_COUNT=str(self.list_count),
                   NN_RETENTION_TEST_NOW=str(NOW))
        if stop_after_home_archive:
            env["NN_RETENTION_TEST_STOP_AFTER_HOME_ARCHIVE"] = "1"
        if repair_after_first_list:
            env["NN_RETENTION_TEST_REPAIR_ON_SECOND_LIST"] = "1"
        return subprocess.run(["bash", str(SCRIPT), "--apply"],
                              env=env, capture_output=True, text=True)

    def test_applies_only_old_point_and_keeps_current_chain(self):
        result = self.run_apply()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.base / "snapshots" / self.old["name"]).exists())
        self.assertFalse((self.base / "snapshots" / (self.old["name"] + ".sha256")).exists())
        self.assertTrue((self.base / "snapshots" / self.latest["name"]).exists())
        self.assertEqual(len(json.loads(self.index.read_text())), 3)
        self.assertEqual(json.loads((self.base / "monitor" / "retention-status.json").read_text())["status"], "ok")

    def test_missing_home_point_prevents_any_vds_request(self):
        (self.base / "snapshots" / self.newer["name"]).unlink()
        result = self.run_apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(json.loads(self.index.read_text())), 4)
        self.assertTrue((self.base / "snapshots" / self.old["name"]).exists())
        self.assertEqual(json.loads((self.base / "monitor" / "retention-status.json").read_text())["status"], "failed")

    def test_waits_for_normal_pull_when_newest_vds_point_is_temporarily_missing_home(self):
        latest_path = self.base / "snapshots" / self.latest["name"]
        latest_path.unlink()
        (latest_path.parent / (latest_path.name + ".sha256")).unlink()
        result = self.run_apply(repair_after_first_list=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertGreaterEqual(int(self.list_count.read_text()), 2)
        self.assertTrue(latest_path.exists())
        self.assertEqual(json.loads((self.base / "monitor" / "retention-status.json").read_text())["status"], "ok")

    def test_retries_after_vds_deleted_but_reply_was_lost(self):
        self.fail_once.write_text("fail once")
        first = self.run_apply()
        self.assertNotEqual(first.returncode, 0)
        self.assertTrue((self.base / "monitor" / "retention-pending.json").exists())
        self.assertTrue((self.base / "snapshots" / self.old["name"]).exists())
        second = self.run_apply()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertFalse((self.base / "snapshots" / self.old["name"]).exists())
        self.assertFalse((self.base / "monitor" / "retention-pending.json").exists())
        self.assertEqual(json.loads((self.base / "monitor" / "retention-status.json").read_text())["status"], "ok")

    def test_pending_retry_cannot_delete_vds_when_home_ciphertext_changed(self):
        pending = self.base / "monitor" / "retention-pending.json"
        pending.write_text(json.dumps({"version": 1, "home_unix": NOW,
                                       "name": self.old["name"],
                                       "sha256": self.old["sha256"],
                                       "bytes": self.old["bytes"]}))
        (self.base / "snapshots" / self.old["name"]).write_bytes(b"bad")
        result = self.run_apply()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(json.loads(self.index.read_text())), 4)
        self.assertTrue(pending.exists())
        self.assertEqual(json.loads((self.base / "monitor" / "retention-status.json").read_text())["status"], "failed")

    def test_resumes_local_cleanup_after_archive_unlink_without_second_vds_prune(self):
        first = self.run_apply(stop_after_home_archive=True)
        self.assertNotEqual(first.returncode, 0)
        pending = self.base / "monitor" / "retention-pending.json"
        self.assertEqual(json.loads(pending.read_text())["phase"], "remote_done")
        self.assertFalse((self.base / "snapshots" / self.old["name"]).exists())
        self.assertTrue((self.base / "snapshots" / (self.old["name"] + ".sha256")).exists())
        self.assertEqual(len(json.loads(self.index.read_text())), 3)
        # The second run finishes only the local pair and clears the journal.
        self.assertEqual(self.run_apply().returncode, 0)
        self.assertFalse(pending.exists())
        self.assertFalse((self.base / "snapshots" / (self.old["name"] + ".sha256")).exists())


if __name__ == "__main__":
    unittest.main()
