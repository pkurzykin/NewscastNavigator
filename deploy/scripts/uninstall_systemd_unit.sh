#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="newscast-web-compose.service"
TARGET_UNIT="/etc/systemd/system/${UNIT_NAME}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/scripts/uninstall_systemd_unit.sh" >&2
  exit 1
fi

if systemctl is-enabled "${UNIT_NAME}" >/dev/null 2>&1; then
  systemctl disable "${UNIT_NAME}" || true
fi

if systemctl is-active "${UNIT_NAME}" >/dev/null 2>&1; then
  systemctl stop "${UNIT_NAME}" || true
fi

rm -f "${TARGET_UNIT}"
systemctl daemon-reload

echo "Removed ${UNIT_NAME}"
