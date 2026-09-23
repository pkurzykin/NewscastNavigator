#!/usr/bin/env bash
set -euo pipefail
umask 077

kind=production
max_age_seconds=900
scrub_all=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --kind) kind=${2:-}; shift 2 ;;
    --max-age-seconds) max_age_seconds=${2:-}; shift 2 ;;
    --scrub-all) scrub_all=true; shift ;;
    *) exit 2 ;;
  esac
done
[[ $kind == production || $kind == synthetic ]] || exit 2
[[ $max_age_seconds =~ ^[0-9]+$ && $max_age_seconds -le 86400 ]] || exit 2
base=/home/newscast/private-demo/hostland-backups
snapshots=$base/snapshots
key=$base/keys/pull_ed25519
known_hosts=$base/keys/known_hosts
identity=$base/keys/backup.agekey
age=$base/tools/extracted/usr/bin/age
for file in "$key" "$known_hosts" "$identity" "$age"; do
  [[ -f $file && ! -L $file ]] || { echo 'Home pull key/tool prerequisite missing' >&2; exit 2; }
done
[[ -d $snapshots && ! -L $snapshots ]] || exit 2
exec 9>"$base/.home-pull.lock"
flock -n 9 || { echo 'Previous home pull still running' >&2; exit 1; }
index=$(mktemp "$base/.export-index.XXXXXX")
rows=$(mktemp "$base/.export-rows.XXXXXX")
partial=''
verify_dir=''
cleanup() {
  rm -f -- "$index" "$rows"
  [[ -z $partial ]] || rm -f -- "$partial"
  [[ -z $verify_dir ]] || rm -rf -- "$verify_dir"
}
trap cleanup EXIT
ssh_export() {
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" \
    -o IdentitiesOnly=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 \
    -i "$key" newscast-backup@185.221.215.76 "$1"
}
ssh_export list </dev/null > "$index"
python3 - "$index" "$kind" > "$rows" <<'PY'
import json,re,sys
items=json.load(open(sys.argv[1]))
kind=sys.argv[2]
assert isinstance(items,list)
pattern=re.compile(r'(?:db-\d{8}T\d{6}Z-(?:synthetic|production)\.dump|full-\d{8}T\d{6}Z-(?:synthetic|production)\.tar)\.age\Z')
seen=set()
for item in sorted(items,key=lambda x:(not x['name'].startswith('full-'),x['name'])):
    if item['kind']!=kind: continue
    name=item['name']
    assert pattern.fullmatch(name) and name not in seen
    assert name.endswith('-'+kind+('.dump.age' if name.startswith('db-') else '.tar.age'))
    assert re.fullmatch(r'[a-f0-9]{64}',item['sha256'])
    assert re.fullmatch(r'[a-f0-9]{40}',item['source_commit'])
    assert type(item['bytes']) is int and item['bytes']>0
    assert type(item['created_unix']) is int and item['created_unix']>0
    seen.add(name)
    print(name,item['sha256'],item['bytes'],item['source_commit'],item['created_unix'],sep='\t')
PY

# A frequent pull hashes only the newest DB point and its matching full bundle.
# Rehash the entire retained history explicitly with --scrub-all; otherwise
# the 2-minute timer would read an ever-growing number of old full images.
mapfile -t current_chain < <(python3 - "$rows" <<'PY'
import sys
rows=[line.rstrip('\n').split('\t') for line in open(sys.argv[1]) if line.strip()]
db=max((r for r in rows if r[0].startswith('db-')),key=lambda r:int(r[4]),default=None)
assert db is not None, 'No DB point in export'
full=max((r for r in rows if r[0].startswith('full-') and r[3]==db[3]),key=lambda r:int(r[4]),default=None)
assert full is not None, 'Latest DB point has no full release bundle'
print(db[0]); print(full[0])
PY
)
latest_db=${current_chain[0]}
latest_full=${current_chain[1]}

verify_full() {
  local ciphertext=$1
  verify_dir=$(mktemp -d "$base/restore-checks/.verify-XXXXXX")
  "$age" --decrypt -i "$identity" -o "$verify_dir/plaintext.tar" "$ciphertext"
  python3 - "$verify_dir" "$kind" <<'PY'
from pathlib import Path
import re,subprocess,sys,tarfile
root=Path(sys.argv[1]); kind=sys.argv[2]; target=root/'bundle'; target.mkdir(mode=0o700)
with tarfile.open(root/'plaintext.tar') as archive:
    for item in archive.getmembers():
        path=Path(item.name)
        assert not path.is_absolute() and '..' not in path.parts
        if item.issym():
            assert kind=='production' and path==Path('runtime/tls/active') and item.linkname=='versions/initial'
        else:
            assert item.isfile() or item.isdir()
    archive.extractall(target,filter='data')
subprocess.run(['sha256sum','--quiet','--strict','-c','SHA256SUMS'],cwd=target,check=True)
assert (target/'database.dump').is_file()
assert (target/'images.tar').is_file()
assert (target/'runtime'/'runtime.env').is_file()
for name in ('source.tar.gz','source.sha256','image-manifest.json'):
    assert (target/'runtime'/name).is_file(), f'Missing recovery prerequisite: {name}'
tls=target/'runtime'/'tls'
if kind=='production':
    assert (tls/'active').is_symlink() and (tls/'active').readlink()==Path('versions/initial')
    assert (target/'runtime'/'systemd'/'newscast-production.service').is_file()
    tls=tls/'active'
for name in ('fullchain.pem','privkey.pem'):
    assert (tls/name).is_file(), f'Missing TLS recovery file: {name}'
for name in ('verify_release.sh','restore_production.sh','db_fingerprint.py','prod_smoke.py','cert-health.sh','certbot-deploy-hook.sh'):
    assert (target/'runtime'/name).is_file(), f'Missing recovery script: {name}'
compose=(target/'runtime'/'compose.yaml').read_text()
for name in ('production-gateway.conf.template','gateway-tls.conf.template'):
    if re.search(r'\./'+re.escape(name)+r':/etc/nginx/templates/default\.conf\.template',compose):
        assert (target/'runtime'/name).is_file(), f'Missing mounted gateway template: {name}'
PY
  rm -rf -- "$verify_dir"
  verify_dir=''
}

while IFS=$'\t' read -r name digest bytes source_commit created_unix; do
  [[ -n $name ]] || continue
  archive=$snapshots/$name
  if [[ -e $archive || -L $archive ]]; then
    [[ -f $archive && ! -L $archive && -f $archive.sha256 && ! -L $archive.sha256 ]] || exit 1
    [[ $(stat -c %s "$archive") == "$bytes" ]] || exit 1
    [[ $(awk 'NR==1 {print $1}' "$archive.sha256") == "$digest" ]] || exit 1
    if [[ $scrub_all == true || $name == "$latest_db" || $name == "$latest_full" ]]; then
      [[ $(sha256sum "$archive" | cut -d' ' -f1) == "$digest" ]] || {
        echo 'Stored encrypted backup digest mismatch' >&2
        exit 1
      }
    fi
    continue
  fi
  partial=$(mktemp "$snapshots/.$name.XXXXXX.partial")
  ssh_export "get $name" </dev/null > "$partial"
  [[ $(stat -c %s "$partial") == "$bytes" ]] || { echo 'Encrypted transfer size mismatch' >&2; exit 1; }
  [[ $(sha256sum "$partial" | cut -d' ' -f1) == "$digest" ]] || { echo 'Encrypted transfer digest mismatch' >&2; exit 1; }
  if [[ $name == full-* ]]; then
    verify_full "$partial"
  else
    "$age" --decrypt -i "$identity" -o /dev/null "$partial"
  fi
  chmod 0600 "$partial"
  mv "$partial" "$archive"
  partial=''
  printf '%s  %s\n' "$digest" "$name" > "$archive.sha256"
  echo "HOME_BACKUP_VERIFIED=$name BYTES=$bytes"
done < "$rows"

# A DB point is usable only with a locally retained full bundle for its release.
python3 - "$rows" "$snapshots" "$max_age_seconds" <<'PY'
from pathlib import Path
import sys,time
rows=[line.rstrip('\n').split('\t') for line in open(sys.argv[1]) if line.strip()]
root=Path(sys.argv[2])
max_age=int(sys.argv[3])
missing_files=[row[0] for row in rows if not (root/row[0]).is_file() or not (root/(row[0]+'.sha256')).is_file()]
if missing_files:
    raise SystemExit('Export list includes a point not delivered and verified at home')
full={row[3] for row in rows if row[0].startswith('full-') and (root/row[0]).is_file()}
missing={row[3] for row in rows if row[0].startswith('db-') and row[3] not in full}
if missing:
    raise SystemExit('DB point has no verified full release bundle at home')
db=[int(row[4]) for row in rows if row[0].startswith('db-')]
if not db:
    raise SystemExit('No delivered DB point at home')
age=int(time.time())-max(db)
if age<0 or age>max_age:
    raise SystemExit(f'Delivered DB point is too old: {age}s (limit {max_age}s)')
print('HOME_BACKUP_CURRENT_CHAIN_VERIFIED=true')
print(f'HISTORICAL_POINTS_LISTED={len(rows)}')
print(f'LAST_DELIVERED_DB_AGE_SECONDS={age}')
PY
if [[ $scrub_all == true ]]; then echo 'HOME_BACKUP_ALL_CIPHERTEXT_REHASHED=true'; fi
