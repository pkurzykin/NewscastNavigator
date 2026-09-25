"""Safety boundary for the production backup disaster drill."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "rehearse_home_loss.sh"


class HomeLossRehearsalGuardTest(unittest.TestCase):
    def test_rejects_production_runtime_before_running_docker(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "docker-called"
            fake_docker = Path(tmp) / "docker"
            fake_docker.write_text(f"#!/bin/sh\ntouch '{marker}'\nexit 0\n")
            fake_docker.chmod(0o755)
            env = {**os.environ, "PATH": f"{tmp}:{os.environ['PATH']}"}
            result = subprocess.run(
                ["bash", str(SCRIPT), "--workspace", "/opt/newscast-production",
                 "--db-name", "db-20260925T170001Z-production.dump.age",
                 "--full-name", "full-20260923T182129Z-production.tar.age"],
                capture_output=True, text=True, env=env,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("workspace", result.stderr.lower())
            self.assertFalse(marker.exists())

    def test_rejects_path_traversal_in_archive_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                ["bash", str(SCRIPT), "--workspace", str(Path(tmp) / "home-loss-1c"),
                 "--db-name", "../database.dump.age",
                 "--full-name", "full-20260923T182129Z-production.tar.age"],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("name", result.stderr.lower())


if __name__ == "__main__":
    unittest.main()
