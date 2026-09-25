#!/usr/bin/env bash
# Report only. No retention policy has been approved or enabled.
set -euo pipefail
umask 077

DELETED=0
root=/home/newscast/private-demo/hostland-backups/snapshots
index=''
dry_run=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) dry_run=true; shift ;;
    --export-index) index=${2:-}; shift 2 ;;
    --snapshots) root=${2:-}; shift 2 ;;
    *) echo 'Retention is disabled until owner approves a policy; only --dry-run is available' >&2; exit 2 ;;
  esac
done
[[ $dry_run == true && -n $index ]] || {
  echo 'Retention is disabled; use --dry-run --export-index INDEX [--snapshots DIR]' >&2
  exit 2
}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec python3 "$script_dir/retention_report.py" --export-index "$index" --snapshots "$root"
