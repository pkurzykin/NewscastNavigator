# Post-Cutover Stabilization

Дата актуализации: 2026-03-16

## Текущее состояние

После cutover:
- новый web-контур обслуживает публичный `:80`;
- legacy `newscast_nginx` и `newscast_app` остановлены, но сохранены как rollback-резерв;
- серверные dev-контуры удалены из runtime;
- рабочий deploy-путь теперь `/opt/newscast-web`.

## Что делаем сразу после cutover

1. Проверяем вход и основные сценарии руками.
2. Смотрим `docker compose ps` и `docker ps`.
3. Проверяем, что экспорт, editor и workspace работают на реальных данных.
4. Только после этого трогаем автозапуск и cleanup legacy.

## Установка systemd

На сервере, под пользователем с `sudo`:

```bash
cd /opt/newscast-web
sudo bash deploy/scripts/install_systemd_unit.sh
sudo systemctl status newscast-web-compose.service
```

Если нужно сразу проверить reload-path:

```bash
sudo systemctl restart newscast-web-compose.service
sudo systemctl status newscast-web-compose.service
```

## Что пока не удаляем

Пока новый production не отработает без сюрпризов хотя бы короткий период наблюдения, не удаляем:
- `/opt/newscast-navigator`
- остановленные `newscast_nginx` и `newscast_app`
- legacy backup-артефакты

## Следующий cleanup-этап

Когда systemd уже стоит и rollback больше не нужен как “горячий запас”, можно:
- удалить старые остановленные legacy-контейнеры;
- удалить старые dev volumes;
- архивировать или удалить `/opt/newscast-navigator-dev`;
- потом отдельно решить судьбу `/opt/newscast-navigator`.

## Базовые day-2 команды

В новом deploy-пути `/opt/newscast-web`:

```bash
bash deploy/scripts/status_prod_stack.sh
```

```bash
bash deploy/scripts/update_prod_stack.sh
```

Первая команда нужна для быстрой проверки состояния.
Вторая:
- тянет актуальный код из GitHub;
- прогоняет миграции;
- пересобирает и поднимает production-стек.
