#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/or/relative/path/to/storage-backup.tar.gz"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/docker/docker-compose.web-prod.yml"
ENV_FILE="${ROOT_DIR}/deploy/env/web-prod.env"
BACKUP_FILE="$1"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend \
  sh -lc 'mkdir -p "$STORAGE_PATH" && tar -xzf - -C "$(dirname "$STORAGE_PATH")"' < "${BACKUP_FILE}"

echo "Storage restored from: ${BACKUP_FILE}"
