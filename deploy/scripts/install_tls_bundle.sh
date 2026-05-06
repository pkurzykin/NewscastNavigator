#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: bash deploy/scripts/install_tls_bundle.sh <source-dir> <target-dir>" >&2
  echo "Example: bash deploy/scripts/install_tls_bundle.sh /path/to/tls-source /etc/newscast-web/ssl/<domain>" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$1" && pwd)"
TARGET_DIR="$2"

FULLCHAIN_SOURCE="$SOURCE_DIR/fullchain.pem"
PRIVKEY_SOURCE="$SOURCE_DIR/privkey.pem"

if [[ ! -f "$FULLCHAIN_SOURCE" ]]; then
  CRT_SOURCE="$SOURCE_DIR/certificate.crt"
  CA_SOURCE="$SOURCE_DIR/certificate_ca.crt"
  if [[ ! -f "$CRT_SOURCE" || ! -f "$CA_SOURCE" ]]; then
    echo "Не найден ни fullchain.pem, ни пара certificate.crt + certificate_ca.crt в $SOURCE_DIR" >&2
    exit 1
  fi
  FULLCHAIN_SOURCE="$(mktemp)"
  trap 'rm -f "$FULLCHAIN_SOURCE"' EXIT
  cat "$CRT_SOURCE" "$CA_SOURCE" > "$FULLCHAIN_SOURCE"
fi

if [[ ! -f "$PRIVKEY_SOURCE" ]]; then
  KEY_SOURCE="$SOURCE_DIR/certificate.key"
  if [[ ! -f "$KEY_SOURCE" ]]; then
    echo "Не найден ни privkey.pem, ни certificate.key в $SOURCE_DIR" >&2
    exit 1
  fi
  PRIVKEY_SOURCE="$KEY_SOURCE"
fi

openssl x509 -in "$FULLCHAIN_SOURCE" -noout >/dev/null
openssl pkey -in "$PRIVKEY_SOURCE" -noout >/dev/null

install -d -m 755 "$TARGET_DIR"
install -m 644 "$FULLCHAIN_SOURCE" "$TARGET_DIR/fullchain.pem"
install -m 600 "$PRIVKEY_SOURCE" "$TARGET_DIR/privkey.pem"

echo "TLS bundle установлен:"
echo "  fullchain: $TARGET_DIR/fullchain.pem"
echo "  privkey:   $TARGET_DIR/privkey.pem"
