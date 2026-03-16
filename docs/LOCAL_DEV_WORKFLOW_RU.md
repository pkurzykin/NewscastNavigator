# Local Dev Workflow

Дата актуализации: 2026-03-16

## Зачем это нужно

Этот runbook нужен для быстрого цикла разработки без касания production.

Цель:
- менять `frontend` и `backend`;
- сразу видеть результат;
- не пересобирать production на сервере по каждой мелочи.

## Рекомендуемый режим по умолчанию

Используй `web-dev` compose с hot-reload:
- `frontend` работает через `Vite`;
- `backend` работает через `uvicorn --reload`;
- код монтируется в контейнеры bind-mount'ами;
- обычные правки в `.tsx`, `.css`, `.py` подхватываются без rebuild.

## Первый запуск

Из корня репозитория:

```bash
bash deploy/scripts/dev_rebuild.sh
```

Открыть:
- `http://127.0.0.1:5173`

API:
- `http://127.0.0.1:8100/api/health`

База:
- Postgres на `127.0.0.1:5433`

## Обычный ежедневный запуск

Когда контейнеры уже были собраны раньше:

```bash
bash deploy/scripts/dev_up.sh
```

Остановка:

```bash
bash deploy/scripts/dev_down.sh
```

Логи:

```bash
bash deploy/scripts/dev_logs.sh
```

Логи отдельного сервиса:

```bash
bash deploy/scripts/dev_logs.sh frontend
```

```bash
bash deploy/scripts/dev_logs.sh backend
```

## Когда rebuild действительно нужен

`dev_rebuild.sh` нужен не на каждую правку, а только если изменилось что-то из этого:
- `backend/requirements.txt`
- `frontend/package.json`
- Dockerfile'ы
- системные зависимости контейнеров

Для обычных изменений в:
- `frontend/src/*.tsx`
- `frontend/src/*.css`
- `backend/app/**/*.py`

достаточно работающего `dev_up.sh` и обычного обновления страницы.

## Что дает быстрый цикл

### Frontend
- изменения UI обычно видны сразу через Vite HMR;
- иногда достаточно простого refresh;
- если браузер упрямится, делай hard refresh.

### Backend
- `uvicorn --reload` перезапускает API после изменения Python-кода;
- миграции Alembic прогоняются при старте контейнера backend.

## Важное ограничение

Этот dev-стек отделен от production:
- не используй его для публичного доступа;
- не путай с `/opt/newscast-web` на домашнем сервере;
- production обновляется только через `bash deploy/scripts/update_prod_stack.sh`.

## Рекомендуемый рабочий процесс

1. Поднять dev:
   `bash deploy/scripts/dev_up.sh`
2. Менять код локально.
3. Проверять UI в `http://127.0.0.1:5173`.
4. Когда правка готова, уже потом коммитить и при необходимости обновлять production.
