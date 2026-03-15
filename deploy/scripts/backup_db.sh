#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/docker/docker-compose.web-prod.yml"
ENV_FILE="${ROOT_DIR}/deploy/env/web-prod.env"
BACKUP_DIR="${1:-${ROOT_DIR}/deploy/backups/db}"

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_FILE="${BACKUP_DIR}/postgres-${TIMESTAMP}.sql"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T db \
  sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "${OUTPUT_FILE}"

echo "DB backup created: ${OUTPUT_FILE}"
