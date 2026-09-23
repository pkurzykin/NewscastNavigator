#!/usr/bin/env bash
set -euo pipefail
umask 077

kind=production
project=newscast_navigator_production
runtime_dir=/opt/newscast-production
export_dir=/var/lib/newscast-backup/export/files
while [[ $# -gt 0 ]]; do
  case $1 in
    --kind) kind=${2:-}; shift 2 ;;
    --project) project=${2:-}; shift 2 ;;
    --runtime-dir) runtime_dir=${2:-}; shift 2 ;;
    --export-dir) export_dir=${2:-}; shift 2 ;;
    *) echo 'Unsupported backup option' >&2; exit 2 ;;
  esac
done

if [[ $kind == production ]]; then
  [[ $project == newscast_navigator_production && $runtime_dir == /opt/newscast-production ]] || exit 2
elif [[ $kind == synthetic ]]; then
  [[ $project =~ ^nn-product-reset-eval-hostland-[a-z0-9-]+$ && $runtime_dir =~ ^/opt/newscast-stage[a-z0-9-]+$ ]] || exit 2
else
  exit 2
fi
[[ $export_dir == /var/lib/newscast-backup/export/files ]] || exit 2
for file in "$runtime_dir/runtime.env" "$runtime_dir/compose.yaml" "$runtime_dir/image-manifest.json" "$runtime_dir/backup-recipient.txt"; do
  [[ -f $file && ! -L $file ]] || { echo 'Backup prerequisite missing or unsafe' >&2; exit 2; }
done
[[ -d $export_dir && ! -L $export_dir ]] || exit 2
recipient=$runtime_dir/backup-recipient.txt
source_commit=$(python3 - "$runtime_dir/image-manifest.json" <<'PY'
import json,re,sys
value=json.load(open(sys.argv[1]))['source_commit']
assert re.fullmatch(r'[a-f0-9]{40}',value)
print(value)
PY
)

# A failed run leaves the prior completed point untouched. Retention is disabled.
exec 9>"$export_dir/.db-backup.lock"
flock -n 9 || { echo 'Previous backup still running' >&2; exit 1; }
available_kib=$(df -Pk "$export_dir" | awk 'NR==2 {print $4}')
[[ $available_kib =~ ^[0-9]+$ && $available_kib -gt 524288 ]] || { echo 'Insufficient backup disk space' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="db-$stamp-$kind.dump.age"
[[ ! -e $export_dir/$name && ! -e $export_dir/$name.json ]] || { echo 'Backup point already exists' >&2; exit 1; }
partial=$(mktemp "$export_dir/.$name.XXXXXX.partial")
metadata_partial=''
cleanup() { rm -f "$partial"; [[ -z $metadata_partial ]] || rm -f "$metadata_partial"; }
trap cleanup EXIT
timeout 180 docker compose --project-name "$project" --env-file "$runtime_dir/runtime.env" -f "$runtime_dir/compose.yaml" \
  exec -T db sh -lc 'exec pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' </dev/null |
  age -R "$recipient" -o "$partial"
[[ -s $partial ]] || { echo 'Empty encrypted backup' >&2; exit 1; }
chown root:newscast-backup "$partial"
chmod 0640 "$partial"
mv "$partial" "$export_dir/$name"
partial=''
digest=$(sha256sum "$export_dir/$name" | cut -d' ' -f1)
bytes=$(stat -c %s "$export_dir/$name")
metadata_partial=$(mktemp "$export_dir/.$name.json.XXXXXX.partial")
python3 - "$metadata_partial" "$name" "$digest" "$bytes" "$kind" "$source_commit" <<'PY'
import json,sys,time
path,name,digest,size,kind,commit=sys.argv[1:]
with open(path,'w') as out:
    json.dump({'name':name,'sha256':digest,'bytes':int(size),'kind':kind,'source_commit':commit,'created_unix':int(time.time())},out,sort_keys=True)
    out.write('\n')
PY
chown root:newscast-backup "$metadata_partial"
chmod 0640 "$metadata_partial"
mv "$metadata_partial" "$export_dir/$name.json"
metadata_partial=''
echo "DB_BACKUP=$name SHA256=$digest BYTES=$bytes"
