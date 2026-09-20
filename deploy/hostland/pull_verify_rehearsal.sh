#!/bin/bash
set -euo pipefail
umask 077
snapshot_id=$1
expected=$2
[[ "$snapshot_id" =~ ^[0-9]{8}T[0-9]{6}Z-synthetic$ ]]
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
base=/home/newscast/private-demo/hostland-backups
cd "$base"
archive=snapshots/$snapshot_id.tar.age
[[ ! -e "$archive" && ! -e "$archive.partial" ]]
started=$(date +%s)
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$base/keys/known_hosts" -o IdentitiesOnly=yes -i "$base/keys/pull_ed25519" newscast-backup@185.221.215.76 > "$archive.partial"
actual=$(sha256sum "$archive.partial" | cut -d' ' -f1)
[[ "$actual" == "$expected" ]]
mv "$archive.partial" "$archive"
printf '%s  %s\n' "$expected" "$(basename "$archive")" > "$archive.sha256"
restore_dir=$base/restore-checks/$snapshot_id
mkdir -m 700 "$restore_dir"
age=$base/tools/extracted/usr/bin/age
"$age" --decrypt -i "$base/keys/backup.agekey" -o "$restore_dir/plaintext.tar" "$archive"
python3 - "$restore_dir" <<'PY'
from pathlib import Path
import tarfile,sys
root=Path(sys.argv[1]); target=root/'bundle';target.mkdir(mode=0o700)
with tarfile.open(root/'plaintext.tar') as t:
 for m in t.getmembers():
  assert m.isfile() or m.isdir(), 'UNEXPECTED_ARCHIVE_MEMBER_TYPE'
  assert not Path(m.name).is_absolute() and '..' not in Path(m.name).parts, 'UNSAFE_ARCHIVE_PATH'
 t.extractall(target,filter='data')
print('ARCHIVE_PATHS_AND_TYPES_VALIDATED')
PY
(cd "$restore_dir/bundle"; sha256sum --quiet --strict -c SHA256SUMS)
cp "$archive" "$restore_dir/tampered.age"
python3 - "$restore_dir/tampered.age" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
with p.open('r+b') as f:
 f.seek(p.stat().st_size//2); b=f.read(1);f.seek(-1,1);f.write(bytes([b[0]^1]))
PY
if "$age" --decrypt -i "$base/keys/backup.agekey" "$restore_dir/tampered.age" >/dev/null 2>"$restore_dir/tamper-error.txt"; then
 echo 'CORRUPTION_TEST_UNEXPECTED_SUCCESS'; exit 1
fi
rm "$restore_dir/tampered.age"
printf 'HOME_BACKUP_VERIFIED=%s\n' "$snapshot_id"
printf 'TRANSFER_DECRYPT_VERIFY_SECONDS=%s\n' "$(( $(date +%s)-started ))"
stat -c 'ENCRYPTED_BYTES=%s MODE=%a' "$archive"
printf 'CORRUPTION_REJECTED=true\n'
