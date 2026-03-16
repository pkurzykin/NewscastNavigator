# Legacy Data Migration

Дата актуализации: 2026-03-16

## Зачем нужен этот документ

Основной перенос legacy-данных уже выполнен, а production работает на новом web-контуре.

Этот документ теперь нужен как recovery/runbook:
- для повторного импорта из внешнего legacy-backup;
- для восстановления staging/тестовой среды;
- для disaster recovery в чистую web-базу.

Текущий production deploy path:
- `/opt/newscast-web`

Legacy server directories уже удалены после cutover.
Источником старых данных теперь считаются backup-артефакты, а не живой legacy-контур.

## Что переносим

Из legacy SQLite переносится:
- `users`
- `projects`
- `script_elements`
- `comments`
- `project_files`
- `project_events`

Особенности:
- legacy `bcrypt`-пароли сохраняются и принимаются новым backend;
- при первом успешном логине такой пароль автоматически перехешируется в новый `pbkdf2_sha256`;
- legacy `topic`, которого нет в новом schema, сохраняется в `project_note` как `Legacy topic: ...`;
- если в legacy-комментариях нет `project_id`, он восстанавливается через `element_id`;
- если в `project_files` есть файлы на диске, importer может скопировать их в новый `storage`.

## Команда импорта

Importer живет в:
- `backend/scripts/import_legacy_sqlite.py`

Типовой запуск внутри нового production-контура из внешнего каталога с распакованным legacy-backup:

```bash
docker compose --env-file deploy/env/web-prod.env -f deploy/docker/docker-compose.web-prod.yml run --rm \
  -v /srv/legacy-import/data:/legacy/data:ro \
  -v /srv/legacy-import/storage:/legacy/storage:ro \
  backend \
  python scripts/import_legacy_sqlite.py \
    --sqlite-path /legacy/data/app.db \
    --legacy-storage-root /legacy/storage
```

## Ограничения безопасности

По умолчанию importer:
- требует пустую target DB;
- не трогает legacy SQLite или внешний backup;
- не удаляет legacy storage;
- переносит данные в новый web-контур как отдельную копию.

Если target DB уже не пустая, importer остановится с ошибкой.

## Порядок повторного запуска

1. Подготовить внешний каталог с legacy SQLite и legacy storage из backup.
2. Сделать backup новой Postgres и нового web storage.
3. Проверить, что новый web-контур запущен и миграции применены.
4. Запустить importer.
5. Проверить логины, список проектов, editor/workspace, историю и экспорт.
6. Только после этого переключать пользователей на восстановленную среду.

## Где искать legacy-backups

На production-сервере legacy backup'и лежат под:
- `/opt/newscast-web/deploy/backups/legacy/`

Их нужно сначала распаковать во внешний временный каталог, а потом уже монтировать в importer.
