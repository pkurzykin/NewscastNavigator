#!/usr/bin/env bash
# Certbot renewal hook. It is installed but not enabled until CP7.
set -euo pipefail
umask 077
lineage=${RENEWED_LINEAGE:-}
[[ $lineage == /etc/letsencrypt/live/ncastnav.ru && -d $lineage && ! -L $lineage ]] || exit 2
runtime=/opt/newscast-production
[[ -d $runtime/tls && -f $runtime/runtime.env ]] || exit 2
[[ -d $runtime/tls/versions && -L $runtime/tls/active ]] || exit 2
stage=$(mktemp -d "$runtime/tls/versions/renewed-XXXXXX")
link=$runtime/tls/.active.$(basename "$stage").new
switched=false
cleanup() {
  rm -f -- "$link"
  if [[ $switched == false ]]; then rm -rf -- "$stage"; fi
}
trap cleanup EXIT
install -m 0600 "$lineage/fullchain.pem" "$stage/fullchain.pem"
install -m 0600 "$lineage/privkey.pem" "$stage/privkey.pem"
"$runtime/cert-health.sh" --tls-dir "$stage" >/dev/null
target=versions/$(basename "$stage")
ln -s "$target" "$link"
mv -Tf "$link" "$runtime/tls/active"
switched=true
if systemctl is-active --quiet newscast-production.service; then
  docker compose --project-name newscast_navigator_production --env-file "$runtime/runtime.env" -f "$runtime/compose.yaml" exec -T gateway nginx -s reload </dev/null
fi
echo 'CERT_RENEWAL_INSTALLED=true'
