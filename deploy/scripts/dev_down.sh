#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ROOT_DIR}/deploy/env/web-dev.env"

docker compose --env-file "${ENV_FILE}" -f deploy/docker/docker-compose.web-dev.yml down
