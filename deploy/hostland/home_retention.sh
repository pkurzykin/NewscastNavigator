#!/usr/bin/env bash
# Home-controlled production backup retention. No generic remote shell/delete.
set -euo pipefail
umask 077

base=/home/newscast/private-demo/hostland-backups
mode=''
index=''
snapshots=''
show_plan=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) mode=dry-run; shift ;;
    --apply) mode=apply; shift ;;
    --plan) show_plan=true; shift ;;
    --export-index) index=${2:-}; shift 2 ;;
    --snapshots) snapshots=${2:-}; shift 2 ;;
    *) echo 'Unsupported retention option' >&2; exit 2 ;;
  esac
done
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export PYTHONPATH="$script_dir${PYTHONPATH:+:$PYTHONPATH}"
[[ -n $mode ]] || { echo 'Use --dry-run or --apply' >&2; exit 2; }
if [[ $mode == dry-run ]]; then
  [[ -n $index && -n $snapshots ]] || { echo 'Dry-run requires --export-index and --snapshots' >&2; exit 2; }
  args=(--export-index "$index" --snapshots "$snapshots")
  [[ $show_plan == false ]] || args+=(--plan)
  exec python3 "$script_dir/retention_report.py" "${args[@]}"
fi
[[ $show_plan == false && -z $index && -z $snapshots ]] || {
  echo 'Apply uses only fixed production paths' >&2; exit 2;
}

test_mode=${NN_RETENTION_TEST_MODE:-0}
if [[ $test_mode == 1 ]]; then
  base=${NN_RETENTION_TEST_BASE:?}
  [[ -d $base && ! -L $base ]] || exit 2
  test_export=${NN_RETENTION_TEST_EXPORT:?}
  test_prune=${NN_RETENTION_TEST_PRUNE:?}
  now_unix=${NN_RETENTION_TEST_NOW:?}
  [[ -x $test_export && -x $test_prune && $now_unix =~ ^[0-9]+$ ]] || exit 2
else
  [[ $test_mode == 0 ]] || exit 2
  [[ $(timedatectl show -p NTPSynchronized --value) == yes ]] || {
    echo 'Home clock is not NTP-synchronized' >&2; exit 1;
  }
  for file in "$base/keys/pull_ed25519" "$base/keys/prune_ed25519" "$base/keys/known_hosts"; do
    [[ -f $file && ! -L $file ]] || { echo 'Retention key prerequisite missing' >&2; exit 2; }
  done
  now_unix=$(date +%s)
fi
snapshots=$base/snapshots
monitor=$base/monitor
pending=$monitor/retention-pending.json
status_file=$monitor/retention-status.json
marker=$monitor/latest-production.json
[[ -d $snapshots && ! -L $snapshots && -d $monitor && ! -L $monitor ]] || exit 2
[[ ! -L $pending && ! -L $status_file && ! -L $marker ]] || exit 2
python3 - "$snapshots" <<'PY'
import os,sys
v=os.statvfs(sys.argv[1])
print(f'HOME_BACKUP_FREE_BYTES={v.f_bavail*v.f_frsize}')
PY

write_status() {
  python3 - "$status_file" "$1" "$now_unix" <<'PY'
import json,os,sys,tempfile
from pathlib import Path
path=Path(sys.argv[1]); state=sys.argv[2]; now=int(sys.argv[3])
old=json.loads(path.read_text()) if path.exists() else {}
if not isinstance(old,dict): old={}
record={'status':state,'last_attempt_unix':now,
        'last_success_unix':now if state=='ok' else old.get('last_success_unix',0)}
fd,tmp=tempfile.mkstemp(prefix='.retention-status-',dir=path.parent)
try:
    with os.fdopen(fd,'w') as out:
        json.dump(record,out,sort_keys=True); out.write('\n'); out.flush(); os.fsync(out.fileno())
    os.chmod(tmp,0o600); os.replace(tmp,path)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
PY
}
on_exit() {
  local code=$1
  trap - EXIT
  if [[ $code == 0 ]]; then write_status ok || true
  else write_status failed || true; fi
}
trap 'on_exit "$?"' EXIT

exec 8>"$base/.home-retention.lock"
flock -n 8 || { echo 'Previous retention run is still active' >&2; exit 1; }
exec 9>"$base/.home-pull.lock"
flock -w 90 9 || { echo 'Home pull did not release its lock' >&2; exit 1; }
verified_unix=$(python3 - "$marker" "$now_unix" <<'PY'
import json,sys
from pathlib import Path
e=json.loads(Path(sys.argv[1]).read_text()); now=int(sys.argv[2])
assert 0<=now-int(e['db_created_unix'])<=900, 'Latest DB is not fresh'
assert 0<=now-int(e['verified_unix'])<=600, 'Home verification is not fresh'
print(int(e['verified_unix']))
PY
)

export_list() {
  if [[ $test_mode == 1 ]]; then "$test_export"
  else
    timeout 45s ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$base/keys/known_hosts" \
      -o IdentitiesOnly=yes -o ConnectTimeout=10 -i "$base/keys/pull_ed25519" \
      newscast-backup@185.221.215.76 list
  fi
}
prune_point() {
  if [[ $test_mode == 1 ]]; then "$test_prune"
  else
    timeout 45s ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$base/keys/known_hosts" \
      -o IdentitiesOnly=yes -o ConnectTimeout=10 -i "$base/keys/prune_ed25519" \
      newscast-prune@185.221.215.76 prune
  fi
}

work=$(mktemp -d "$base/.retention-work.XXXXXX")
trap 'code=$?; rm -rf -- "$work" || true; on_exit "$code"' EXIT

process_pending() {
  [[ -f $pending && ! -L $pending ]] || return 0
  request_now=$now_unix
  if [[ $test_mode == 0 ]]; then request_now=$(date +%s); fi
  python3 - "$pending" "$request_now" <<'PY'
import json,os,sys,tempfile
from pathlib import Path
from retention_policy import NAME_RE,SHA_RE
path=Path(sys.argv[1]); request=json.loads(path.read_text())
assert set(request)=={'version','home_unix','name','sha256','bytes'}
assert request['version']==1 and NAME_RE.fullmatch(request['name'])
assert SHA_RE.fullmatch(request['sha256']) and type(request['bytes']) is int and request['bytes']>0
request['home_unix']=int(sys.argv[2])
fd,tmp=tempfile.mkstemp(prefix='.retention-pending-',dir=path.parent)
try:
    with os.fdopen(fd,'w') as out:
        json.dump(request,out,sort_keys=True); out.write('\n'); out.flush(); os.fsync(out.fileno())
    os.chmod(tmp,0o600); os.replace(tmp,path)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
PY
  # A pending request can outlive a crash. Reverify the home ciphertext before
  # every remote deletion, including retries, so VDS is never the only intact
  # copy we discard.
  python3 - "$pending" "$snapshots" <<'PY'
import hashlib,json,os,stat,sys
from pathlib import Path
request=json.loads(Path(sys.argv[1]).read_text())
root=Path(sys.argv[2]); name=request['name']
archive=root/name; sidecar=root/(name+'.sha256')
for path in (archive,sidecar):
    st=path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1:
        raise SystemExit('Unsafe or missing home backup point')
if archive.stat().st_size!=request['bytes']:
    raise SystemExit('Home backup size differs before VDS prune')
fd=os.open(sidecar,os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(fd,'r') as stream:
    if stream.read(256)!=f"{request['sha256']}  {name}\n":
        raise SystemExit('Home checksum differs before VDS prune')
digest=hashlib.sha256()
fd=os.open(archive,os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(fd,'rb') as stream:
    if os.fstat(stream.fileno()).st_size!=request['bytes']:
        raise SystemExit('Home backup changed before VDS prune')
    for chunk in iter(lambda:stream.read(1024*1024),b''):
        digest.update(chunk)
if digest.hexdigest()!=request['sha256']:
    raise SystemExit('Home backup hash differs before VDS prune')
PY
  prune_point < "$pending" > "$work/receipt.json"
  export_list > "$work/after.json"
  python3 - "$pending" "$work/receipt.json" "$work/after.json" "$snapshots" <<'PY'
import json,os,stat,sys
from pathlib import Path
from retention_policy import NAME_RE
request=json.loads(Path(sys.argv[1]).read_text())
receipt=json.loads(Path(sys.argv[2]).read_text())
remaining=json.loads(Path(sys.argv[3]).read_text())
root=Path(sys.argv[4]); name=request['name']
assert NAME_RE.fullmatch(name) and isinstance(remaining,list)
assert receipt=={'status':receipt.get('status'),'name':name,
                 'sha256':request['sha256'],'bytes':request['bytes']}
assert receipt['status'] in {'deleted','already_deleted'}
assert not any(item.get('name')==name for item in remaining)
archive=root/name; sidecar=root/(name+'.sha256')
for path in (archive,sidecar):
    if path.exists() or path.is_symlink():
        assert stat.S_ISREG(path.lstat().st_mode), 'Unsafe home backup path'
if archive.exists():
    assert archive.stat().st_size==request['bytes'], 'Home backup size changed'
if sidecar.exists():
    assert sidecar.read_text()==f"{request['sha256']}  {name}\n", 'Home sidecar changed'
if archive.exists(): archive.unlink()
if sidecar.exists(): sidecar.unlink()
Path(sys.argv[1]).unlink()
fd=os.open(root,os.O_RDONLY); os.fsync(fd); os.close(fd)
PY
}

# Resume the exact interrupted point before considering any new candidates.
process_pending
export_list > "$work/index.json"
python3 "$script_dir/retention_report.py" --plan --now-unix "$now_unix" \
  --export-index "$work/index.json" --snapshots "$snapshots" > "$work/report.json"
python3 - "$work/report.json" > "$work/candidates" <<'PY'
import json,sys
plan=json.load(open(sys.argv[1]))['retention_plan']
for name in plan['delete_db']+plan['delete_full']:
    print(name)
PY
count=0
while IFS= read -r name; do
  [[ -n $name ]] || continue
  if [[ $test_mode == 0 ]]; then
    # Leave at least a minute before the delivery monitor's 10-minute limit.
    # A large backlog waits for the next daily run instead of starving pull.
    if (( $(date +%s) >= verified_unix + 480 )); then
      echo 'Retention stopped before home delivery became stale' >&2
      exit 3
    fi
  fi
  python3 - "$work/index.json" "$name" "$pending" "$now_unix" <<'PY'
import json,os,sys,tempfile
from pathlib import Path
from retention_policy import NAME_RE
items=json.loads(Path(sys.argv[1]).read_text()); name=sys.argv[2]; path=Path(sys.argv[3])
assert NAME_RE.fullmatch(name) and not path.exists() and not path.is_symlink()
matches=[item for item in items if item['name']==name]
assert len(matches)==1
item=matches[0]
request={'version':1,'home_unix':int(sys.argv[4]),'name':name,
         'sha256':item['sha256'],'bytes':item['bytes']}
fd,tmp=tempfile.mkstemp(prefix='.retention-pending-',dir=path.parent)
try:
    with os.fdopen(fd,'w') as out:
        json.dump(request,out,sort_keys=True); out.write('\n'); out.flush(); os.fsync(out.fileno())
    os.chmod(tmp,0o600); os.replace(tmp,path)
finally:
    if os.path.exists(tmp): os.unlink(tmp)
PY
  process_pending
  count=$((count+1))
done < "$work/candidates"
echo "RETENTION_DELETED=$count"
