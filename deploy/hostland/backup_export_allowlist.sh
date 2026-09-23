#!/usr/bin/env bash
set -euo pipefail

# Installed as a root-owned forced command for newscast-backup. The account can
# read completed ciphertext and its public manifest, never runtime or Docker.
root=/var/lib/newscast-backup/export/files
command=${SSH_ORIGINAL_COMMAND:-}
if [[ $# -gt 0 ]]; then
  [[ $# -eq 4 && $1 == --root && $3 == --command ]] || exit 2
  root=$2
  command=$4
fi
[[ -d $root && ! -L $root ]] || exit 2

if [[ $command == list ]]; then
  python3 - "$root" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
pattern = re.compile(r"(?:db-\d{8}T\d{6}Z-(?:synthetic|production)\.dump|full-\d{8}T\d{6}Z-(?:synthetic|production)\.tar)\.age\Z")
items = []
for meta in sorted(root.glob("*.age.json")):
    if meta.is_symlink() or not meta.is_file():
        continue
    name = meta.name[:-5]
    if not pattern.fullmatch(name):
        continue
    ciphertext = root / name
    if ciphertext.is_symlink() or not ciphertext.is_file():
        continue
    try:
        item = json.loads(meta.read_text())
        assert item["name"] == name
        assert item["kind"] in ("synthetic", "production")
        assert re.fullmatch(r"[a-f0-9]{64}", item["sha256"])
        assert re.fullmatch(r"[a-f0-9]{40}", item["source_commit"])
        assert item["bytes"] == ciphertext.stat().st_size
        assert type(item["created_unix"]) is int and item["created_unix"] > 0
    except (OSError, ValueError, KeyError, AssertionError, TypeError):
        continue
    items.append(item)
print(json.dumps(items, sort_keys=True, separators=(",", ":")))
PY
  exit 0
fi

if [[ $command =~ ^get\ ((db-[0-9]{8}T[0-9]{6}Z-(synthetic|production)\.dump|full-[0-9]{8}T[0-9]{6}Z-(synthetic|production)\.tar)\.age)$ ]]; then
  name=${BASH_REMATCH[1]}
  [[ -f $root/$name && ! -L $root/$name ]] || exit 2
  [[ -f $root/$name.json && ! -L $root/$name.json ]] || exit 2
  exec /bin/cat -- "$root/$name"
fi

exit 2
