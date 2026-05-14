# Local Dev Workflow

Дата актуализации: 2026-05-07

## Зачем это нужно

Этот runbook нужен для быстрого цикла разработки без касания production.

Цель:
- менять `frontend` и `backend`;
- сразу видеть результат;
- не пересобирать production на сервере по каждой мелочи.

## Рекомендуемый режим по умолчанию

На этом Mac основной и самый удобный режим сейчас: `native dev`, без Docker.

Почему:
- UI-правки видны быстрее всего;
- нет лишних rebuild;
- нет проблем с Colima и bind mounts на внешнем диске `/Volumes/work/...`;
- production при этом вообще не затрагивается.

Используй:
- `backend` через `uvicorn --reload`
- `frontend` через `Vite`

## Native dev: первый запуск

Из корня репозитория:

```bash
bash deploy/scripts/setup_backend_venv.sh
```

Потом:

```bash
bash deploy/scripts/dev_native_backend.sh
```

В другом терминале:

```bash
bash deploy/scripts/dev_native_frontend.sh
```

Открыть:
- `http://127.0.0.1:5173`

API:
- `http://127.0.0.1:8100/api/health`

Важно: frontend dev-server должен работать именно на `5173`. Если порт занят, останови лишний Vite-процесс и запусти frontend заново; fallback на `5174` сломает login из-за локального `CORS_ORIGINS`.

Что уже настроено локально:
- `backend/.env` — native dev на SQLite вне репозитория, в пользовательском runtime-каталоге
- `frontend/.env` — прямой вызов API на `http://127.0.0.1:8100`
- каноническая backend venv: `backend/.venv` на Python `3.11`
- реальная backend venv создается в пользовательском cache-path и линкуется в `backend/.venv`
- для сборки этой среды используй `bash deploy/scripts/setup_backend_venv.sh`
- `backend/.venv311` допустим только как временный legacy fallback во время локальной миграции окружения

## Native dev: обычная ежедневная работа

1. Запустить backend:

```bash
bash deploy/scripts/dev_native_backend.sh
```

2. Запустить frontend:

```bash
bash deploy/scripts/dev_native_frontend.sh
```

3. Работать в браузере на `http://127.0.0.1:5173`

Если Vite сообщает, что порт `5173` занят, не переходи на соседний порт. Найди и останови лишний frontend dev-server, затем снова выполни `bash deploy/scripts/dev_native_frontend.sh`.

Остановка:
- `Ctrl + C` в каждом из двух терминалов.

## Когда нужен дополнительный setup

Только если менялись зависимости:
- `backend/requirements.txt`
- `frontend/package.json`

тогда нужно отдельно:
- `bash deploy/scripts/setup_backend_venv.sh`
- `cd frontend && npm install`

Для обычных изменений в:
- `frontend/src/*.tsx`
- `frontend/src/*.css`
- `backend/app/**/*.py`

ничего пересобирать не нужно.

## Отдельно про тестовое окружение backend

Для запуска backend smoke/API тестов нужен тот же Python `3.11+`, но с dev-зависимостями.

Минимально:

```bash
bash deploy/scripts/setup_backend_venv.sh
cd backend
./.venv/bin/python -m pytest -q
```

Если `pytest` не найден, это не ошибка проекта, а признак того, что в текущую venv не установлены `requirements-dev.txt`.

Практическое правило:
- для dev-server достаточно `requirements.txt`;
- для тестов дополнительно нужны `requirements-dev.txt`.

## Что дает быстрый цикл

### Frontend
- изменения UI обычно видны сразу через Vite HMR;
- иногда достаточно простого refresh;
- если браузер упрямится, делай hard refresh.

### Backend
- `uvicorn --reload` перезапускает API после изменения Python-кода;
- перед стартом `deploy/scripts/dev_native_backend.sh` сам выполняет `python scripts/bootstrap_runtime.py`;
- схема поднимается только через Alembic;
- storage и exports живут во внешнем runtime-каталоге, а не в рабочем дереве.

## Важное ограничение

Этот native dev-цикл отделен от production:
- не используй его для публичного доступа;
- не путай с `/opt/newscast-web` на домашнем сервере;
- production обновляется только через `bash deploy/scripts/update_prod_stack.sh`.

## Docker dev как запасной вариант

`web-dev` compose остается в проекте, но на этом Mac он вторичен:
- полезен для отдельных проверок containerized окружения;
- не нужен для повседневной UI-разработки.

Для Docker dev сначала нужен env-файл:

```bash
cp deploy/env/web-dev.env.example deploy/env/web-dev.env
```

## Рекомендуемый рабочий процесс

1. Поднять dev:
   `bash deploy/scripts/setup_backend_venv.sh`
   один раз после нового клона или изменения backend-зависимостей;
   `bash deploy/scripts/dev_native_backend.sh`
   и отдельно `bash deploy/scripts/dev_native_frontend.sh`
2. Менять код локально.
3. Проверять UI в `http://127.0.0.1:5173`.
4. Когда правка готова, уже потом коммитить и при необходимости обновлять production.
