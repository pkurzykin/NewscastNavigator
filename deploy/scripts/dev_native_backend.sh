#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/backend"

if [[ ! -f ".env" ]]; then
  echo "Не найден backend/.env. Сначала выполни: cp .env.example .env" >&2
  exit 1
fi

if [[ -x ".venv/bin/uvicorn" ]]; then
  UVICORN_BIN=".venv/bin/uvicorn"
elif [[ -x ".venv311/bin/uvicorn" ]]; then
  UVICORN_BIN=".venv311/bin/uvicorn"
  echo "Предупреждение: используется legacy backend/.venv311. Нормализуй локальное окружение в backend/.venv на Python 3.11." >&2
else
  echo "Не найден локальный uvicorn в backend/.venv311 или backend/.venv" >&2
  echo "Сначала выполни: bash deploy/scripts/setup_backend_venv.sh" >&2
  exit 1
fi

PYTHON_BIN="$(dirname "$UVICORN_BIN")/python"
HOST="${BACKEND_HOST:-127.0.0.1}"
PORT="${BACKEND_PORT:-8100}"

PYTHONPATH=. "$PYTHON_BIN" scripts/bootstrap_runtime.py

echo "Backend dev: http://${HOST}:${PORT}/api/health"
echo "Используй 127.0.0.1, а не 127.0.0.0"

exec env PYTHONPATH=. "$UVICORN_BIN" app.main:app --reload --host "$HOST" --port "$PORT"
