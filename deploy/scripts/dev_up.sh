#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ROOT_DIR}/deploy/env/web-dev.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  echo "Сначала создай его: cp deploy/env/web-dev.env.example deploy/env/web-dev.env" >&2
  exit 1
fi

docker compose --env-file "${ENV_FILE}" -f deploy/docker/docker-compose.web-dev.yml up -d
