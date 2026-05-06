# Newscast Navigator — deployment status на Ubuntu

Дата актуализации: 2026-05-06

## Что важно понимать сейчас

Текущая целевая архитектура проекта:
- `backend` — FastAPI;
- `frontend` — React/Vite;
- `db` — PostgreSQL;
- `nginx` — внутренний app-gateway для `frontend` и `backend`;
- `edge` — reverse proxy контейнер, единственная host-facing точка входа;
- `docker compose` — единый способ запуска.

Production cutover уже выполнен.

Актуальный server state:
- deploy path: `/opt/newscast-web`;
- compose project: `newscast_web_prod`;
- service: `newscast-web-compose.service`;
- production обслуживается новым web-контуром;
- домен и DNS задает владелец проекта в production `.env`.

## Текущий статус deploy-слоя

Что уже есть в репозитории:
- `compose.yaml` — канонический production compose;
- `.env.example` — безопасный пример production `.env` без секретов и без публичного bind по умолчанию;
- `deploy/env/web-prod.env.example` — совместимый пример production-переменных;
- `deploy/docker/docker-compose.web-dev.yml` — dev-compose для нового web-контура;
- `deploy/nginx/` — nginx-конфиги внутреннего app-gateway и edge reverse proxy;
- `deploy/systemd/newscast-web-compose.service` — source of truth для server unit;
- `deploy/scripts/backup_db.sh`, `restore_db.sh`, `backup_storage.sh`, `restore_storage.sh`, `backup_exports.sh`, `restore_exports.sh` — backup/restore сценарии;
- `deploy/scripts/update_prod_stack.sh` — воспроизводимое обновление production через `git pull --ff-only` и `docker compose up -d --build`;
- `deploy/scripts/status_prod_stack.sh` — быстрый статус production;
- `deploy/scripts/install_tls_bundle.sh` — установка TLS bundle без коммита сертификатов в репозиторий.

## Production readiness

Для текущего web-only release candidate в репозитории закрыто:
- воспроизводимый запуск через `compose.yaml` + `.env`;
- backup/restore сценарии для БД, storage и exports;
- обновление production через `git + docker compose + systemd`;
- production runtime fail-fast для небезопасных env и demo/default users.

Repository-side blocker по perimeter hardening закрывается конфигурацией и проверками:
- edge reverse proxy по умолчанию bind'ится на `127.0.0.1`, а не наружу;
- public bind `0.0.0.0` включается только после DNS/TLS/access policy;
- TLS завершается на edge reverse proxy;
- `80` редиректит на `443`;
- backend в `ENVIRONMENT=production` откажется стартовать с demo seed, placeholder secrets, SQLite, wildcard/dev/plain HTTP CORS и активными demo/default credentials.

Что не может быть заполнено в репозитории и остается ручным input владельца:
- утвержденный домен и DNS records;
- реальные production secrets и пароли;
- TLS certificate/private key;
- реальные production users и их временные пароли.

## Production-схема

Контейнеры:
- `db` хранит PostgreSQL в docker volume `web_pg_data`;
- `backend` слушает `0.0.0.0:8000` только внутри docker-сети и публикуется через `expose`;
- `frontend` слушает `8080` только внутри docker-сети и публикуется через `expose`;
- внутренний `nginx` проксирует `/api/` в backend и `/` во frontend, host-порты не публикует;
- `edge` публикует host-порты и проксирует весь трафик во внутренний `nginx`.

Безопасный default:

```env
NGINX_BIND_HOST=127.0.0.1
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
NGINX_SERVER_NAME=example.com www.example.com
SSL_CERT_PATH=/etc/newscast-web/ssl/example.com/fullchain.pem
SSL_KEY_PATH=/etc/newscast-web/ssl/example.com/privkey.pem
CORS_ORIGINS=https://example.com,https://www.example.com,null
```

Для публичного rollout владелец меняет `example.com` на утвержденный домен. Если выбран домен `ncastnav.ru`, значения будут такими:

```env
NGINX_BIND_HOST=0.0.0.0
NGINX_SERVER_NAME=ncastnav.ru www.ncastnav.ru
SSL_CERT_PATH=/etc/newscast-web/ssl/ncastnav.ru/fullchain.pem
SSL_KEY_PATH=/etc/newscast-web/ssl/ncastnav.ru/privkey.pem
CORS_ORIGINS=https://ncastnav.ru,https://www.ncastnav.ru,null
```

`null` в `CORS_ORIGINS` нужен для прямого `fetch` из CEP/CaptionPanels: панель может отправлять `Origin: null`. Wildcard `*`, dev-origins и plain HTTP origins в production запрещены runtime-проверкой.

В текущем web-контуре нет отдельных websocket/SSE endpoints. Если они появятся, их нужно явно добавить в nginx template с `Upgrade`/streaming headers и обновить smoke-checklist.

## Bootstrap нового production

Перед любыми действиями с существующим сервером сначала сделай backup пользовательских данных:

```bash
cd /opt/newscast-web
bash deploy/scripts/backup_db.sh
bash deploy/scripts/backup_storage.sh
bash deploy/scripts/backup_exports.sh
```

Для нового сервера:

```bash
git clone <repo-url> /opt/newscast-web
cd /opt/newscast-web
cp .env.example .env
```

Заполни `/opt/newscast-web/.env`:
- `POSTGRES_PASSWORD` — сильный пароль;
- `DATABASE_URL` — тот же пароль в DSN;
- `SECRET_KEY` — сильный random secret, например `openssl rand -hex 32`;
- `SEED_DEMO_DATA=false`;
- `NGINX_BIND_HOST=127.0.0.1` до финального открытия наружу;
- `NGINX_SERVER_NAME`, `SSL_CERT_PATH`, `SSL_KEY_PATH`, `CORS_ORIGINS` — под реальный домен;
- `FRONTEND_VITE_API_BASE_URL=` оставить пустым, если frontend и backend живут за одним reverse proxy.

Установи TLS bundle:

```bash
cd /opt/newscast-web
bash deploy/scripts/install_tls_bundle.sh /path/to/source-dir /etc/newscast-web/ssl/<domain>
```

Если сертификат выдан отдельными файлами `certificate.crt` и `certificate_ca.crt`, скрипт соберет `fullchain.pem`. Private key должен остаться только на сервере и не должен попадать в git.

Проверь compose:

```bash
cd /opt/newscast-web
docker compose --env-file .env -f compose.yaml config >/tmp/newscast-compose.rendered.yml
```

Запусти stack:

```bash
cd /opt/newscast-web
docker compose --env-file .env -f compose.yaml up -d --build
```

## Production accounts

Production не должен использовать demo/default credentials:
- не включать `SEED_DEMO_DATA=true`;
- не оставлять `admin / admin123`;
- не оставлять активных demo-users `editor`, `author`, `proofreader` из seed-набора;
- реальные пользователи создаются с временными паролями и обязательной сменой при первом входе.

Для чистой production БД после первого запуска создай первого администратора one-off командой:

```bash
cd /opt/newscast-web
docker compose --env-file .env -f compose.yaml exec backend \
  python scripts/manage_users.py create-user <admin-login> \
  --role admin \
  --full-name "<real full name>" \
  --job-title "<real job title>"
```

Команда выведет временный пароль один раз. Передай его владельцу аккаунта безопасным каналом, после первого входа пароль должен быть изменен.

Если обновляется сервер, где когда-то был demo seed, сначала проверь пользователей:

```bash
cd /opt/newscast-web
docker compose --env-file .env -f compose.yaml exec backend python scripts/manage_users.py list
```

Если runtime отказался стартовать из-за unsafe users, используй one-off контейнер:

```bash
cd /opt/newscast-web
docker compose --env-file .env -f compose.yaml run --rm backend \
  python scripts/manage_users.py set-temp-password admin
docker compose --env-file .env -f compose.yaml run --rm backend \
  python scripts/manage_users.py deactivate editor
docker compose --env-file .env -f compose.yaml run --rm backend \
  python scripts/manage_users.py deactivate author
docker compose --env-file .env -f compose.yaml run --rm backend \
  python scripts/manage_users.py deactivate proofreader
docker compose --env-file .env -f compose.yaml up -d --build
```

Новые рабочие аккаунты дальше создаются через admin UI или через `scripts/import_staff_xlsx.py`. Реальные пароли, `.env`, сертификаты и TSV с временными паролями не коммитятся.

## Открытие публичного доступа

Перед сменой `NGINX_BIND_HOST=0.0.0.0` проверь:
- DNS `A`/`AAAA` записей указывает на production server;
- firewall/security group разрешает только нужные входы `80/tcp` и `443/tcp`;
- TLS certificate покрывает основной домен и `www`, если `www` используется;
- `CORS_ORIGINS` содержит только `https://<domain>`, опциональный `https://www.<domain>` и `null` для CaptionPanels;
- production users созданы, demo/default users отключены или исправлены;
- backup БД/storage/exports сделан перед rollout.

После этого:

```bash
cd /opt/newscast-web
sed -i 's/^NGINX_BIND_HOST=.*/NGINX_BIND_HOST=0.0.0.0/' .env
docker compose --env-file .env -f compose.yaml up -d --build
```

Если публичный TLS завершается внешним host-level reverse proxy вместо compose `edge`, оставь `NGINX_BIND_HOST=127.0.0.1`, проксируй внешний nginx/Caddy/Traefik на loopback endpoint и перенеси итоговый server config обратно в `deploy/` как source of truth.

## Day-2 обслуживание

Статус:

```bash
cd /opt/newscast-web
bash deploy/scripts/status_prod_stack.sh
```

Обновление:

```bash
cd /opt/newscast-web
bash deploy/scripts/update_prod_stack.sh
```

`status_prod_stack.sh` показывает:
- `systemd` status;
- `docker compose ps`;
- health endpoint.

`update_prod_stack.sh` делает:
- `git pull --ff-only`;
- `docker compose up -d --build`.

Каноническая server-схема:
- `/opt/newscast-web/compose.yaml`;
- `/opt/newscast-web/.env`;
- `/etc/newscast-web/newscast-web.env` содержит только:
  - `PROJECT_ROOT=/opt/newscast-web`;
  - `COMPOSE_FILE=/opt/newscast-web/compose.yaml`;
  - `COMPOSE_ENV_FILE=/opt/newscast-web/.env`.

## Production smoke после deploy

Минимальные проверки:

```bash
cd /opt/newscast-web
bash deploy/scripts/status_prod_stack.sh
```

```bash
curl -I http://<domain>/
curl -kfsS https://<domain>/api/health
curl -I https://<domain>/
```

Ожидаемо:
- HTTP возвращает redirect на HTTPS;
- `/api/health` отвечает успешно через HTTPS;
- в HTTPS response есть security headers, включая `Strict-Transport-Security`, `X-Content-Type-Options`, `Content-Security-Policy`;
- login работает только под реальным production account;
- `admin/admin123`, `editor/editor123`, `author/author123`, `proofreader/proof123` не дают доступ;
- admin UI показывает реальные users, demo-users отключены или отсутствуют;
- `CORS_ORIGINS` проверен с реальным origin и, если нужен CaptionPanels, с `Origin: null`;
- smoke по карточке сюжета выполнен по `docs/WEB_SMOKE_CHECKLIST_RU.md`.

## Backup и rollback

Каноническое место для новых backup'ов:
- `/opt/newscast-web/deploy/backups/`

Backup:

```bash
cd /opt/newscast-web
bash deploy/scripts/backup_db.sh
bash deploy/scripts/backup_storage.sh
bash deploy/scripts/backup_exports.sh
```

Restore:

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
