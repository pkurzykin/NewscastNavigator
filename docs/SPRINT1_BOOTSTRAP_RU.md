# Sprint 1 — Bootstrap Проверка (Web Migration)

Дата: 2026-02-16

Документ для проверки нового web-контура:
- `backend` (FastAPI)
- `frontend` (React + TypeScript + Vite)
- `db` (PostgreSQL)

Текущий Streamlit-контур не удаляется и хранится отдельно в `legacy/streamlit_mvp/`.

## 1. Что появилось в проекте
- `backend/` — API-каркас:
  - `GET /api/health`
  - `POST /api/v1/auth/login`
  - `GET /api/v1/auth/me`
  - `GET /api/v1/projects?view=main|archive`
- `frontend/` — UI shell:
  - вход в систему,
  - переключение MAIN/ARCHIVE,
  - загрузка списка проектов из backend.
- `deploy/docker/docker-compose.web-dev.yml` — отдельный dev-compose для нового web.

## 2. Как запустить на сервере (dev)

## 2.1 Синхронизация кода (на Mac)
```bash
rsync -av \
  --exclude '.venv' \
  --exclude '__pycache__' \
  /Volumes/work/Projects/NewscastNavigator/ \
  wysiati@192.168.2.200:/opt/newscast-navigator-dev/
```

## 2.2 Подъем web-стека (на сервере)
```bash
cd /opt/newscast-navigator-dev
docker compose -f deploy/docker/docker-compose.web-dev.yml up -d --build
```

## 2.3 Проверка контейнеров
```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml ps
docker compose -f deploy/docker/docker-compose.web-dev.yml logs backend --tail=120
docker compose -f deploy/docker/docker-compose.web-dev.yml logs frontend --tail=120
docker compose -f deploy/docker/docker-compose.web-dev.yml logs db --tail=120
```

Ожидаемо:
- `db` = healthy;
- `backend` = running;
- `frontend` = running.

## 3. Проверка API

На сервере:
```bash
curl -fsS http://127.0.0.1:8100/api/health && echo
```

Ожидаемо:
```json
{"status":"ok"}
```

Проверка логина:
```bash
curl -sS -X POST http://127.0.0.1:8100/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

Проверка списка проектов:
```bash
curl -sS "http://127.0.0.1:8100/api/v1/projects?view=main"
curl -sS "http://127.0.0.1:8100/api/v1/projects?view=archive"
```

## 4. Проверка frontend
Открыть в браузере:
- `http://192.168.2.200:5173`

Дальше:
1. Войти `admin / admin123`.
2. Убедиться, что список проектов загрузился.
3. Переключить `MAIN -> ARCHIVE`.
4. Попробовать поиск по названию.
5. Нажать `F5` и убедиться, что сессия не сбрасывается на экран логина.

## 5. Что делать, если не поднялось
1. Полностью перезапусти стек:
```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml down
docker compose -f deploy/docker/docker-compose.web-dev.yml up -d --build
```
2. Если backend не стартует, смотри:
```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml logs backend --tail=200
```
3. Если frontend не видит API:
- проверь, что backend доступен на `http://127.0.0.1:8100/api/health`;
- проверь логи frontend и backend.

## 6. Ограничение текущего спринта
Это именно bootstrap-версия:
- нет полноценной серверной сессии в cookie;
- нет полноценного UI по вашим цветовым таблицам;
- нет переноса `EDITOR` и `ARCHIVE` логики 1-в-1.

Задача спринта выполнена, если:
- новый web-контур поднимается отдельно от Streamlit;
- логин и список проектов работают через новый API.
