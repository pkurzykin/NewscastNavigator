#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_NAME="newscast-web-compose.service"
SOURCE_UNIT="${ROOT_DIR}/deploy/systemd/${UNIT_NAME}"
TARGET_UNIT="/etc/systemd/system/${UNIT_NAME}"

if [[ ! -f "${SOURCE_UNIT}" ]]; then
  echo "Unit file not found: ${SOURCE_UNIT}" >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/scripts/install_systemd_unit.sh" >&2
  exit 1
fi

install -m 0644 "${SOURCE_UNIT}" "${TARGET_UNIT}"
systemctl daemon-reload
systemctl enable "${UNIT_NAME}"

echo "Installed and enabled ${UNIT_NAME}"
echo "Start manually when ready:"
echo "  systemctl start ${UNIT_NAME}"
