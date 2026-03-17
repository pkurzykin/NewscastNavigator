# Backend

FastAPI backend для новой web-версии `Newscast Navigator`.

## Требования

- Python `3.11+`
- локально можно запускать как с PostgreSQL, так и в smoke-режиме через SQLite

## Локальный запуск

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python scripts/bootstrap_runtime.py
uvicorn app.main:app --reload --host 127.0.0.1 --port 8100
```

Проверка:

```bash
curl http://127.0.0.1:8100/api/health
```

Для ежедневной локальной работы на этом Mac используй `bash deploy/scripts/dev_native_backend.sh` и общий workflow из `docs/LOCAL_DEV_WORKFLOW_RU.md`.

## Что важно помнить

- Основная целевая БД для проекта: PostgreSQL.
- Для локального smoke-теста backend может работать и на SQLite, если задать `DATABASE_URL=sqlite:///...`.
- Схема меняется только через Alembic. Для локального bootstrap используй `python scripts/bootstrap_runtime.py`.
- Demo seed управляется переменной `SEED_DEMO_DATA`.

## Backend smoke tests

Для route-level smoke-проверки:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
```

Тесты поднимают FastAPI-приложение на временной SQLite-базе и проверяют:
- логин;
- роли;
- `MAIN/ARCHIVE`;
- `EDITOR/WORKSPACE`;
- архив/restore;
- историю проекта;
- экспорт.
