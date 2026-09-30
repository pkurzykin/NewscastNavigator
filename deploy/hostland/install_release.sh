#!/usr/bin/env bash
set -euo pipefail
umask 077

staging_dir=''
target=''
while [[ $# -gt 0 ]]; do
  case $1 in
    --staging-dir) staging_dir=${2:-}; shift 2 ;;
    --target) target=${2:-}; shift 2 ;;
    *) exit 2 ;;
  esac
done
[[ $target == /opt/newscast-production ]] || exit 2
[[ $staging_dir =~ ^/opt/newscast-release-staging-[a-z0-9-]+$ ]] || exit 2
[[ -d $staging_dir && ! -L $staging_dir && ! -e $target && ! -L $target ]] || exit 2
for file in source.tar.gz source.sha256 image-manifest.json runtime.env backup-recipient.txt tls/fullchain.pem tls/privkey.pem; do
  [[ -f $staging_dir/$file && ! -L $staging_dir/$file ]] || { echo "Release staging prerequisite missing: $file" >&2; exit 2; }
done
self_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
for file in production.compose.yaml production-gateway.conf.template verify_release.sh backup_db_interval.sh build_full_backup.sh backup_export_allowlist.sh home_pull_verify.sh restore_production.sh db_fingerprint.py prod_smoke.py cert-health.sh certbot-deploy-hook.sh; do
  [[ -f $self_dir/$file ]] || { echo "Installer code prerequisite missing: $file" >&2; exit 2; }
done
restore_runbook=$self_dir/../../docs/operations/hostland/RESTORE_PRODUCTION.md
[[ -f $restore_runbook ]] || { echo "Installer documentation prerequisite missing: $restore_runbook" >&2; exit 2; }

install -d -m 0700 "$target" "$target/tls" "$target/tls/versions" "$target/tls/versions/initial"
# The bind-mounted webroot itself must be traversable by nginx's worker.
install -d -m 0755 "$target/acme-webroot"
install -m 0600 "$staging_dir/source.tar.gz" "$staging_dir/source.sha256" "$staging_dir/image-manifest.json" "$staging_dir/runtime.env" "$staging_dir/backup-recipient.txt" "$target/"
install -m 0600 "$staging_dir/tls/fullchain.pem" "$staging_dir/tls/privkey.pem" "$target/tls/versions/initial/"
ln -s versions/initial "$target/tls/active"
install -m 0600 "$self_dir/production.compose.yaml" "$target/compose.yaml"
install -m 0600 "$self_dir/production-gateway.conf.template" "$target/production-gateway.conf.template"
for script in verify_release.sh backup_db_interval.sh build_full_backup.sh restore_production.sh cert-health.sh certbot-deploy-hook.sh; do
  install -m 0700 "$self_dir/$script" "$target/$script"
done
install -m 0600 "$self_dir/db_fingerprint.py" "$target/db_fingerprint.py"
install -m 0700 "$self_dir/prod_smoke.py" "$target/prod_smoke.py"
install -d -m 0700 "$target/systemd"
install -m 0600 "$self_dir/systemd/"*.service "$self_dir/systemd/"*.timer "$target/systemd/"
install -m 0600 "$restore_runbook" "$target/RESTORE.md"
"$target/verify_release.sh" --runtime-dir "$target"
echo 'RELEASE_STAGED=true (no service or DNS change)'
