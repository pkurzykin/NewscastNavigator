# Newscast Navigator — deployment status на Ubuntu

Дата актуализации: 2026-03-15

## Что важно понимать сейчас

Этот документ больше не описывает legacy Streamlit-deploy как целевую схему.

Текущая целевая архитектура проекта:
- `backend` — FastAPI
- `frontend` — React/Vite
- `db` — PostgreSQL
- `nginx` — reverse proxy
- `docker compose` — единый способ запуска

Отдельно важно:
- на домашнем сервере уже работает какая-то версия проекта;
- перед любыми изменениями на сервере нужен аудит текущего состояния;
- значит сейчас нельзя делать `deploy вслепую`.

## Текущий статус deploy-слоя

Что уже есть в репозитории:
- `deploy/docker/docker-compose.web-dev.yml` — dev-compose для нового web-контура;
- `deploy/docker/docker-compose.web-prod.yml` — production foundation для нового web-контура;
- `deploy/env/web-prod.env.example` — пример production `.env`;
- `deploy/nginx/` — nginx-конфиги под новый web-контур;
- `deploy/scripts/backup_db.sh` и `deploy/scripts/backup_storage.sh` — базовые backup-сценарии;
- `deploy/systemd/newscast-web-compose.service` — пример systemd unit.

Что еще не доведено до production-ready состояния:
- проверенный безопасный сценарий обновления уже работающего сервера.

## Правильный порядок действий перед server deploy

1. Провести аудит сервера.
Нужно выяснить:
- где лежит текущая версия проекта;
- как она запускается: `docker compose`, `systemd`, вручную;
- какие контейнеры и volumes используются;
- где лежат данные и файлы;
- какие домены, порты и nginx-конфиги уже заняты.

2. Сделать backup текущего состояния.
Минимум:
- backup базы;
- backup project files/storage;
- backup compose/nginx/systemd конфигов;
- backup каталога приложения на сервере.

3. Только после этого готовить production web-deploy.

## Production foundation, которая уже подготовлена

В репозитории теперь есть безопасная стартовая production-схема:
- `db` — PostgreSQL с отдельным volume;
- `backend` — FastAPI без `--reload`;
- `frontend` — production build React, отдаваемый из nginx-контейнера;
- `nginx` — внешний reverse proxy контейнер для маршрутизации `/` и `/api/`.

Важно:
- nginx в compose по умолчанию слушает только `127.0.0.1:${NGINX_HTTP_PORT}`;
- в примере это `127.0.0.1:8088`;
- это сделано специально, чтобы не занять production `:80/:443`, пока сервер не проаудирован.

## Что должно появиться в репозитории до production

- инструкция обновления без потери данных;
- backup/restore сценарии для новой архитектуры.

Эта база уже есть:
- production compose;
- `.env.example`;
- volumes для Postgres и storage;
- nginx-конфиг;
- backup/restore scripts.

## Что уже можно использовать сейчас

Для локальной разработки и проверки новой web-версии:
- `backend/`
- `frontend/`
- `deploy/docker/docker-compose.web-dev.yml`

Для подготовки production без касания сервера:
- `deploy/docker/docker-compose.web-prod.yml`
- `deploy/env/web-prod.env.example`
- `deploy/scripts/*`
- `docs/SERVER_AUDIT_CHECKLIST_RU.md`

## Что пока считается legacy

Следующие deploy-артефакты относятся к старой Streamlit-версии и не должны использоваться как финальная production-схема для нового web:
- `legacy/streamlit_mvp/Dockerfile` и `legacy/streamlit_mvp/docker-compose.yml`
- старые backup/restore сценарии, завязанные на legacy-структуру данных
- старые nginx/systemd-конфиги в `legacy/streamlit_mvp/deploy/`

## Вывод

Сейчас правильная стратегия такая:
- не трогать сервер до отдельного аудита;
- локально довести web-версию и cleanup репозитория;
- подготовить production deploy уже под новую архитектуру;
- затем пройти аудит сервера и только после него делать параллельный запуск нового контура.
