import subprocess
import tempfile
import unittest
from pathlib import Path


HOSTLAND = Path(__file__).resolve().parents[1]


class ReleaseGuardTest(unittest.TestCase):
    def test_acme_webroot_is_readable_by_unprivileged_gateway_worker(self):
        installer = (HOSTLAND / "install_release.sh").read_text()
        self.assertIn('install -d -m 0755 "$target/acme-webroot"', installer)

    def test_installer_refuses_any_target_other_than_the_dedicated_production_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["bash", str(HOSTLAND / "install_release.sh"), "--staging-dir", tmp,
                 "--target", tmp], capture_output=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertFalse(list(Path(tmp).iterdir()))

    def test_verifier_refuses_incomplete_runtime_before_docker(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["bash", str(HOSTLAND / "verify_release.sh"), "--runtime-dir", tmp],
                capture_output=True,
            )
            self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
