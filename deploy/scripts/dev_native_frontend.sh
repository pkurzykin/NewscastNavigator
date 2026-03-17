#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/frontend"

if [[ ! -f ".env" ]]; then
  echo "Не найден frontend/.env. Сначала выполни: cp .env.example .env" >&2
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  echo "Не найдены frontend/node_modules. Выполни: cd frontend && npm install" >&2
  exit 1
fi

set -a
source .env
set +a

HOST="${VITE_DEV_HOST:-127.0.0.1}"
PORT="${VITE_DEV_PORT:-5173}"

echo "Frontend dev: http://${HOST}:${PORT}"
echo "Используй 127.0.0.1, а не 127.0.0.0"

exec npm run dev
