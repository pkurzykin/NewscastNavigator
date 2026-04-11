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
- Для оперативного security-hardening можно использовать `python scripts/manage_users.py`.

## Управление пользователями

Сейчас backend поддерживает два практических security-сценария без прямого SQL:

- пользователь может сменить собственный пароль через `POST /api/v1/auth/change-password`;
- если у пользователя стоит временный пароль, первый вход принудительно ведет к смене пароля;
- администратор может деактивировать учетную запись через `POST /api/v1/users/{user_id}/activation`;
- для recovery/ops есть CLI-скрипт `python scripts/manage_users.py`.
- для массового заведения сотрудников из XLSX есть `python scripts/import_staff_xlsx.py`.

Примеры:

```bash
cd backend
python scripts/manage_users.py list
python scripts/manage_users.py set-password admin --password 'new-strong-password-123'
python scripts/manage_users.py set-temp-password admin
python scripts/manage_users.py deactivate author
python scripts/import_staff_xlsx.py '/path/to/staff.xlsx' --report /tmp/newscast_staff.tsv
```

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
