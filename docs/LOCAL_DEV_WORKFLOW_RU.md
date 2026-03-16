# Local Dev Workflow

Дата актуализации: 2026-03-16

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

Что уже настроено локально:
- `backend/.env` — native dev на SQLite `backend/.runtime/dev.db`
- `frontend/.env` — прямой вызов API на `http://127.0.0.1:8100`

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

Остановка:
- `Ctrl + C` в каждом из двух терминалов.

## Когда нужен дополнительный setup

Только если менялись зависимости:
- `backend/requirements.txt`
- `frontend/package.json`

тогда нужно отдельно:
- `cd backend && ... pip install -r requirements.txt`
- `cd frontend && npm install`

Для обычных изменений в:
- `frontend/src/*.tsx`
- `frontend/src/*.css`
- `backend/app/**/*.py`

ничего пересобирать не нужно.

## Что дает быстрый цикл

### Frontend
- изменения UI обычно видны сразу через Vite HMR;
- иногда достаточно простого refresh;
- если браузер упрямится, делай hard refresh.

### Backend
- `uvicorn --reload` перезапускает API после изменения Python-кода;
- схема и demo-данные поднимаются локально через SQLite runtime.

## Важное ограничение

Этот native dev-цикл отделен от production:
- не используй его для публичного доступа;
- не путай с `/opt/newscast-web` на домашнем сервере;
- production обновляется только через `bash deploy/scripts/update_prod_stack.sh`.

## Docker dev как запасной вариант

`web-dev` compose остается в проекте, но на этом Mac он вторичен:
- полезен для отдельных проверок containerized окружения;
- не нужен для повседневной UI-разработки.

## Рекомендуемый рабочий процесс

1. Поднять dev:
   `bash deploy/scripts/dev_native_backend.sh`
   и отдельно `bash deploy/scripts/dev_native_frontend.sh`
2. Менять код локально.
3. Проверять UI в `http://127.0.0.1:5173`.
4. Когда правка готова, уже потом коммитить и при необходимости обновлять production.
