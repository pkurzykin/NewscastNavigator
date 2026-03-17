#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/compose.yaml"
ENV_FILE="${ROOT_DIR}/.env"
HEALTH_URL="${1:-http://127.0.0.1/api/health}"

echo "[systemd]"
systemctl status --no-pager newscast-web-compose.service | sed -n '1,20p' || true

echo
echo "[compose]"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo
echo "[health]"
curl -fsS "${HEALTH_URL}"
echo
