#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/backend"

if [[ ! -f ".env" ]]; then
  echo "Не найден backend/.env. Сначала выполни: cp .env.example .env" >&2
  exit 1
fi

if [[ -x ".venv311/bin/uvicorn" ]]; then
  UVICORN_BIN=".venv311/bin/uvicorn"
elif [[ -x ".venv/bin/uvicorn" ]]; then
  UVICORN_BIN=".venv/bin/uvicorn"
else
  echo "Не найден локальный uvicorn в backend/.venv311 или backend/.venv" >&2
  echo "Сначала создай venv и установи backend зависимости." >&2
  exit 1
fi

PYTHON_BIN="$(dirname "$UVICORN_BIN")/python"
HOST="${BACKEND_HOST:-127.0.0.1}"
PORT="${BACKEND_PORT:-8100}"

PYTHONPATH=. "$PYTHON_BIN" scripts/bootstrap_runtime.py

echo "Backend dev: http://${HOST}:${PORT}/api/health"
echo "Используй 127.0.0.1, а не 127.0.0.0"

exec env PYTHONPATH=. "$UVICORN_BIN" app.main:app --reload --host "$HOST" --port "$PORT"
