# Post-Cutover Stabilization

Дата актуализации: 2026-03-16

## Текущее состояние

После cutover:
- новый web-контур обслуживает публичный `:80`;
- `systemd`-unit `newscast-web-compose.service` установлен и активен;
- legacy/dev runtime уже удален;
- рабочий deploy-путь теперь `/opt/newscast-web`.

## Что уже закрыто

- ручная проверка входа и основных сценариев;
- import legacy-данных и проверка на реальном наборе проектов;
- установка `systemd`;
- cleanup legacy runtime и старых server directories legacy/dev-контура.

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

## Что оставляем после cleanup

После завершенного cleanup сохраняем только:
- backup-артефакты в `/opt/newscast-web/deploy/backups/`;
- importer и migration runbook для возможного повторного импорта;
- git-based deploy путь `/opt/newscast-web`.

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
