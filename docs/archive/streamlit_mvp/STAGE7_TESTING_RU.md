# Этап 7 — Деплой и надежность: как тестировать и проверять

Дата: 2026-02-15

## Что проверяем
- запуск через Docker Compose,
- reverse proxy (Nginx),
- healthchecks,
- логи,
- backup/restore,
- устойчивость после рестарта.

## 0. Подготовка на Ubuntu сервере
Следуйте `docs/DEPLOYMENT_UBUNTU_RU.md`.

## 1. Запуск стека

```bash
cd /opt/newscast-navigator
docker compose build
docker compose up -d
docker compose ps
```

Ожидается:
- `newscast_app` в состоянии `healthy`,
- `newscast_nginx` в состоянии `Up`.

## 2. Проверка доступности

```bash
curl -fsS http://127.0.0.1/healthz
curl -fsS http://127.0.0.1/_stcore/health
```

Ожидается `ok` в обоих случаях.

## 3. Проверка web-интерфейса
Откройте в браузере адрес сервера:
- `http://<IP_или_домен>`

Проверьте:
- вход в систему,
- MAIN,
- text-editor,
- ARHIV,
- загрузка файла,
- экспорт.

## 4. Проверка логов

```bash
docker compose logs app --tail=200
docker compose logs nginx --tail=200
```

Ожидается:
- нет постоянных traceback/500,
- запросы идут через nginx.

## 5. Проверка backup

```bash
cd /opt/newscast-navigator
python3 scripts/backup_local_data.py
ls -la backups
```

Ожидается новая папка `backup_YYYYMMDD_HHMMSS`.

## 6. Проверка restore (без риска)

```bash
python3 scripts/restore_local_data.py --backup-dir backups/backup_YYYYMMDD_HHMMSS --mode test
ls -la restore_test
```

Ожидается новая папка тестового восстановления.

## 7. Проверка устойчивости после рестарта контейнеров

```bash
docker compose restart
docker compose ps
curl -fsS http://127.0.0.1/healthz
```

Ожидается:
- сервис снова доступен,
- данные на месте.

## 8. Проверка автозапуска (если включили systemd)

```bash
sudo systemctl status newscast-compose.service
```

Ожидается статус `active`.

## 9. Базовый тест на 10-15 пользователей
Минимально:
- откройте 5-7 браузерных сессий и поработайте одновременно (создание/редактирование/архивирование).
- следите за ошибками в `docker compose logs app`.

Для более формальной нагрузки позже можно добавить отдельный скрипт load-test.

## 10. Критерии приемки Этапа 7
Этап принят, если:
- деплой стабильно поднимается через compose,
- nginx проксирует без ошибок,
- healthchecks зеленые,
- backup/restore отрабатывают,
- после рестарта сервис не ломается.

