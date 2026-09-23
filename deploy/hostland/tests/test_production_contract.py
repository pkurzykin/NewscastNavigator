"""The public stack must fail closed before the DNS cutover."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


HOSTLAND = Path(__file__).resolve().parents[1]
COMPOSE = HOSTLAND / "production.compose.yaml"


class ProductionContractTest(unittest.TestCase):
    def test_gateway_starts_in_maintenance_and_reserves_http_for_acme(self):
        template = (HOSTLAND / "production-gateway.conf.template").read_text()
        self.assertIn("location ^~ /.well-known/acme-challenge/", template)
        self.assertIn("return 301 https://$host$request_uri;", template)
        self.assertIn("listen 443 ssl;", template)
        self.assertIn("set $maintenance_mode ${NGINX_MAINTENANCE};", template)
        self.assertGreaterEqual(template.count("if ($maintenance_mode = on)"), 3)
        self.assertIn("proxy_set_header X-Forwarded-Proto $scheme;", template)

    def test_compose_uses_immutable_images_and_exposes_only_loopback_gateway(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = Path(tmp) / "synthetic.env"
            images = {name: "sha256:" + ch * 64 for name, ch in zip(
                ("DB_IMAGE", "BACKEND_IMAGE", "FRONTEND_IMAGE", "GATEWAY_IMAGE"),
                "abcd",
            )}
            values = {
                **images,
                "POSTGRES_DB": "synthetic",
                "POSTGRES_USER": "synthetic",
                "POSTGRES_PASSWORD": "synthetic-only",
                "DATABASE_URL": "postgresql://synthetic:synthetic-only@db/synthetic",
                "SECRET_KEY": "synthetic-key-only",
                "CORS_ORIGINS": "https://ncastnav.ru,null",
                "NGINX_SERVER_NAME": "ncastnav.ru www.ncastnav.ru",
            }
            env.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
            result = subprocess.run(
                ["docker", "compose", "--project-name", "nn-hostland-contract",
                 "--env-file", str(env), "-f", str(COMPOSE), "config", "--format", "json"],
                text=True, capture_output=True, check=True,
            )
            services = json.loads(result.stdout)["services"]
            self.assertEqual(set(services), {"db", "backend", "frontend", "gateway"})
            for name, service in services.items():
                self.assertEqual(service["image"], images[f"{name.upper()}_IMAGE"])
                self.assertNotIn("build", service)
                self.assertEqual(service["pull_policy"], "never")
                if name != "gateway":
                    self.assertNotIn("ports", service)
            self.assertEqual(
                {(port["host_ip"], port["published"], port["target"])
                 for port in services["gateway"]["ports"]},
                {("127.0.0.1", "8088", 80), ("127.0.0.1", "8443", 443)},
            )
            self.assertEqual(services["backend"]["environment"]["SEED_DEMO_DATA"], "false")
            self.assertEqual(services["gateway"]["environment"]["NGINX_MAINTENANCE"], "on")
            self.assertIn("Host: ncastnav.ru", services["gateway"]["healthcheck"]["test"][1])


if __name__ == "__main__":
    unittest.main()
