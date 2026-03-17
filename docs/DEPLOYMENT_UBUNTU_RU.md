# Newscast Navigator — deployment status на Ubuntu

Дата актуализации: 2026-03-16

## Что важно понимать сейчас

Текущая целевая архитектура проекта:
- `backend` — FastAPI
- `frontend` — React/Vite
- `db` — PostgreSQL
- `nginx` — reverse proxy
- `docker compose` — единый способ запуска

Production cutover уже выполнен.

Актуальный server state:
- deploy path: `/opt/newscast-web`
- compose project: `newscast_web_prod`
- service: `newscast-web-compose.service`
- публичный веб-доступ обслуживает новый web-контур

## Текущий статус deploy-слоя

Что уже есть в репозитории:
- `compose.yaml` — канонический production compose для clean bootstrap одной командой;
- `deploy/docker/docker-compose.web-dev.yml` — dev-compose для нового web-контура;
- `deploy/docker/docker-compose.web-prod.yml` — production compose для server scripts и совместимости с текущим runtime;
- `.env.example` — канонический пример env для корневого production compose;
- `deploy/env/web-prod.env.example` — пример production `.env`;
- `deploy/nginx/` — nginx-конфиги под новый web-контур;
- `deploy/scripts/backup_db.sh`, `restore_db.sh`, `backup_storage.sh`, `restore_storage.sh`, `backup_exports.sh`, `restore_exports.sh` — backup/restore сценарии;
- `deploy/scripts/update_prod_stack.sh` — воспроизводимое обновление production;
- `deploy/scripts/status_prod_stack.sh` — быстрый статус production;
- `deploy/systemd/newscast-web-compose.service` — source of truth для server unit.

## Текущая production-схема

На сервере используется следующая схема:
- `db` — PostgreSQL с отдельным volume;
- `backend` — FastAPI без `--reload`;
- `frontend` — production build React, отдаваемый из nginx-контейнера;
- `nginx` — внешний reverse proxy контейнер для маршрутизации `/` и `/api/`.

В примере `.env` bind по умолчанию остается loopback-only:
- `NGINX_BIND_HOST=127.0.0.1`
- `NGINX_HTTP_PORT=8088`

Это нужно для безопасного bootstrap нового сервера или повторной установки.
На действующем production-сервере bind уже переключен на публичный интерфейс через server `.env`.

## Как обслуживать production сейчас

Для bootstrap нового сервера без дополнительных ручных шагов:

```bash
cp .env.example .env
docker compose up -d --build
```

Для уже существующего домашнего сервера оставлен текущий server path и runbook ниже.
Миграции применяются автоматически на старте backend через `python scripts/bootstrap_runtime.py`.

Основные day-2 команды:

```bash
cd /opt/newscast-web
bash deploy/scripts/status_prod_stack.sh
```

```bash
cd /opt/newscast-web
bash deploy/scripts/update_prod_stack.sh
```

`status_prod_stack.sh` показывает:
- `systemd` status;
- `docker compose ps`;
- `health` endpoint.

`update_prod_stack.sh` делает:
- `git pull --ff-only`
- `docker compose up -d --build`

## Backup и rollback

На сервере уже должны храниться:
- backup Postgres;
- backup web storage;
- backup legacy-артефактов, созданные перед cutover и cleanup.

Каноническое место для новых backup'ов:
- `/opt/newscast-web/deploy/backups/`

Базовые команды:

```bash
cd /opt/newscast-web
bash deploy/scripts/backup_db.sh
bash deploy/scripts/backup_storage.sh
bash deploy/scripts/backup_exports.sh
```

```bash
cd /opt/newscast-web
bash deploy/scripts/restore_db.sh /path/to/postgres-backup.sql
bash deploy/scripts/restore_storage.sh /path/to/storage-backup.tar.gz
bash deploy/scripts/restore_exports.sh /path/to/exports-backup.tar.gz
```

Если нужен повторный импорт старых данных в чистую БД, используй `docs/LEGACY_DATA_MIGRATION_RU.md` и importer из `backend/scripts/import_legacy_sqlite.py`.

## Что уже очищено

Уже удалены:
- старые legacy/dev runtime-контуры;
- старые server directories legacy/dev-контура;
- старые dev volumes и images.

Итог:
- сервер обслуживает только новый web-контур;
- репозиторий больше не зависит от legacy deploy-файлов;
- дальнейшие изменения в production нужно вести только через `git + docker compose + systemd`.
