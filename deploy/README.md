# Deploy

Папка `deploy/` относится к новой web-архитектуре, но пока еще не полностью доведена до production-ready состояния.

## Что использовать сейчас

- `docker/docker-compose.web-dev.yml` — основной dev-compose для нового web-контура.
- `docker/docker-compose.web-prod.yml` — production foundation для нового web-контура.
- `env/web-prod.env.example` — пример production-переменных окружения.
- `nginx/` — web nginx-конфиги под новый контур.
- `scripts/` — backup/restore сценарии для production web-стека.
- `scripts/server_audit_snapshot.sh` — безопасный read-only snapshot текущего состояния домашнего сервера.
- `scripts/install_systemd_unit.sh` — установка `systemd` unit для нового production-контура.
- `scripts/uninstall_systemd_unit.sh` — удаление `systemd` unit нового production-контура.
- `systemd/newscast-web-compose.service` — пример systemd unit для запуска production compose.

Legacy deploy-файлы Streamlit уже вынесены в:
- `legacy/streamlit_mvp/deploy/`

## Важно

- На домашнем сервере уже работает какая-то версия проекта.
- Поэтому `deploy/` нельзя применять к серверу вслепую.
- Перед production deploy нужен отдельный аудит: текущий compose, контейнеры, volumes, база, storage, nginx и backup.
- В production compose порт nginx по умолчанию вынесен на `127.0.0.1:8088`, чтобы не конфликтовать с уже работающей серверной версией до завершения аудита.
- После завершения smoke-check новый production-контур можно переключить на публичный `:80`, изменив `NGINX_BIND_HOST` и `NGINX_HTTP_PORT` в `deploy/env/web-prod.env`.
