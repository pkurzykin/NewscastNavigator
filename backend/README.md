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
uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
```

Проверка:

```bash
curl http://127.0.0.1:8100/api/health
```

## Что важно помнить

- Основная целевая БД для проекта: PostgreSQL.
- Для локального smoke-теста backend может работать и на SQLite, если задать `DATABASE_URL=sqlite:///...`.
- Автосоздание схемы и demo seed управляются переменными `AUTO_CREATE_SCHEMA` и `SEED_DEMO_DATA`.
