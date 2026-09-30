import os
import subprocess
import tempfile
import unittest
from pathlib import Path


HOSTLAND = Path(__file__).resolve().parents[1]


class ReleaseGuardTest(unittest.TestCase):
    def _run_installer_with_synthetic_release(self, include_runbook):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            hostland = root / "deploy" / "hostland"
            hostland.mkdir(parents=True)
            installer = (HOSTLAND / "install_release.sh").read_text()
            target_guard = '[[ $target == /opt/newscast-production ]] || exit 2'
            staging_guard = (
                '[[ $staging_dir =~ ^/opt/newscast-release-staging-[a-z0-9-]+$ ]] || exit 2'
            )
            self.assertIn(target_guard, installer)
            self.assertIn(staging_guard, installer)
            installer = installer.replace(target_guard, '[[ $target == "$TEST_TARGET" ]] || exit 2')
            installer = installer.replace(staging_guard, '[[ $staging_dir == "$TEST_STAGING" ]] || exit 2')
            (hostland / "install_release.sh").write_text(installer)

            staging = root / "staging"
            staging.mkdir()
            for name in (
                "source.tar.gz", "source.sha256", "image-manifest.json", "runtime.env",
                "backup-recipient.txt", "tls/fullchain.pem", "tls/privkey.pem",
            ):
                path = staging / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("synthetic fixture\n")
            for name in (
                "production.compose.yaml", "production-gateway.conf.template",
                "verify_release.sh", "backup_db_interval.sh", "build_full_backup.sh",
                "backup_export_allowlist.sh", "home_pull_verify.sh",
                "restore_production.sh", "db_fingerprint.py", "prod_smoke.py",
                "cert-health.sh", "certbot-deploy-hook.sh",
            ):
                (hostland / name).write_text("#!/usr/bin/env bash\nexit 0\n")
            systemd = hostland / "systemd"
            systemd.mkdir()
            (systemd / "fixture.service").write_text("synthetic fixture\n")
            (systemd / "fixture.timer").write_text("synthetic fixture\n")

            runbook_content = "Synthetic recovery instructions for this release.\n"
            if include_runbook:
                runbook = root / "docs" / "operations" / "hostland" / "RESTORE_PRODUCTION.md"
                runbook.parent.mkdir(parents=True)
                runbook.write_text(runbook_content)

            target = root / "target"
            env = os.environ.copy()
            env.update(TEST_TARGET=str(target), TEST_STAGING=str(staging))
            result = subprocess.run(
                ["bash", str(hostland / "install_release.sh"), "--staging-dir", str(staging),
                 "--target", str(target)],
                capture_output=True, text=True, env=env,
            )
            return result, target.exists(), (target / "RESTORE.md").read_text() if (
                target / "RESTORE.md").exists() else None

    def test_installer_packages_canonical_restore_runbook(self):
        result, target_exists, packaged_runbook = self._run_installer_with_synthetic_release(True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(target_exists)
        self.assertEqual(packaged_runbook, "Synthetic recovery instructions for this release.\n")

    def test_installer_rejects_missing_runbook_before_creating_target(self):
        result, target_exists, packaged_runbook = self._run_installer_with_synthetic_release(False)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("RESTORE_PRODUCTION.md", result.stderr)
        self.assertFalse(target_exists)
        self.assertIsNone(packaged_runbook)

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
