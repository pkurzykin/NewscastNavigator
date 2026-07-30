#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose.demo.yaml"
ENV_FILE="${ROOT_DIR}/deploy/env/demo.env"
PROJECT_NAME="newscast_navigator_demo"
APPROVED_REF=""

usage() {
  echo "Usage: $0 --ref FULL_40_CHARACTER_COMMIT_SHA" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) APPROVED_REF="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

if [[ ! "${APPROVED_REF}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "An exact 40-character approved commit SHA is required" >&2
  exit 2
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Demo environment file not found" >&2
  exit 2
fi
if [[ -n "$(git -C "${ROOT_DIR}" status --porcelain)" ]]; then
  echo "Demo checkout must be clean" >&2
  exit 2
fi

git -C "${ROOT_DIR}" fetch \
  --no-tags \
  origin \
  "+refs/heads/*:refs/remotes/origin/*"
if ! git -C "${ROOT_DIR}" cat-file -e "${APPROVED_REF}^{commit}"; then
  echo "Approved commit is not available after fetching remote refs" >&2
  exit 2
fi
FETCHED_SHA="$(git -C "${ROOT_DIR}" rev-parse "${APPROVED_REF}^{commit}")"
if [[ "${FETCHED_SHA}" != "${APPROVED_REF}" ]]; then
  echo "Fetched commit does not match approved SHA" >&2
  exit 2
fi
git -C "${ROOT_DIR}" switch --detach "${APPROVED_REF}"
docker compose \
  --project-name "${PROJECT_NAME}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  up -d --build --wait
echo "Demo stack updated to approved SHA ${APPROVED_REF}"
