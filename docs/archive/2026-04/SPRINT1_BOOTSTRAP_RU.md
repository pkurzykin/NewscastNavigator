# Sprint 1 — Bootstrap Проверка (Web Migration)

Дата исходного спринта: 2026-02-16
Дата актуализации: 2026-03-16

Документ для проверки нового web-контура:
- `backend` (FastAPI)
- `frontend` (React + TypeScript + Vite)
- `db` (PostgreSQL)

Это исторический bootstrap-чеклист первого web-спринта. Использовать его нужно только как dev-проверку нового контура. Для текущего production/deploy смотри `docs/DEPLOYMENT_UBUNTU_RU.md`.

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

## 2. Как поднять dev-стек

Из корня репозитория:
```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml up -d --build
```

## 2.1 Проверка контейнеров
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

Локально:
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
- `http://127.0.0.1:5173`

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
- новый web-контур поднимается отдельно от старого legacy;
- логин и список проектов работают через новый API.
