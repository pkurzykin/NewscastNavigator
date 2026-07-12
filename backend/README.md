# Backend

FastAPI backend Product Reset для NewscastNavigator.

## Требования

- Python 3.11+
- PostgreSQL 16+

PostgreSQL — единственная рабочая база. SQLite используется только как быстрый
изолированный test double; обязательная миграционная проверка выполняется на пустой
PostgreSQL через `compose.test.yaml`.

## Подготовка

```bash
bash deploy/scripts/setup_backend_venv.sh
cd backend
cp .env.example .env
./.venv/bin/alembic upgrade head
./.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8100
```

Backend повторно проверяет migration head при старте; отдельный удалённый
`bootstrap_runtime.py` больше не участвует в runtime.

Первый начальник создаётся только явной командой без default credentials:

```bash
BOOTSTRAP_ADMIN_USERNAME=chief \
BOOTSTRAP_ADMIN_DISPLAY_NAME=Астра \
BOOTSTRAP_ADMIN_POSITION=Начальник \
BOOTSTRAP_ADMIN_PASSWORD='<temporary-password>' \
./.venv/bin/python scripts/bootstrap_admin.py
```

Пароль не печатается. После входа временный пароль нужно сменить.

Синтетический demo-seed запускается отдельно и запрещён в production:

```bash
./.venv/bin/python scripts/seed_demo.py
```

Seed создаёт 30 активных и 5 архивных учебных сюжетов, вымышленные однословные
имена и только `.invalid` ссылки на материалы.

## Авторизация и пользователи

- сессия хранится в подписанной `HttpOnly` cookie;
- пароль хранится только как PBKDF2-HMAC-SHA256 (390000 итераций, случайная соль);
- права объединяются по `function_codes`; переключателя текущей роли нет;
- только пользователь с функцией `chief` управляет пользователями;
- последнего активного `chief` нельзя деактивировать или лишить функции.

Текущий CaptionPanels/CEP fetch использует origin `null`. Для него пример окружения
явно задаёт `ALLOW_NULL_CORS_ORIGIN=true`. Флаг разрешает только точное значение
`null`; wildcard, локальные и некорректные origin в production остаются запрещены.

Локальные административные команды:

```bash
./.venv/bin/python scripts/manage_users.py list
./.venv/bin/python scripts/manage_users.py create-user demo \
  --display-name Янтарь --position Корреспондент --function author
./.venv/bin/python scripts/manage_users.py set-temp-password demo
./.venv/bin/python scripts/manage_users.py deactivate demo
```

## Проверка Commit 2.1

```bash
./.venv/bin/python -m pytest -q \
  tests/test_auth.py \
  tests/test_password_security.py \
  tests/test_admin.py \
  tests/test_permissions.py \
  tests/test_migration_baseline.py \
  tests/test_runtime_setup.py \
  tests/test_demo_seed_policy.py

./.venv/bin/python -m compileall app migrations
./.venv/bin/python -m pip check
```
