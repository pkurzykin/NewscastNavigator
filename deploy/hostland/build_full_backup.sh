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
    *) exit 2 ;;
  esac
done
if [[ $kind == production ]]; then
  [[ $project == newscast_navigator_production && $runtime_dir == /opt/newscast-production ]] || exit 2
  [[ -L $runtime_dir/tls/active ]] || exit 2
  tls_version=$(readlink "$runtime_dir/tls/active")
  [[ $tls_version =~ ^versions/[A-Za-z0-9-]+$ ]] || exit 2
  tls_source=$runtime_dir/tls/$tls_version
  [[ -d $tls_source && ! -L $tls_source ]] || exit 2
elif [[ $kind == synthetic ]]; then
  [[ $project =~ ^nn-product-reset-eval-hostland-[a-z0-9-]+$ && $runtime_dir =~ ^/opt/newscast-stage[a-z0-9-]+$ ]] || exit 2
  tls_source=$runtime_dir/tls
else
  exit 2
fi
[[ $export_dir == /var/lib/newscast-backup/export/files && -d $export_dir && ! -L $export_dir ]] || exit 2
for file in "$runtime_dir/runtime.env" "$runtime_dir/compose.yaml" "$runtime_dir/image-manifest.json" "$runtime_dir/source.tar.gz" "$runtime_dir/source.sha256" "$runtime_dir/backup-recipient.txt" "$tls_source/fullchain.pem" "$tls_source/privkey.pem" "$runtime_dir/verify_release.sh" "$runtime_dir/backup_db_interval.sh" "$runtime_dir/build_full_backup.sh" "$runtime_dir/restore_production.sh" "$runtime_dir/db_fingerprint.py" "$runtime_dir/prod_smoke.py" "$runtime_dir/cert-health.sh" "$runtime_dir/certbot-deploy-hook.sh"; do
  [[ -f $file && ! -L $file ]] || { echo 'Full backup prerequisite missing or unsafe' >&2; exit 2; }
done
if [[ $kind == production ]]; then
  [[ -d $runtime_dir/systemd && ! -L $runtime_dir/systemd && -f $runtime_dir/systemd/newscast-production.service ]] || exit 2
fi
(cd "$runtime_dir"; sha256sum --quiet --strict -c source.sha256) || exit 2
source_commit=$(python3 - "$runtime_dir/image-manifest.json" <<'PY'
import json,re,sys
value=json.load(open(sys.argv[1]))['source_commit']
assert re.fullmatch(r'[a-f0-9]{40}',value)
print(value)
PY
)
image_ids=$(python3 - "$runtime_dir/image-manifest.json" <<'PY'
import json,re,sys
images=json.load(open(sys.argv[1]))['images']
assert set(images)=={'db','backend','frontend','gateway'}
assert all(re.fullmatch(r'sha256:[a-f0-9]{64}',v) for v in images.values())
print(' '.join(images[k] for k in ('db','backend','frontend','gateway')))
PY
)

exec 9>"$export_dir/.full-backup.lock"
flock -n 9 || { echo 'Previous full backup still running' >&2; exit 1; }
available_kib=$(df -Pk "$export_dir" | awk 'NR==2 {print $4}')
[[ $available_kib =~ ^[0-9]+$ && $available_kib -gt 3145728 ]] || { echo 'Insufficient disk space for full backup' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="full-$stamp-$kind.tar.age"
[[ ! -e $export_dir/$name && ! -e $export_dir/$name.json ]] || exit 2
work=$(mktemp -d /var/lib/newscast-backup/.full-XXXXXX)
partial=$(mktemp "$export_dir/.$name.XXXXXX.partial")
metadata_partial=''
cleanup() {
  [[ -z $work ]] || rm -rf -- "$work"
  [[ -z $partial ]] || rm -f -- "$partial"
  [[ -z $metadata_partial ]] || rm -f -- "$metadata_partial"
}
trap cleanup EXIT
install -d -m 0700 "$work/runtime/tls" "$work/os"
cp "$runtime_dir/runtime.env" "$runtime_dir/compose.yaml" "$runtime_dir/image-manifest.json" "$runtime_dir/source.tar.gz" "$runtime_dir/source.sha256" "$runtime_dir/backup-recipient.txt" "$work/runtime/"
if [[ $kind == production ]]; then
  install -d -m 0700 "$work/runtime/tls/versions" "$work/runtime/tls/versions/initial"
  cp "$tls_source/fullchain.pem" "$tls_source/privkey.pem" "$work/runtime/tls/versions/initial/"
  ln -s versions/initial "$work/runtime/tls/active"
else
  cp "$tls_source/fullchain.pem" "$tls_source/privkey.pem" "$work/runtime/tls/"
fi
for file in verify_release.sh backup_db_interval.sh build_full_backup.sh restore_production.sh db_fingerprint.py prod_smoke.py cert-health.sh certbot-deploy-hook.sh; do
  cp "$runtime_dir/$file" "$work/runtime/"
done
if [[ $kind == production ]]; then cp -a "$runtime_dir/systemd" "$work/runtime/"; fi
if [[ -f $runtime_dir/production-gateway.conf.template ]]; then
  cp "$runtime_dir/production-gateway.conf.template" "$work/runtime/"
fi
if [[ -f $runtime_dir/gateway-tls.conf.template ]]; then
  cp "$runtime_dir/gateway-tls.conf.template" "$work/runtime/"
fi
python3 - "$runtime_dir/compose.yaml" "$work/runtime" <<'PY'
from pathlib import Path
import re,sys
compose=Path(sys.argv[1]).read_text()
runtime=Path(sys.argv[2])
for name in ('production-gateway.conf.template','gateway-tls.conf.template'):
    if re.search(r'\./'+re.escape(name)+r':/etc/nginx/templates/default\.conf\.template',compose):
        assert (runtime/name).is_file(), f'Compose gateway template absent from full backup: {name}'
PY
timeout 240 docker compose --project-name "$project" --env-file "$runtime_dir/runtime.env" -f "$runtime_dir/compose.yaml" \
  exec -T db sh -lc 'exec pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' </dev/null > "$work/database.dump"
[[ -s $work/database.dump ]] || exit 1
read -r -a images <<< "$image_ids"
timeout 900 docker image save --output "$work/images.tar" "${images[@]}"
uname -a > "$work/os/kernel.txt"
dpkg-query -W -f='${binary:Package}\t${Version}\n' > "$work/os/packages.tsv"
tar -C / -cf "$work/os/config.tar" \
  etc/ssh/sshd_config.d/00-newscast-hardening.conf \
  etc/ufw etc/docker/daemon.json etc/systemd/journald.conf.d \
  etc/apt/apt.conf.d/99-newscast-updates \
  etc/needrestart/conf.d/99-newscast.conf \
  etc/sysctl.d/60-newscast-memory.conf etc/fstab \
  etc/default/grub.d/kdump-tools.cfg \
  usr/local/sbin/newscast-backup-export
if [[ -f $runtime_dir/RESTORE.md ]]; then cp "$runtime_dir/RESTORE.md" "$work/RESTORE.md"; fi
(cd "$work"; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
tar -C "$work" -cf - . | age -R "$runtime_dir/backup-recipient.txt" -o "$partial"
[[ -s $partial ]] || exit 1
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
echo "FULL_BACKUP=$name SHA256=$digest BYTES=$bytes"
