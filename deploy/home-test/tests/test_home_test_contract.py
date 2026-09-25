"""Safety contract for the persistent LAN-only test stack."""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


HOME_TEST = Path(__file__).resolve().parents[1]
COMPOSE = HOME_TEST / "compose.yaml"
GATEWAY = HOME_TEST / "gateway.conf.template"
ENV_EXAMPLE = HOME_TEST / "env.example"


class HomeTestContractTest(unittest.TestCase):
    def test_example_environment_is_private_and_not_ready_to_run(self):
        self.assertTrue(ENV_EXAMPLE.is_file(), "home-test env example is missing")
        values = dict(
            line.split("=", 1) for line in ENV_EXAMPLE.read_text().splitlines()
            if line and not line.startswith("#")
        )
        self.assertNotIn("HOME_TEST_BIND_IP", values)
        self.assertEqual(
            values["CORS_ORIGINS"],
            f'https://{values["HOME_TEST_SERVER_NAME"]}:{values["HOME_TEST_HTTPS_PORT"]},null',
        )
        self.assertEqual(values["HOME_TEST_SERVER_NAME"], "192.168.2.200")
        self.assertIn("change-this", values["POSTGRES_PASSWORD"])
        self.assertIn("change-this", values["SECRET_KEY"])
        self.assertIn("change-this", values["HOME_TEST_DB_IMAGE"])
        self.assertTrue(values["HOME_TEST_TLS_DIR"].startswith("/home/newscast/"))

    def test_gateway_restricts_hosts_and_clients_before_proxying(self):
        self.assertTrue(GATEWAY.is_file(), "LAN gateway template is missing")
        config = GATEWAY.read_text()
        self.assertIn("listen 443 ssl default_server;", config)
        self.assertNotIn("listen 80", config)
        self.assertIn("if ($host != ${HOME_TEST_SERVER_NAME}) { return 444; }", config)
        self.assertIn("allow 192.168.2.0/24;", config)
        self.assertIn("allow 127.0.0.1;", config)
        self.assertIn("deny all;", config)
        self.assertNotIn("/__gateway_health", config)
        self.assertNotIn("return 200", config)
        self.assertIn("ssl_certificate /etc/nginx/certs/fullchain.pem;", config)
        self.assertIn("ssl_certificate_key /etc/nginx/certs/privkey.pem;", config)
        self.assertIn("proxy_pass http://newscast_backend;", config)
        self.assertIn("proxy_pass http://newscast_frontend;", config)

    def test_rendered_compose_exposes_only_https_on_selected_lan_ip(self):
        if not shutil.which("docker"):
            self.skipTest("Docker Compose is unavailable")
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / "home-test.env"
            env.write_text("\n".join((
                "POSTGRES_DB=nn_home_test",
                "POSTGRES_USER=nn_home_test",
                "POSTGRES_PASSWORD=" + "b" * 32,
                "DATABASE_URL=postgresql+psycopg://nn_home_test:" + "b" * 32 + "@db:5432/nn_home_test",
                "SECRET_KEY=" + "s" * 32,
                "CORS_ORIGINS=https://192.168.2.200:18443,null",
                "HOME_TEST_HTTPS_PORT=18443",
                "HOME_TEST_SERVER_NAME=192.168.2.200",
                "HOME_TEST_TLS_DIR=" + tmp,
                "HOME_TEST_DB_IMAGE=postgres:16-alpine",
                "",
            )))
            result = subprocess.run(
                ["docker", "compose", "--env-file", str(env), "-f", str(COMPOSE),
                 "config", "--format", "json"], capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            rendered = json.loads(result.stdout)

        self.assertEqual(rendered["name"], "newscast_navigator_home_test")
        services = rendered["services"]
        self.assertEqual(set(services), {"db", "backend", "frontend", "gateway"})
        self.assertEqual(services["gateway"]["ports"], [{
            "mode": "ingress", "target": 443, "published": "18443",
            "protocol": "tcp", "host_ip": "192.168.2.200",
        }])
        self.assertIn(
            "Host: 192.168.2.200",
            services["gateway"]["healthcheck"]["test"][1],
        )
        self.assertIn("/api/health", services["gateway"]["healthcheck"]["test"][1])
        self.assertNotIn("HOME_TEST_BIND_IP", COMPOSE.read_text())
        self.assertNotIn("0.0.0.0", COMPOSE.read_text())
        for name in ("db", "backend", "frontend"):
            self.assertFalse(services[name].get("ports"), name)
        self.assertEqual(services["backend"]["environment"]["ENVIRONMENT"], "production")
        self.assertEqual(services["backend"]["environment"]["SEED_DEMO_DATA"], "false")
        self.assertEqual(services["backend"]["environment"]["SESSION_COOKIE_SECURE"], "true")
        self.assertIn("home_test_pg_data", rendered["volumes"])
        self.assertNotIn("production_pg_data", rendered["volumes"])


if __name__ == "__main__":
    unittest.main()
