#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CANONICAL_COMPOSE_FILE="${ROOT_DIR}/deploy/compose.demo.yaml"
COMPOSE_FILE="${CANONICAL_COMPOSE_FILE}"
ENV_FILE="${ROOT_DIR}/deploy/env/demo.env"
PROJECT_NAME="newscast_navigator_demo"
BASE_URL=""
ENV_FILE_EXPLICIT=0

usage() {
  echo "Usage: $0 [--project-name NAME] [--compose-file FILE] [--env-file FILE] [--base-url URL]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name) PROJECT_NAME="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; ENV_FILE_EXPLICIT=1; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

COMPOSE_FILE="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${COMPOSE_FILE}")"
ENV_FILE="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${ENV_FILE}")"

if [[ -z "${PROJECT_NAME}" || ! "${PROJECT_NAME}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  echo "Valid Compose project name is required" >&2
  exit 2
fi
if [[ "${ENV_FILE_EXPLICIT}" -eq 0 && "${COMPOSE_FILE}" != "${CANONICAL_COMPOSE_FILE}" ]]; then
  echo "A non-canonical Compose file requires an explicit env file" >&2
  exit 2
fi
if [[ ! -f "${COMPOSE_FILE}" || ! -f "${ENV_FILE}" ]]; then
  echo "Compose or env file not found" >&2
  exit 2
fi
if [[ -z "${BASE_URL}" ]]; then
  PUBLISHED_ENDPOINT="$(
    docker compose \
      --project-name "${PROJECT_NAME}" \
      --env-file "${ENV_FILE}" \
      -f "${COMPOSE_FILE}" \
      port gateway 80 |
      head -n 1
  )"
  PUBLISHED_PORT="${PUBLISHED_ENDPOINT##*:}"
  if [[ ! "${PUBLISHED_PORT}" =~ ^[0-9]+$ ]]; then
    echo "Could not discover the local demo gateway port" >&2
    exit 2
  fi
  BASE_URL="http://127.0.0.1:${PUBLISHED_PORT}"
fi
if [[ ! "${BASE_URL}" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]]; then
  echo "Smoke base URL must use local loopback HTTP" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

request_status() {
  local output_file="$1"
  local url="$2"
  shift 2
  curl --silent --show-error --output "${output_file}" --write-out "%{http_code}" "$@" "${url}"
}

HEALTH_STATUS="$(request_status "${TMP_DIR}/health.json" "${BASE_URL}/api/health")"
ROOT_STATUS="$(request_status "${TMP_DIR}/root.html" "${BASE_URL}/")"
AUTH_STATUS="$(request_status "${TMP_DIR}/auth.json" "${BASE_URL}/api/v1/auth/me")"

if [[ "${HEALTH_STATUS}" != "200" || "${ROOT_STATUS}" != "200" || "${AUTH_STATUS}" != "401" ]]; then
  echo "Smoke failed: health=${HEALTH_STATUS} root=${ROOT_STATUS} unauthenticated=${AUTH_STATUS}" >&2
  exit 1
fi
python3 - "${TMP_DIR}/health.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if payload != {"status": "ok"}:
    raise SystemExit("Unexpected health payload")
PY

if [[ -n "${SMOKE_USERNAME:-}" || -n "${SMOKE_PASSWORD:-}" ]]; then
  if [[ -z "${SMOKE_USERNAME:-}" || -z "${SMOKE_PASSWORD:-}" ]]; then
    echo "Both SMOKE_USERNAME and SMOKE_PASSWORD are required" >&2
    exit 2
  fi
  LOGIN_PAYLOAD="$(
    SMOKE_USERNAME="${SMOKE_USERNAME}" SMOKE_PASSWORD="${SMOKE_PASSWORD}" python3 <<'PY'
import json
import os
print(json.dumps({
    "username": os.environ["SMOKE_USERNAME"],
    "password": os.environ["SMOKE_PASSWORD"],
}, ensure_ascii=False))
PY
  )"
  LOGIN_STATUS="$(
    request_status \
      "${TMP_DIR}/login.json" \
      "${BASE_URL}/api/v1/auth/login" \
      --cookie-jar "${TMP_DIR}/cookies.txt" \
      --header "Content-Type: application/json" \
      --data-binary "${LOGIN_PAYLOAD}"
  )"
  AUTH_COOKIE="$(
    awk 'NF >= 7 && $6 != "" {print $6 "=" $7}' "${TMP_DIR}/cookies.txt" |
      tail -n 1
  )"
  if [[ -z "${AUTH_COOKIE}" ]]; then
    echo "Authenticated smoke failed: login did not return a session cookie" >&2
    exit 1
  fi
  STORIES_STATUS="$(
    request_status \
      "${TMP_DIR}/stories.json" \
      "${BASE_URL}/api/v1/stories?lifecycle=active&limit=1" \
      --cookie "${AUTH_COOKIE}"
  )"
  if [[ "${LOGIN_STATUS}" != "200" || "${STORIES_STATUS}" != "200" ]]; then
    echo "Authenticated smoke failed: login=${LOGIN_STATUS} stories=${STORIES_STATUS}" >&2
    exit 1
  fi
fi

printf '{"health":200,"root":200,"unauthenticated":401,"authenticated":%s}\n' \
  "$([[ -n "${SMOKE_USERNAME:-}" ]] && printf 'true' || printf 'false')"
