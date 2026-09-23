import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "backup_export_allowlist.sh"


class BackupExportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.name = "db-20260923T140000Z-synthetic.dump.age"
        self.ciphertext = b"age-encrypted-test-data"
        (self.root / self.name).write_bytes(self.ciphertext)
        (self.root / (self.name + ".json")).write_text(json.dumps({
            "name": self.name, "sha256": "a" * 64, "bytes": len(self.ciphertext),
            "kind": "synthetic", "source_commit": "b" * 40, "created_unix": 1790162400,
        }))

    def run_export(self, command):
        return subprocess.run(
            ["bash", str(SCRIPT), "--root", str(self.root), "--command", command],
            capture_output=True,
        )

    def test_list_only_includes_completed_ciphertext(self):
        (self.root / "db-20260923T140001Z-synthetic.dump.age.json").write_text("{}")
        result = self.run_export("list")
        self.assertEqual(result.returncode, 0)
        self.assertEqual([x["name"] for x in json.loads(result.stdout)], [self.name])

    def test_get_exports_only_allowlisted_regular_ciphertext(self):
        result = self.run_export("get " + self.name)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, self.ciphertext)
        for command in ("get ../secret", "get /etc/passwd", "get " + self.name + "; id", "id"):
            self.assertNotEqual(self.run_export(command).returncode, 0)
        os.unlink(self.root / self.name)
        os.symlink("/etc/passwd", self.root / self.name)
        self.assertNotEqual(self.run_export("get " + self.name).returncode, 0)


if __name__ == "__main__":
    unittest.main()
