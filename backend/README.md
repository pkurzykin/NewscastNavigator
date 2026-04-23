# Backend

FastAPI backend для новой web-версии `Newscast Navigator`.

## Требования

- Python `3.11+`
- локально можно запускать как с PostgreSQL, так и в smoke-режиме через SQLite

## Локальный запуск

```bash
bash deploy/scripts/setup_backend_venv.sh
cd backend
cp .env.example .env
./.venv/bin/python scripts/bootstrap_runtime.py
./.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8100
```

Проверка:

```bash
curl http://127.0.0.1:8100/api/health
```

Для ежедневной локальной работы на этом Mac используй `bash deploy/scripts/dev_native_backend.sh` и общий workflow из `docs/LOCAL_DEV_WORKFLOW_RU.md`.

Каноническая локальная среда backend:
- `backend/.venv`
- Python `3.11`
- bootstrap одной командой: `bash deploy/scripts/setup_backend_venv.sh`

Если локально еще остался `backend/.venv311`, считай его временным legacy fallback. Новые зависимости и dev-инструменты ставь в `backend/.venv`.

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
bash deploy/scripts/setup_backend_venv.sh
cd backend
./.venv/bin/python -m pytest -q
```

Если `pytest` не найден, значит в активную venv не были установлены dev-зависимости. В этом случае сначала установи `requirements-dev.txt` в ту же среду, из которой запускаешь backend-команды.

Тесты поднимают FastAPI-приложение на временной SQLite-базе и проверяют:
- логин;
- роли;
- `MAIN/ARCHIVE`;
- `EDITOR/WORKSPACE`;
- архив/restore;
- историю проекта;
- экспорт.
