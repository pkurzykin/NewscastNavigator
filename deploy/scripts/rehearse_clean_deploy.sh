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
if [[ -L "${ARTIFACTS}" ]]; then
  echo "Artifacts directory must not be a symbolic link" >&2
  exit 2
fi
mkdir -p "${ARTIFACTS}"
if [[ ! -d "${ARTIFACTS}" || -L "${ARTIFACTS}" ]]; then
  echo "Artifacts path must be a regular directory" >&2
  exit 2
fi
ARTIFACTS="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${ARTIFACTS}")"
ALLOWED_ARTIFACTS="${ROOT_DIR}/artifacts/product-reset/"
if [[ "${ARTIFACTS}/" != "${ALLOWED_ARTIFACTS}"* ]]; then
  echo "Artifacts must stay under ignored artifacts/product-reset/" >&2
  exit 2
fi
RUNS_ROOT="${ARTIFACTS}/runs"
LATEST_POINTER="${ARTIFACTS}/latest-run.txt"
POINTER_TEMP=""
mkdir -p "${RUNS_ROOT}"
rm -f \
  "${ARTIFACTS}/result.json" \
  "${ARTIFACTS}/smoke-before.json" \
  "${ARTIFACTS}/smoke-after.json" \
  "${ARTIFACTS}/counts-before.json" \
  "${ARTIFACTS}/counts-after.json"
if [[ -n "$(git -C "${ROOT_DIR}" status --porcelain --untracked-files=normal)" ]]; then
  echo "Rehearsal requires a clean exact committed HEAD" >&2
  exit 2
fi
SOURCE_HEAD="$(git -C "${ROOT_DIR}" rev-parse HEAD)"

RESTORE_PROJECT="${PROJECT_NAME}-restore"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/newscast-product-reset-eval.XXXXXX")"
SOURCE_ROOT="${WORK_DIR}/source"
ENV_FILE="${WORK_DIR}/eval.env"
COMPOSE_FILE="${SOURCE_ROOT}/deploy/compose.demo.yaml"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-${SOURCE_HEAD:0:12}-$(python3 -c 'import secrets; print(secrets.token_hex(4))')"
RUN_ARTIFACTS="${RUNS_ROOT}/${RUN_ID}"
BACKUP_FILE="${RUN_ARTIFACTS}/backup/postgres.dump"
SOURCE_CLEANED=0
RESTORE_CLEANED=0

if [[ -e "${RUN_ARTIFACTS}" ]]; then
  echo "Fresh rehearsal run directory already exists" >&2
  exit 2
fi
mkdir -p "${RUN_ARTIFACTS}/backup"

compose() {
  local project="$1"
  shift
  docker compose \
    --project-name "${project}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    "$@"
}

assert_project_removed() {
  local project="$1"
  local containers volumes networks
  containers="$(
    docker ps -aq --filter "label=com.docker.compose.project=${project}"
  )"
  volumes="$(
    docker volume ls -q --filter "label=com.docker.compose.project=${project}"
  )"
  networks="$(
    docker network ls -q --filter "label=com.docker.compose.project=${project}"
  )"
  if [[ -n "${containers}" || -n "${volumes}" || -n "${networks}" ]]; then
    echo "Compose project cleanup left resources for ${project}" >&2
    exit 1
  fi
}

validate_rehearsal_logs() {
  python3 - "${RUN_ARTIFACTS}" <<'PY'
import re
import sys
from pathlib import Path

run_root = Path(sys.argv[1])
log_paths = (
    "docker-version.log",
    "compose-version.log",
    "build.log",
    "database-start.log",
    "migration.log",
    "seed.log",
    "application-start.log",
    "backup.log",
    "restore-database-start.log",
    "restore.log",
    "restore-application-start.log",
    "containers.log",
    "source-runtime.log",
    "restore-runtime.log",
    "cleanup.log",
)
failure_patterns = (
    re.compile(r"(?im)^(?:[A-Za-z0-9_.-]+-\d+\s+\|\s*)?traceback \(most recent call last\):"),
    re.compile(r"(?im)^(?:[A-Za-z0-9_.-]+-\d+\s+\|\s*)?error response from daemon:"),
    re.compile(
        r"(?im)^(?:[A-Za-z0-9_.-]+-\d+\s+\|\s*)?"
        r"(?:\d{4}-\d{2}-\d{2}\s+[0-9:.+-]+\s+\S+(?:\s+\[\d+\])?\s+)?"
        r"(?:error|fatal|panic):\s"
    ),
    re.compile(
        r"(?im)^(?:[A-Za-z0-9_.-]+-\d+\s+\|\s*)?"
        r"\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}\s+"
        r"\[(?:error|crit|alert|emerg)\]"
    ),
    re.compile(r"(?i)\bunhandled exception\b"),
)
for relative_path in log_paths:
    path = run_root / relative_path
    if not path.is_file():
        raise SystemExit(f"Missing rehearsal log: {relative_path}")
    text = path.read_text(encoding="utf-8", errors="replace")
    if any(pattern.search(text) for pattern in failure_patterns):
        raise SystemExit(f"Unhandled failure marker in rehearsal log: {relative_path}")
PY
}

publish_latest_pointer() {
  if [[ -L "${LATEST_POINTER}" ]]; then
    echo "Latest-run pointer must not be a symbolic link" >&2
    return 1
  fi
  POINTER_TEMP="$(mktemp "${ARTIFACTS}/.latest-run.txt.XXXXXX")"
  if [[ ! -f "${POINTER_TEMP}" || -L "${POINTER_TEMP}" ]]; then
    echo "Latest-run temporary pointer must be a regular file" >&2
    return 1
  fi
  printf '%s\n' "${RUN_ID}" > "${POINTER_TEMP}"
  mv "${POINTER_TEMP}" "${LATEST_POINTER}"
  POINTER_TEMP=""
}

cleanup() {
  set +e
  if [[ "${SOURCE_CLEANED}" -eq 0 ]]; then
    compose "${PROJECT_NAME}" down -v --remove-orphans >>"${RUN_ARTIFACTS}/cleanup.log" 2>&1
  fi
  if [[ "${RESTORE_CLEANED}" -eq 0 ]]; then
    compose "${RESTORE_PROJECT}" down -v --remove-orphans >>"${RUN_ARTIFACTS}/cleanup.log" 2>&1
  fi
  if [[ -n "${POINTER_TEMP}" && -f "${POINTER_TEMP}" && ! -L "${POINTER_TEMP}" ]]; then
    rm -f "${POINTER_TEMP}"
  fi
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

: > "${RUN_ARTIFACTS}/cleanup.log"
mkdir -p "${SOURCE_ROOT}"
git -C "${ROOT_DIR}" archive --format=tar "${SOURCE_HEAD}" \
  backend frontend deploy/compose.demo.yaml deploy/nginx |
  COPYFILE_DISABLE=1 tar --no-mac-metadata -C "${SOURCE_ROOT}" -xf -
SCAN_RESULT="$(
  python3 "${ROOT_DIR}/deploy/scripts/scan_source_context.py" --root "${SOURCE_ROOT}"
)"
read -r REAL_ENV_COUNT SECRET_FILE_COUNT APPLEDOUBLE_COUNT < <(
  python3 -c '
import json
import sys
counts = json.loads(sys.argv[1])
print(counts["real_env_files"], counts["secret_like_files"], counts["appledouble_files"])
' "${SCAN_RESULT}"
)
{
  echo "source_root=temporary"
  echo "tracked_commit=${SOURCE_HEAD}"
  echo "appledouble_files=${APPLEDOUBLE_COUNT}"
  echo "real_env_files=${REAL_ENV_COUNT}"
  echo "secret_like_files=${SECRET_FILE_COUNT}"
} > "${RUN_ARTIFACTS}/source-preparation.log"
if [[ "${APPLEDOUBLE_COUNT}" != "0" ]]; then
  echo "Sanitized build context still contains AppleDouble metadata" >&2
  exit 1
fi
if [[ "${REAL_ENV_COUNT}" != "0" || "${SECRET_FILE_COUNT}" != "0" ]]; then
  echo "Sanitized build context contains environment or secret-like files" >&2
  exit 1
fi

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

docker version > "${RUN_ARTIFACTS}/docker-version.log"
docker compose version > "${RUN_ARTIFACTS}/compose-version.log"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --quiet

compose "${PROJECT_NAME}" down -v --remove-orphans >>"${RUN_ARTIFACTS}/cleanup.log" 2>&1
compose "${RESTORE_PROJECT}" down -v --remove-orphans >>"${RUN_ARTIFACTS}/cleanup.log" 2>&1

compose "${PROJECT_NAME}" build --no-cache >"${RUN_ARTIFACTS}/build.log" 2>&1
compose "${PROJECT_NAME}" up -d --wait db >"${RUN_ARTIFACTS}/database-start.log" 2>&1
compose "${PROJECT_NAME}" run --rm backend alembic -c /app/alembic.ini upgrade head >"${RUN_ARTIFACTS}/migration.log" 2>&1
compose "${PROJECT_NAME}" run --rm -e ENVIRONMENT=development backend python scripts/seed_demo.py >"${RUN_ARTIFACTS}/seed.log" 2>&1
compose "${PROJECT_NAME}" exec -T db \
  psql -U product_reset_eval -d newscast_product_reset_eval -v ON_ERROR_STOP=1 \
  -c "UPDATE users SET is_active = false;" \
  >>"${RUN_ARTIFACTS}/seed.log" 2>&1
SMOKE_PASSWORD="$(
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
)"
printf '%s\n%s\n' "${SMOKE_PASSWORD}" "${SMOKE_PASSWORD}" |
  compose "${PROJECT_NAME}" run --rm -T -e ENVIRONMENT=development \
    backend python scripts/manage_users.py set-password astra \
    >>"${RUN_ARTIFACTS}/seed.log" 2>&1
compose "${PROJECT_NAME}" run --rm -e ENVIRONMENT=development \
  backend python scripts/manage_users.py activate astra \
  >>"${RUN_ARTIFACTS}/seed.log" 2>&1
compose "${PROJECT_NAME}" up -d --wait backend frontend gateway >"${RUN_ARTIFACTS}/application-start.log" 2>&1

SMOKE_USERNAME=astra \
SMOKE_PASSWORD="${SMOKE_PASSWORD}" \
"${ROOT_DIR}/deploy/scripts/smoke.sh" \
  --project-name "${PROJECT_NAME}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --base-url "http://127.0.0.1:${FRONTEND_PORT}" \
  > "${RUN_ARTIFACTS}/smoke-before.json"
compose "${PROJECT_NAME}" logs --no-color --no-log-prefix db backend frontend gateway > "${RUN_ARTIFACTS}/source-runtime.log"

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
  > "${RUN_ARTIFACTS}/counts-before.json"

"${ROOT_DIR}/deploy/scripts/backup_db.sh" \
  --project-name "${PROJECT_NAME}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --output-file "${BACKUP_FILE}" \
  > "${RUN_ARTIFACTS}/backup.log"
if [[ ! -f "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}.sha256" ]]; then
  echo "Exact backup and checksum were not created" >&2
  exit 1
fi

compose "${PROJECT_NAME}" down -v --remove-orphans >>"${RUN_ARTIFACTS}/cleanup.log" 2>&1
compose "${RESTORE_PROJECT}" up -d --wait db >"${RUN_ARTIFACTS}/restore-database-start.log" 2>&1
"${ROOT_DIR}/deploy/scripts/restore_db.sh" \
  --project-name "${RESTORE_PROJECT}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --input "${BACKUP_FILE}" \
  > "${RUN_ARTIFACTS}/restore.log"
compose "${RESTORE_PROJECT}" up -d --wait backend frontend gateway >"${RUN_ARTIFACTS}/restore-application-start.log" 2>&1

SMOKE_USERNAME=astra \
SMOKE_PASSWORD="${SMOKE_PASSWORD}" \
"${ROOT_DIR}/deploy/scripts/smoke.sh" \
  --project-name "${RESTORE_PROJECT}" \
  --compose-file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  --base-url "http://127.0.0.1:${FRONTEND_PORT}" \
  > "${RUN_ARTIFACTS}/smoke-after.json"
compose "${RESTORE_PROJECT}" logs --no-color --no-log-prefix db backend frontend gateway > "${RUN_ARTIFACTS}/restore-runtime.log"
compose "${RESTORE_PROJECT}" exec -T db \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' -- "${COUNT_QUERY}" \
  > "${RUN_ARTIFACTS}/counts-after.json"
cmp "${RUN_ARTIFACTS}/counts-before.json" "${RUN_ARTIFACTS}/counts-after.json"

compose "${RESTORE_PROJECT}" ps > "${RUN_ARTIFACTS}/containers.log"
cat > "${RUN_ARTIFACTS}/result.json" <<EOF
{
  "schema_version": 1,
  "run_id": "${RUN_ID}",
  "evaluated_commit": "${SOURCE_HEAD}",
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

compose "${RESTORE_PROJECT}" down -v --remove-orphans >>"${RUN_ARTIFACTS}/cleanup.log" 2>&1

validate_rehearsal_logs
assert_project_removed "${PROJECT_NAME}"
assert_project_removed "${RESTORE_PROJECT}"
SOURCE_CLEANED=1
RESTORE_CLEANED=1

MANIFEST_FILE="${RUN_ARTIFACTS}/manifest.json"
python3 - "${RUN_ARTIFACTS}" "${MANIFEST_FILE}" "${RUN_ID}" "${SOURCE_HEAD}" \
  "${PROJECT_NAME}" "${RESTORE_PROJECT}" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

run_root = Path(sys.argv[1])
manifest_path = Path(sys.argv[2])
run_id, evaluated_commit, project_name, restore_project_name = sys.argv[3:]
required_files = (
    "result.json",
    "counts-before.json",
    "counts-after.json",
    "smoke-before.json",
    "smoke-after.json",
    "source-preparation.log",
    "backup/postgres.dump",
    "backup/postgres.dump.sha256",
    "docker-version.log",
    "compose-version.log",
    "build.log",
    "database-start.log",
    "migration.log",
    "seed.log",
    "application-start.log",
    "backup.log",
    "restore-database-start.log",
    "restore.log",
    "restore-application-start.log",
    "containers.log",
    "source-runtime.log",
    "restore-runtime.log",
    "cleanup.log",
)
files = {}
for relative_path in required_files:
    path = run_root / relative_path
    if not path.is_file():
        raise SystemExit(f"Missing rehearsal artifact: {relative_path}")
    files[relative_path] = hashlib.sha256(path.read_bytes()).hexdigest()
manifest = {
    "schema_version": 1,
    "run_id": run_id,
    "evaluated_commit": evaluated_commit,
    "project_name": project_name,
    "restore_project_name": restore_project_name,
    "logs_validation": "passed",
    "cleanup": "passed",
    "files": files,
}
manifest_path.write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
PY

publish_latest_pointer
echo "Clean deploy rehearsal passed; run: ${RUN_ID}"
