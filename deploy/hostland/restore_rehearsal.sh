#!/bin/bash
set -euo pipefail
umask 077
started=$(date +%s)
bundle=/opt/newscast-restore-bundle
runtime=/opt/newscast-restore-rehearsal
project=nn-product-reset-eval-hostland-restore
(cd "$bundle"; sha256sum --quiet --strict -c SHA256SUMS)
[[ ! -e "$runtime" ]]
mkdir -m 700 "$runtime"
cp -a "$bundle/runtime/." "$runtime/"
python3 - "$runtime" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])/'runtime.env';s=p.read_text()
assert 'HTTP_PORT=8088' in s and 'HTTPS_PORT=8443' in s and 'CORS_ORIGINS=https://ncastnav.ru:8443,null' in s
s=s.replace('HTTP_PORT=8088','HTTP_PORT=8089').replace('HTTPS_PORT=8443','HTTPS_PORT=8444').replace('CORS_ORIGINS=https://ncastnav.ru:8443,null','CORS_ORIGINS=https://ncastnav.ru:8444,null');p.write_text(s)
PY
docker load -i "$bundle/images.tar" > "$runtime/image-load.log"
python3 - "$runtime" <<'PY'
import sys,pathlib,json,subprocess
manifest=json.loads((pathlib.Path(sys.argv[1])/'image-manifest.json').read_text())
for ident in manifest['images'].values():
 actual=subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',ident],text=True).strip()
 assert actual==ident
print('BACKUP_IMAGES_LOADED_AND_VERIFIED=4')
PY
compose() { docker compose --project-name "$project" --env-file "$runtime/runtime.env" -f "$runtime/compose.yaml" "$@"; }
compose config --quiet </dev/null
compose up -d --no-build --pull never --wait db </dev/null
bash "$runtime/restore_db.sh" --project-name "$project" --compose-file "$runtime/compose.yaml" --env-file "$runtime/runtime.env" --input "$bundle/database.dump" </dev/null
python3 "$runtime/db_fingerprint.py" "$runtime" "$project" > "$runtime/restored-db-fingerprint.json"
cmp "$bundle/db-fingerprint.json" "$runtime/restored-db-fingerprint.json"
echo 'ALL_21_TABLE_COUNTS_AND_CONTENT_DIGESTS_MATCH=true'
compose up -d --no-build --pull never --wait </dev/null
python3 "$runtime/https_smoke.py" "$runtime" 8444 </dev/null
printf 'RESTORE_AND_SMOKE_SECONDS=%s\n' "$(( $(date +%s)-started ))"
compose ps --format '{{.Service}} {{.State}} {{.Health}} {{.Ports}}' </dev/null
