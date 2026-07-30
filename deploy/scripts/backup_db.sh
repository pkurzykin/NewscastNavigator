#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose.demo.yaml"
ENV_FILE="${ROOT_DIR}/deploy/env/demo.env"
PROJECT_NAME="newscast_navigator_demo"
OUTPUT_DIR="${ROOT_DIR}/deploy/backups/db"
OUTPUT_FILE=""

usage() {
  echo "Usage: $0 [--project-name NAME] [--compose-file FILE] [--env-file FILE] [--output DIR | --output-file BACKUP.dump]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name) PROJECT_NAME="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --output) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --output-file) OUTPUT_FILE="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

if [[ ! "${PROJECT_NAME}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  echo "Invalid Compose project name" >&2
  exit 2
fi
if [[ ! -f "${COMPOSE_FILE}" || ! -f "${ENV_FILE}" ]]; then
  echo "Compose or env file not found" >&2
  exit 2
fi

if [[ -n "${OUTPUT_FILE}" ]]; then
  if [[ "${OUTPUT_FILE}" != *.dump || "$(basename "${OUTPUT_FILE}")" == ._* ]]; then
    echo "Exact backup output must be a non-AppleDouble .dump path" >&2
    exit 2
  fi
  OUTPUT_DIR="$(dirname "${OUTPUT_FILE}")"
else
  TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  OUTPUT_FILE="${OUTPUT_DIR}/postgres-${TIMESTAMP}.dump"
fi
mkdir -p "${OUTPUT_DIR}"
if [[ -e "${OUTPUT_FILE}" || -e "${OUTPUT_FILE}.sha256" ]]; then
  echo "Backup output already exists" >&2
  exit 2
fi

docker compose \
  --project-name "${PROJECT_NAME}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  exec -T db \
  sh -lc 'exec pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "${OUTPUT_FILE}"

if command -v sha256sum >/dev/null 2>&1; then
  DIGEST="$(sha256sum "${OUTPUT_FILE}" | awk '{print $1}')"
else
  DIGEST="$(shasum -a 256 "${OUTPUT_FILE}" | awk '{print $1}')"
fi
printf '%s  %s\n' "${DIGEST}" "$(basename "${OUTPUT_FILE}")" > "${OUTPUT_FILE}.sha256"
echo "DB backup and checksum created"
