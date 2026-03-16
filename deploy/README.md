# Deploy

Папка `deploy/` — source of truth для актуального production-контура `Newscast Navigator`.

Рабочий server path:
- `/opt/newscast-web`

Рабочий runtime:
- compose project `newscast_web_prod`
- `systemd` unit `newscast-web-compose.service`

## Что использовать сейчас

- `docker/docker-compose.web-dev.yml` — основной dev-compose для нового web-контура.
- `docker/docker-compose.web-prod.yml` — production compose для нового web-контура.
- `env/web-prod.env.example` — пример production-переменных окружения.
- `nginx/` — web nginx-конфиги под новый контур.
- `scripts/` — backup/restore/update/status сценарии для production web-стека.
- `scripts/server_audit_snapshot.sh` — read-only snapshot сервера для повторного аудита или новой инсталляции.
- `scripts/install_systemd_unit.sh` — установка `systemd` unit для нового production-контура.
- `scripts/uninstall_systemd_unit.sh` — удаление `systemd` unit нового production-контура.
- `scripts/update_prod_stack.sh` — типовой серверный update: `git pull`, `alembic upgrade`, `compose up -d --build`.
- `scripts/status_prod_stack.sh` — быстрый статус production-контура: `systemd`, `compose ps`, `health`.
- `scripts/dev_up.sh` — поднять локальный hot-reload dev-стек без rebuild.
- `scripts/dev_rebuild.sh` — пересобрать локальный dev-стек после изменения зависимостей.
- `scripts/dev_down.sh` — остановить локальный dev-стек.
- `scripts/dev_logs.sh` — смотреть логи локального dev-стека.
- `systemd/newscast-web-compose.service` — пример systemd unit для запуска production compose.

## Важно

- Production уже переведен на новый web-контур, но все серверные изменения должны сначала попадать в репозиторий.
- Для day-2 сопровождения используй:
  - `bash deploy/scripts/status_prod_stack.sh`
  - `bash deploy/scripts/update_prod_stack.sh`
- Для быстрого локального цикла разработки используй `docs/LOCAL_DEV_WORKFLOW_RU.md` и dev helper scripts.
- Пример `.env` по умолчанию оставляет nginx на loopback-порту для безопасного bootstrap нового сервера.
- На действующем сервере публичный bind уже управляется production `.env`, а не ручными docker-командами.
