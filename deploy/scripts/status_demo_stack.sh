#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose.demo.yaml"
ENV_FILE="${ROOT_DIR}/deploy/env/demo.env"
PROJECT_NAME="newscast_navigator_demo"
BASE_URL="${DEMO_BASE_URL:-http://127.0.0.1:8088}"

docker compose \
  --project-name "${PROJECT_NAME}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps

"${ROOT_DIR}/deploy/scripts/smoke.sh" \
  --project-name "${PROJECT_NAME}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --base-url "${BASE_URL}"
