import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "backup_db_interval.sh"
FULL_SCRIPT = Path(__file__).resolve().parents[1] / "build_full_backup.sh"
PULL_SCRIPT = Path(__file__).resolve().parents[1] / "home_pull_verify.sh"


class BackupGuardTest(unittest.TestCase):
    def test_stored_ciphertext_is_rehashed_before_chain_success(self):
        code = PULL_SCRIPT.read_text()
        existing = code.split('if [[ -e $archive || -L $archive ]]; then', 1)[1].split('continue', 1)[0]
        self.assertIn('sha256sum "$archive"', existing)
        self.assertIn('== "$digest"', existing)

    def test_full_backup_pins_one_tls_version_for_both_files(self):
        code = FULL_SCRIPT.read_text()
        self.assertIn('tls_version=$(readlink "$runtime_dir/tls/active")', code)
        self.assertIn('tls_source=$runtime_dir/tls/$tls_version', code)
        self.assertIn('cp "$tls_source/fullchain.pem" "$tls_source/privkey.pem"', code)

    def test_home_pull_rejects_unknown_kind_before_network(self):
        result = subprocess.run(
            ["bash", str(PULL_SCRIPT), "--kind", "unexpected"], capture_output=True,
        )
        self.assertEqual(result.returncode, 2)

    def test_full_backup_rejects_production_kind_on_eval_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["bash", str(FULL_SCRIPT), "--kind", "production", "--project",
                 "nn-product-reset-eval-hostland-130", "--runtime-dir", tmp,
                 "--export-dir", tmp], capture_output=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertFalse(list(Path(tmp).iterdir()))

    def test_production_kind_rejects_an_eval_project_before_touching_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["bash", str(SCRIPT), "--kind", "production", "--project",
                 "nn-product-reset-eval-hostland-130", "--runtime-dir", tmp,
                 "--export-dir", tmp], capture_output=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertFalse(list(Path(tmp).iterdir()))

    def test_synthetic_kind_rejects_a_production_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["bash", str(SCRIPT), "--kind", "synthetic", "--project",
                 "newscast_navigator_production", "--runtime-dir", tmp,
                 "--export-dir", tmp], capture_output=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertFalse(list(Path(tmp).iterdir()))


if __name__ == "__main__":
    unittest.main()
