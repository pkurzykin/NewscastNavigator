#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

PYTHON_BIN="${BACKEND_PYTHON_BIN:-python3.11}"
CACHE_ROOT="${NEWCAST_NAVIGATOR_CACHE_ROOT:-$HOME/.cache/newscast-navigator}"
REAL_VENV="${BACKEND_VENV_REAL_PATH:-$CACHE_ROOT/backend-venv-py311}"
LINK_PATH="$BACKEND_DIR/.venv"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Не найден $PYTHON_BIN." >&2
  echo "Установи Python 3.11+ или передай BACKEND_PYTHON_BIN=/path/to/python3.11." >&2
  exit 1
fi

mkdir -p "$CACHE_ROOT"

if [[ ! -x "$REAL_VENV/bin/python" ]]; then
  echo "Создаю backend venv в $REAL_VENV"
  "$PYTHON_BIN" -m venv "$REAL_VENV"
fi

echo "Обновляю backend зависимости в $REAL_VENV"
"$REAL_VENV/bin/python" -m pip install --upgrade pip setuptools wheel
"$REAL_VENV/bin/python" -m pip install \
  -r "$BACKEND_DIR/requirements.txt" \
  -r "$BACKEND_DIR/requirements-dev.txt"
"$REAL_VENV/bin/python" -m pip check

if [[ -L "$LINK_PATH" ]]; then
  CURRENT_TARGET="$(readlink "$LINK_PATH")"
  if [[ "$CURRENT_TARGET" != "$REAL_VENV" ]]; then
    rm "$LINK_PATH"
    ln -s "$REAL_VENV" "$LINK_PATH"
  fi
elif [[ -e "$LINK_PATH" ]]; then
  BACKUP_PATH="$BACKEND_DIR/.venv.backup-$(date +%Y%m%d-%H%M%S)"
  mv "$LINK_PATH" "$BACKUP_PATH"
  echo "Существующий backend/.venv перенесен в $BACKUP_PATH"
  ln -s "$REAL_VENV" "$LINK_PATH"
else
  ln -s "$REAL_VENV" "$LINK_PATH"
fi

echo "Backend venv готов:"
"$LINK_PATH/bin/python" --version
"$LINK_PATH/bin/python" -m pip --version
