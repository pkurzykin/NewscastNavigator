#!/usr/bin/env bash
# Retention policy is not approved. This reports candidates only and never deletes.
set -euo pipefail
[[ ${1:-} == --dry-run && $# -eq 1 ]] || {
  echo 'Retention is disabled until owner approves a policy; only --dry-run is available' >&2
  exit 2
}
root=/home/newscast/private-demo/hostland-backups/snapshots
[[ -d $root && ! -L $root ]] || exit 2
python3 - "$root" <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import re,sys,time
root=Path(sys.argv[1]); now=time.time(); candidates=0
for ciphertext in root.glob('db-*.dump.age'):
    match=re.fullmatch(r'db-(\d{8}T\d{6}Z)-(?:synthetic|production)\.dump\.age',ciphertext.name)
    if not match or ciphertext.is_symlink() or not (root/(ciphertext.name+'.sha256')).is_file(): continue
    created=datetime.strptime(match.group(1),'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp()
    if now-created>48*3600: candidates+=1
print(f'DRY_RUN_DB_POINTS_OLDER_THAN_48H={candidates}; DELETED=0; POLICY_NOT_APPROVED=true')
PY
