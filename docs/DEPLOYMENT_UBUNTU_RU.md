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
- `deploy/` — заготовка под будущий web deploy-слой.

Что еще не доведено до production-ready состояния:
- отдельный production compose для web-версии;
- согласованная схема volumes для Postgres и project storage;
- backup/restore именно для нового web-контура;
- актуальный nginx-конфиг под `frontend + backend`, а не под legacy;
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

## Что должно появиться в репозитории до production

- production compose-файл для web-версии;
- production `.env.example`;
- явные volumes для Postgres и project storage;
- актуальный nginx-конфиг;
- инструкция обновления без потери данных;
- backup/restore сценарии для новой архитектуры.

## Что уже можно использовать сейчас

Для локальной разработки и проверки новой web-версии:
- `backend/`
- `frontend/`
- `deploy/docker/docker-compose.web-dev.yml`

## Что пока считается legacy

Следующие deploy-артефакты относятся к старой Streamlit-версии и не должны использоваться как финальная production-схема для нового web:
- `legacy/streamlit_mvp/Dockerfile` и `legacy/streamlit_mvp/docker-compose.yml`
- старые backup/restore сценарии, завязанные на legacy-структуру данных
- старые nginx/systemd-конфиги в `legacy/streamlit_mvp/deploy/`

## Вывод

Сейчас правильная стратегия такая:
- не трогать сервер до отдельного аудита;
- локально довести web-версию и cleanup репозитория;
- затем подготовить production deploy уже под новую архитектуру.
