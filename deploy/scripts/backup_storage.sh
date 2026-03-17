#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/compose.yaml"
ENV_FILE="${ROOT_DIR}/.env"
BACKUP_DIR="${1:-${ROOT_DIR}/deploy/backups/storage}"

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_FILE="${BACKUP_DIR}/storage-${TIMESTAMP}.tar.gz"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend \
  sh -lc 'tar -czf - -C "$(dirname "$STORAGE_PATH")" "$(basename "$STORAGE_PATH")"' > "${OUTPUT_FILE}"

echo "Storage backup created: ${OUTPUT_FILE}"
