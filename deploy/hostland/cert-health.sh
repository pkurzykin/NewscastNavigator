#!/usr/bin/env bash
set -euo pipefail
tls_dir=/opt/newscast-production/tls/active
while [[ $# -gt 0 ]]; do
  case $1 in
    --tls-dir) tls_dir=${2:-}; shift 2 ;;
    *) exit 2 ;;
  esac
done
if [[ $tls_dir == /opt/newscast-production/tls/active ]]; then
  [[ -L $tls_dir && $(readlink "$tls_dir") =~ ^versions/[A-Za-z0-9-]+$ ]] || exit 2
  tls_dir=$(realpath -e "$tls_dir")
fi
cert=$tls_dir/fullchain.pem
key=$tls_dir/privkey.pem
[[ -d $tls_dir && ! -L $tls_dir && -f $cert && ! -L $cert && -f $key && ! -L $key ]] || exit 2
openssl x509 -in "$cert" -noout >/dev/null
openssl pkey -in "$key" -noout >/dev/null 2>&1
if ! cmp -s <(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER) \
           <(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null); then
  echo 'CERT_HEALTH=fail reason=key_mismatch' >&2
  exit 1
fi
san=$(openssl x509 -in "$cert" -noout -ext subjectAltName)
if [[ ! $san =~ DNS:ncastnav\.ru([,[:space:]]|$) || ! $san =~ DNS:www\.ncastnav\.ru([,[:space:]]|$) ]]; then
  echo 'CERT_HEALTH=fail reason=missing_hostname' >&2
  exit 1
fi
if ! openssl x509 -in "$cert" -checkend 2592000 -noout >/dev/null; then
  echo 'CERT_HEALTH=fail reason=expires_within_30_days' >&2
  exit 1
fi
expires=$(openssl x509 -in "$cert" -noout -enddate | cut -d= -f2-)
echo "CERT_HEALTH=ok expires=$expires"
