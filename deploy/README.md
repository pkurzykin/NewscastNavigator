# Deploy

Папка `deploy/` относится к новой web-архитектуре, но пока еще не полностью доведена до production-ready состояния.

## Что использовать сейчас

- `docker/docker-compose.web-dev.yml` — основной dev-compose для нового web-контура.

## Что пока считать подготовительным слоем

- `nginx/` — папка под будущий web reverse proxy.
- `systemd/` — папка под будущие web service units.

Legacy deploy-файлы Streamlit уже вынесены в:
- `legacy/streamlit_mvp/deploy/`

## Важно

- На домашнем сервере уже работает какая-то версия проекта.
- Поэтому `deploy/` нельзя применять к серверу вслепую.
- Перед production deploy нужен отдельный аудит: текущий compose, контейнеры, volumes, база, storage, nginx и backup.
