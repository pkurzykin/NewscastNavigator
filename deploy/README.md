# Deploy

Папка `deploy/` — source of truth для актуального production-контура `Newscast Navigator`.

Рабочий server path:
- `/opt/newscast-web`

Рабочий runtime:
- compose project `newscast_web_prod`
- `systemd` unit `newscast-web-compose.service`

## Что использовать сейчас

- `../compose.yaml` в корне репозитория — канонический production compose для запуска одной командой `docker compose up`.
- `docker/docker-compose.web-dev.yml` — основной dev-compose для нового web-контура.
- `../.env.example` — канонический пример env для production compose из корня репозитория.
- `env/web-prod.env.example` — совместимый пример production-переменных окружения; на сервере рабочий файл теперь живет как `../.env`.
- `env/web-dev.env.example` — пример dev-переменных окружения для Docker dev-цикла.
- `nginx/` — web nginx-конфиги под новый контур.
  - внутренний app-gateway для frontend/backend;
  - отдельный edge reverse proxy как единственная публичная точка входа.
- `scripts/` — backup/restore/update/status сценарии для production web-стека.
- `scripts/server_audit_snapshot.sh` — read-only snapshot сервера для повторного аудита или новой инсталляции.
- `scripts/install_systemd_unit.sh` — установка `systemd` unit для нового production-контура.
- `scripts/uninstall_systemd_unit.sh` — удаление `systemd` unit нового production-контура.
- `scripts/update_prod_stack.sh` — типовой серверный update: `git pull`, `compose up -d --build`.
- `scripts/status_prod_stack.sh` — быстрый статус production-контура: `systemd`, `compose ps`, `health`.
- `scripts/dev_up.sh` — поднять локальный hot-reload dev-стек без rebuild.
- `scripts/dev_rebuild.sh` — пересобрать локальный dev-стек после изменения зависимостей.
- `scripts/dev_down.sh` — остановить локальный dev-стек.
- `scripts/dev_logs.sh` — смотреть логи локального dev-стека.
- `scripts/dev_native_backend.sh` — основной локальный backend-runner без Docker.
- `scripts/dev_native_frontend.sh` — основной локальный frontend-runner без Docker.
- `systemd/newscast-web-compose.service` — пример systemd unit для запуска production compose.

## Важно

- Production уже переведен на новый web-контур, но все серверные изменения должны сначала попадать в репозиторий.
- Для clean bootstrap на новом сервере канонический путь теперь такой:
  - `cp .env.example .env`
  - `docker compose up -d --build`
- На действующем сервере каноническая схема такая же:
  - `/opt/newscast-web/compose.yaml`
  - `/opt/newscast-web/.env`
  - `/etc/newscast-web/newscast-web.env` только указывает `systemd`, где лежат эти два файла.
- При таком старте backend сам применяет Alembic-миграции через `python scripts/bootstrap_runtime.py`.
- Для day-2 сопровождения используй:
  - `bash deploy/scripts/status_prod_stack.sh`
  - `bash deploy/scripts/update_prod_stack.sh`
- Для быстрого локального цикла разработки используй `docs/LOCAL_DEV_WORKFLOW_RU.md`. На этом Mac основной режим — native dev, Docker dev оставлен как дополнительный.
- Пример `.env` по умолчанию оставляет nginx на loopback-порту для безопасного bootstrap нового сервера.
- На действующем сервере публичный bind уже управляется production `.env`, а не ручными docker-командами.
- Production-схема теперь подразумевает два слоя:
  - внутренний `nginx` в compose проксирует `frontend` и `backend` внутри docker-сети;
  - внешний `edge` публикует только один порт наружу и проксирует трафик во внутренний `nginx`.
- Backend runtime теперь fail-fast проверяет production-конфиг и не должен стартовать, если:
  - `ENVIRONMENT=production`, но включен `SEED_DEMO_DATA=true`;
  - `SECRET_KEY` или `SESSION_SECRET` остались placeholder-значениями;
  - `DATABASE_URL` содержит placeholder credentials вроде `change-this-*`.
- Перед production bootstrap обязательно проверь:
  - `SECRET_KEY` заменен на сильное значение;
  - `POSTGRES_PASSWORD` и `DATABASE_URL` не содержат placeholder-пароли;
  - `SEED_DEMO_DATA=false`;
  - `NGINX_BIND_HOST=127.0.0.1`, если наружный доступ не закрыт отдельным reverse proxy/VPN.
- Edge reverse proxy сейчас дает:
  - отделение публичного входа от самого приложения;
  - базовые security headers;
  - `Content-Security-Policy`, `Permissions-Policy`, `COOP/CORP` для более жесткого браузерного контура;
  - rate limit на `POST /api/v1/auth/login` до попадания запроса в backend.
- Production web UI теперь уже рассчитан на операционный цикл с реальными учетками:
  - создание пользователя;
  - временный пароль с обязательной сменой при первом входе;
  - смена роли и деактивация из UI;
  - сброс временного пароля без ручного SQL.
- Для быстрого исправления слабых паролей и demo-учеток без ручного SQL используй:
  - `cd /opt/newscast-web/backend`
  - `python scripts/manage_users.py list`
  - `python scripts/manage_users.py set-password admin`
  - `python scripts/manage_users.py deactivate author`
  - `python scripts/manage_users.py deactivate editor`
  - `python scripts/manage_users.py deactivate proofreader`
