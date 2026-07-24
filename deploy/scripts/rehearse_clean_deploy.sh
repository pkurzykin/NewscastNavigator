#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_NAME=""
ARTIFACTS=""

usage() {
  echo "Usage: $0 --project-name nn-product-reset-eval-NAME --artifacts artifacts/product-reset/CP7/ops" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name) PROJECT_NAME="${2:-}"; shift 2 ;;
    --artifacts) ARTIFACTS="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

if [[ ! "${PROJECT_NAME}" =~ ^nn-product-reset-eval-[a-z0-9-]+$ ]]; then
  echo "Project name must start with nn-product-reset-eval-" >&2
  exit 2
fi
if [[ -z "${ARTIFACTS}" ]]; then
  usage
  exit 2
fi
if [[ "${ARTIFACTS}" != /* ]]; then
  ARTIFACTS="${ROOT_DIR}/${ARTIFACTS}"
fi
ARTIFACTS="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${ARTIFACTS}")"
ALLOWED_ARTIFACTS="${ROOT_DIR}/artifacts/product-reset/"
if [[ "${ARTIFACTS}/" != "${ALLOWED_ARTIFACTS}"* ]]; then
  echo "Artifacts must stay under ignored artifacts/product-reset/" >&2
  exit 2
fi

RESTORE_PROJECT="${PROJECT_NAME}-restore"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/newscast-product-reset-eval.XXXXXX")"
SOURCE_ROOT="${WORK_DIR}/source"
ENV_FILE="${WORK_DIR}/eval.env"
COMPOSE_FILE="${SOURCE_ROOT}/deploy/compose.demo.yaml"
SOURCE_CLEANED=0
RESTORE_CLEANED=0

compose() {
  local project="$1"
  shift
  docker compose \
    --project-name "${project}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    "$@"
}

cleanup() {
  set +e
  if [[ "${SOURCE_CLEANED}" -eq 0 ]]; then
    compose "${PROJECT_NAME}" down -v --remove-orphans >>"${ARTIFACTS}/cleanup.log" 2>&1
  fi
  if [[ "${RESTORE_CLEANED}" -eq 0 ]]; then
    compose "${RESTORE_PROJECT}" down -v --remove-orphans >>"${ARTIFACTS}/cleanup.log" 2>&1
  fi
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

mkdir -p "${ARTIFACTS}/backup"
: > "${ARTIFACTS}/cleanup.log"
mkdir -p "${SOURCE_ROOT}"
COPYFILE_DISABLE=1 tar \
  --no-mac-metadata \
  --exclude="backend/.venv" \
  --exclude="backend/.venv311" \
  --exclude="backend/.pytest_cache" \
  --exclude="frontend/node_modules" \
  --exclude="frontend/dist" \
  --exclude=".env" \
  --exclude="._*" \
  --exclude=".DS_Store" \
  -C "${ROOT_DIR}" \
  -cf - backend frontend deploy/compose.demo.yaml deploy/nginx |
  COPYFILE_DISABLE=1 tar --no-mac-metadata -C "${SOURCE_ROOT}" -xf -
if find "${SOURCE_ROOT}" -name '._*' -print -quit | grep -q .; then
  echo "Sanitized build context still contains AppleDouble metadata" >&2
  exit 1
fi
{
  echo "source_root=temporary"
  echo "tracked_commit=$(git -C "${ROOT_DIR}" rev-parse HEAD)"
  echo "appledouble_files=0"
  echo "real_env_files=0"
} > "${ARTIFACTS}/source-preparation.log"

FRONTEND_PORT="$(
  python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
cat > "${ENV_FILE}" <<EOF
POSTGRES_DB=newscast_product_reset_eval
POSTGRES_USER=product_reset_eval
POSTGRES_PASSWORD=synthetic-eval-only
DATABASE_URL=postgresql+psycopg://product_reset_eval:synthetic-eval-only@db:5432/newscast_product_reset_eval
SECRET_KEY=synthetic-eval-session-secret-2026
CORS_ORIGINS=https://demo.invalid,null
ALLOW_NULL_CORS_ORIGIN=true
SCENARIO_LEASE_TTL_SECONDS=90
SESSION_COOKIE_SECURE=true
DEMO_BIND_HOST=127.0.0.1
DEMO_HTTP_PORT=${FRONTEND_PORT}
NGINX_SERVER_NAME=localhost
FRONTEND_VITE_API_BASE_URL=
EOF
chmod 600 "${ENV_FILE}"

docker version > "${ARTIFACTS}/docker-version.log"
docker compose version > "${ARTIFACTS}/compose-version.log"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --quiet

compose "${PROJECT_NAME}" down -v --remove-orphans >>"${ARTIFACTS}/cleanup.log" 2>&1
compose "${RESTORE_PROJECT}" down -v --remove-orphans >>"${ARTIFACTS}/cleanup.log" 2>&1

compose "${PROJECT_NAME}" build --no-cache >"${ARTIFACTS}/build.log" 2>&1
compose "${PROJECT_NAME}" up -d --wait db >"${ARTIFACTS}/database-start.log" 2>&1
compose "${PROJECT_NAME}" run --rm backend alembic -c /app/alembic.ini upgrade head >"${ARTIFACTS}/migration.log" 2>&1
compose "${PROJECT_NAME}" run --rm -e ENVIRONMENT=development backend python scripts/seed_demo.py >"${ARTIFACTS}/seed.log" 2>&1
compose "${PROJECT_NAME}" exec -T db \
  psql -U product_reset_eval -d newscast_product_reset_eval -v ON_ERROR_STOP=1 \
  -c "UPDATE users SET is_active = false;" \
  >>"${ARTIFACTS}/seed.log" 2>&1
SMOKE_PASSWORD="$(
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
)"
printf '%s\n%s\n' "${SMOKE_PASSWORD}" "${SMOKE_PASSWORD}" |
  compose "${PROJECT_NAME}" run --rm -T -e ENVIRONMENT=development \
    backend python scripts/manage_users.py set-password astra \
    >>"${ARTIFACTS}/seed.log" 2>&1
compose "${PROJECT_NAME}" run --rm -e ENVIRONMENT=development \
  backend python scripts/manage_users.py activate astra \
  >>"${ARTIFACTS}/seed.log" 2>&1
compose "${PROJECT_NAME}" up -d --wait backend frontend gateway >"${ARTIFACTS}/application-start.log" 2>&1

SMOKE_USERNAME=astra \
SMOKE_PASSWORD="${SMOKE_PASSWORD}" \
"${ROOT_DIR}/deploy/scripts/smoke.sh" \
  --project-name "${PROJECT_NAME}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --base-url "http://127.0.0.1:${FRONTEND_PORT}" \
  > "${ARTIFACTS}/smoke-before.json"

COUNT_QUERY="SELECT json_build_object(
  'users', (SELECT count(*) FROM users),
  'rubrics', (SELECT count(*) FROM rubrics),
  'stories', (SELECT count(*) FROM stories),
  'archived', (SELECT count(*) FROM stories WHERE archived_at IS NOT NULL),
  'scenarios', (SELECT count(*) FROM scenarios),
  'scenario_rows', (SELECT count(*) FROM scenario_rows)
)::text;"
compose "${PROJECT_NAME}" exec -T db \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' -- "${COUNT_QUERY}" \
  > "${ARTIFACTS}/counts-before.json"

"${ROOT_DIR}/deploy/scripts/backup_db.sh" \
  --project-name "${PROJECT_NAME}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --output "${ARTIFACTS}/backup" \
  > "${ARTIFACTS}/backup.log"
BACKUP_FILE="$(find "${ARTIFACTS}/backup" -maxdepth 1 -type f -name '*.dump' | sort | tail -n 1)"
if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Backup was not created" >&2
  exit 1
fi

compose "${PROJECT_NAME}" down -v --remove-orphans >>"${ARTIFACTS}/cleanup.log" 2>&1
SOURCE_CLEANED=1
compose "${RESTORE_PROJECT}" up -d --wait db >"${ARTIFACTS}/restore-database-start.log" 2>&1
"${ROOT_DIR}/deploy/scripts/restore_db.sh" \
  --project-name "${RESTORE_PROJECT}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --input "${BACKUP_FILE}" \
  > "${ARTIFACTS}/restore.log"
compose "${RESTORE_PROJECT}" up -d --wait backend frontend gateway >"${ARTIFACTS}/restore-application-start.log" 2>&1

SMOKE_USERNAME=astra \
SMOKE_PASSWORD="${SMOKE_PASSWORD}" \
"${ROOT_DIR}/deploy/scripts/smoke.sh" \
  --project-name "${RESTORE_PROJECT}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --base-url "http://127.0.0.1:${FRONTEND_PORT}" \
  > "${ARTIFACTS}/smoke-after.json"
compose "${RESTORE_PROJECT}" exec -T db \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' -- "${COUNT_QUERY}" \
  > "${ARTIFACTS}/counts-after.json"
cmp "${ARTIFACTS}/counts-before.json" "${ARTIFACTS}/counts-after.json"

compose "${RESTORE_PROJECT}" ps > "${ARTIFACTS}/containers.log"
cat > "${ARTIFACTS}/result.json" <<EOF
{
  "schema_version": 1,
  "project_name": "${PROJECT_NAME}",
  "restore_project_name": "${RESTORE_PROJECT}",
  "fresh_build": true,
  "migration": "passed",
  "synthetic_seed": "passed",
  "health_smoke": "passed",
  "backup_checksum": "passed",
  "empty_restore": "passed",
  "post_restore_counts": "matched",
  "post_restore_smoke": "passed"
}
EOF

compose "${RESTORE_PROJECT}" down -v --remove-orphans >>"${ARTIFACTS}/cleanup.log" 2>&1
RESTORE_CLEANED=1
echo "Clean deploy rehearsal passed; artifacts: ${ARTIFACTS}"
