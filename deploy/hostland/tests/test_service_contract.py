import unittest
from pathlib import Path


UNITS = Path(__file__).resolve().parents[1] / "systemd"


class ServiceContractTest(unittest.TestCase):
    def test_production_restart_never_builds_or_pulls(self):
        unit = (UNITS / "newscast-production.service").read_text()
        self.assertIn("--project-name newscast_navigator_production", unit)
        self.assertIn("up -d --no-build --pull never --wait", unit)
        self.assertIn("ExecStartPre=/opt/newscast-production/verify_release.sh", unit)
        self.assertNotIn("docker build", unit)

    def test_backup_timers_are_frequent_but_retention_is_not_enabled(self):
        backup = (UNITS / "backup.timer").read_text()
        pull = (UNITS / "home-pull.timer").read_text()
        self.assertIn("*:0/5:00", backup)
        self.assertIn("*:0/2:00", pull)
        self.assertFalse((UNITS / "home-retention.timer").exists())


if __name__ == "__main__":
    unittest.main()
