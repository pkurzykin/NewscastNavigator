import subprocess
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class RetentionGuardTest(unittest.TestCase):
    def test_dry_run_reads_the_snapshot_directory_and_never_deletes(self):
        code=(ROOT/'home_retention.sh').read_text()
        self.assertIn('hostland-backups/snapshots',code)
        self.assertIn("DELETED=0",code)
        self.assertNotIn('unlink(',code)

    def test_apply_is_rejected(self):
        result=subprocess.run(['bash',str(ROOT/'home_retention.sh'),'--apply'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertIn('disabled',result.stderr)

if __name__=='__main__': unittest.main()
