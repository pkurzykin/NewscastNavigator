#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/docker/docker-compose.web-prod.yml"
ENV_FILE="${ROOT_DIR}/deploy/env/web-prod.env"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

git -C "${ROOT_DIR}" pull --ff-only

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm backend alembic upgrade head
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build

echo "Production stack updated."
