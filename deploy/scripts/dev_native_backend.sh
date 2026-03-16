#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/backend"

if [[ -x ".venv311/bin/uvicorn" ]]; then
  UVICORN_BIN=".venv311/bin/uvicorn"
elif [[ -x ".venv/bin/uvicorn" ]]; then
  UVICORN_BIN=".venv/bin/uvicorn"
else
  echo "Не найден локальный uvicorn в backend/.venv311 или backend/.venv" >&2
  echo "Сначала создай venv и установи backend зависимости." >&2
  exit 1
fi

exec "$UVICORN_BIN" app.main:app --reload --host 127.0.0.1 --port 8100
