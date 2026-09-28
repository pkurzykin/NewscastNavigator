import subprocess
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class RetentionGuardTest(unittest.TestCase):
    def test_dry_run_requires_an_explicit_index(self):
        result=subprocess.run(['bash',str(ROOT/'home_retention.sh'),'--dry-run'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertIn('requires --export-index',result.stderr)

    def test_apply_rejects_overridden_production_paths(self):
        result=subprocess.run(['bash',str(ROOT/'home_retention.sh'),'--apply',
                               '--snapshots','/tmp/anything'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertIn('fixed production paths',result.stderr)

if __name__=='__main__': unittest.main()
