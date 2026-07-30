#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/compose.yaml"
ENV_FILE="${ROOT_DIR}/.env"
PROJECT_NAME=""
INPUT_FILE=""

usage() {
  echo "Usage: $0 --project-name nn-product-reset-eval-NAME --compose-file FILE --env-file FILE --input BACKUP.dump" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name) PROJECT_NAME="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --input) INPUT_FILE="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

if [[ ! "${PROJECT_NAME}" =~ ^nn-product-reset-eval-[a-z0-9-]+$ ]]; then
  echo "Restore is allowed only for nn-product-reset-eval-* projects" >&2
  exit 2
fi
if [[ ! -f "${COMPOSE_FILE}" || ! -f "${ENV_FILE}" || ! -f "${INPUT_FILE}" ]]; then
  echo "Compose, env, or backup file not found" >&2
  exit 2
fi
CHECKSUM_FILE="${INPUT_FILE}.sha256"
if [[ ! -f "${CHECKSUM_FILE}" ]]; then
  echo "Backup checksum file not found" >&2
  exit 2
fi

EXPECTED_DIGEST="$(awk 'NR == 1 {print $1}' "${CHECKSUM_FILE}")"
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_DIGEST="$(sha256sum "${INPUT_FILE}" | awk '{print $1}')"
else
  ACTUAL_DIGEST="$(shasum -a 256 "${INPUT_FILE}" | awk '{print $1}')"
fi
if [[ -z "${EXPECTED_DIGEST}" || "${EXPECTED_DIGEST}" != "${ACTUAL_DIGEST}" ]]; then
  echo "Backup checksum verification failed" >&2
  exit 2
fi

RELATION_COUNT="$(
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    exec -T db \
    sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'';"'
)"
if [[ "${RELATION_COUNT//[[:space:]]/}" != "0" ]]; then
  echo "Restore target must be an empty eval database" >&2
  exit 2
fi

docker compose \
  --project-name "${PROJECT_NAME}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  exec -T db \
  sh -lc 'exec pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "${INPUT_FILE}"

echo "DB restored into empty eval database"
