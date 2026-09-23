#!/usr/bin/env bash
# Destructive CP6 operation: requires an explicit maintenance window and a
# verified home recovery point. This script is never run by a timer.
set -euo pipefail
umask 077
staging=''
while [[ $# -gt 0 ]]; do
  case $1 in
    --staging-dir) staging=${2:-}; shift 2 ;;
    *) exit 2 ;;
  esac
done
[[ $staging =~ ^/opt/newscast-restore-staging-[a-z0-9-]+$ && -d $staging && ! -L $staging ]] || exit 2
runtime=/opt/newscast-production
project=newscast_navigator_production
[[ -f $staging/database.dump && ! -L $staging/database.dump && -f $staging/database.dump.sha256 && ! -L $staging/database.dump.sha256 ]] || exit 2
[[ -f $staging/source-fingerprint.json && ! -L $staging/source-fingerprint.json ]] || exit 2
[[ -x $runtime/verify_release.sh && -f $runtime/db_fingerprint.py ]] || exit 2
"$runtime/verify_release.sh" --runtime-dir "$runtime"
(cd "$staging"; sha256sum --quiet --strict -c database.dump.sha256)
if systemctl is-active --quiet newscast-production.service; then
  echo 'Production service must be stopped before restore' >&2
  exit 2
fi
compose() { docker compose --project-name "$project" --env-file "$runtime/runtime.env" -f "$runtime/compose.yaml" "$@"; }
if [[ -n $(compose ps --services --filter status=running </dev/null | sed '/^db$/d') ]]; then
  echo 'Application containers must be stopped before restore' >&2
  exit 2
fi
compose up -d --no-build --pull never --wait db </dev/null
relations=$(compose exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'';"' </dev/null)
[[ $relations == 0 ]] || { echo 'Restore target is not empty' >&2; exit 2; }
compose exec -T db sh -c 'exec pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$staging/database.dump"
python3 "$runtime/db_fingerprint.py" "$runtime" "$project" > "$staging/restored-fingerprint.json"
python3 - "$staging/source-fingerprint.json" "$staging/restored-fingerprint.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])), 'DB fingerprint mismatch after restore'
PY
revision=$(compose exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version;"' </dev/null)
[[ $revision == 20260806_0004 || $revision == 20260914_0005 ]] || { echo 'Unexpected restored schema' >&2; exit 2; }
if [[ $revision == 20260806_0004 ]]; then
  compose run --rm -T backend alembic -c /app/alembic.ini upgrade head </dev/null
fi
revision=$(compose exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version;"' </dev/null)
[[ $revision == 20260914_0005 ]] || exit 2
echo 'PRODUCTION_RESTORE_VERIFIED=true SCHEMA=20260914_0005 APPLICATION_NOT_STARTED=true'
