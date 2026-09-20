#!/bin/bash
set -euo pipefail
umask 077
cd /opt/newscast-rehearsal
project=nn-product-reset-eval-hostland
compose() { docker compose --project-name "$project" --env-file runtime.env -f compose.yaml "$@"; }
snapshot_id=$(date -u +%Y%m%dT%H%M%SZ)-synthetic
snapshot=/var/lib/newscast-backup/$snapshot_id
mkdir -m 700 "$snapshot"
printf '%s\n' "$snapshot_id" > /opt/newscast-rehearsal/last-snapshot-id
mkdir -m 700 "$snapshot/runtime" "$snapshot/os"
# Only this isolated synthetic environment is paused for a stable dump/fingerprint pair.
compose stop gateway frontend backend </dev/null
trap 'compose start backend frontend gateway </dev/null >/dev/null 2>&1 || true' EXIT
compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' </dev/null > "$snapshot/database.dump"
sha256sum "$snapshot/database.dump" | awk '{print $1}' > "$snapshot/database.dump.sha256"
python3 /opt/newscast-rehearsal/db_fingerprint.py /opt/newscast-rehearsal "$project" > "$snapshot/db-fingerprint.json"
cp -a /opt/newscast-rehearsal/. "$snapshot/runtime/"
# Account-specific private SSH host/admin keys are deliberately not copied.
tar -C / -cf "$snapshot/os/config.tar" etc/ssh/sshd_config.d/00-newscast-hardening.conf etc/ufw etc/docker/daemon.json etc/systemd/journald.conf.d etc/apt/apt.conf.d/99-newscast-updates etc/needrestart/conf.d/99-newscast.conf etc/sysctl.d/60-newscast-memory.conf etc/fstab etc/default/grub.d/kdump-tools.cfg usr/local/sbin/newscast-backup-export
uname -a > "$snapshot/os/kernel.txt"
dpkg-query -W -f='${binary:Package}\t${Version}\n' > "$snapshot/os/packages.tsv"
python3 - "$snapshot" <<'PY'
import json,subprocess,sys,pathlib
root=pathlib.Path(sys.argv[1]); manifest=json.loads((root/'runtime/image-manifest.json').read_text())
subprocess.run(['docker','image','save','--output',str(root/'images.tar'),*manifest['images'].values()],check=True)
PY
cp /opt/newscast-rehearsal/RESTORE.md "$snapshot/RESTORE.md"
(cd "$snapshot"; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
partial=/var/lib/newscast-backup/export/current.tar.age.partial
trap 'rm -f "$partial"; compose start backend frontend gateway </dev/null >/dev/null 2>&1 || true' EXIT
tar -C "$snapshot" -cf - . | age -R /opt/newscast-rehearsal/backup-recipient.txt -o "$partial"
chown root:newscast-backup "$partial"
chmod 640 "$partial"
mv "$partial" /var/lib/newscast-backup/export/current.tar.age
sha256sum /var/lib/newscast-backup/export/current.tar.age
stat -c 'ENCRYPTED_BYTES=%s' /var/lib/newscast-backup/export/current.tar.age
printf 'SNAPSHOT_ID=%s\n' "$snapshot_id"
compose up -d --no-build --pull never --wait </dev/null
trap - EXIT
