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

exec npm run dev
