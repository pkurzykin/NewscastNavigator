# Legacy Data Migration

Дата актуализации: 2026-03-16

## Зачем нужен этот документ

Новый production-контур теперь поднимается отдельно в `/opt/newscast-web`, но рабочие данные все еще живут в legacy Streamlit-контуре.

Перенос делаем только по безопасной схеме:
- сначала backup legacy и нового web-контура;
- затем import в новый web-контур;
- потом ручная проверка;
- и только после этого будущий cutover.

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

Типовой запуск внутри нового production-контура:

```bash
docker compose --env-file deploy/env/web-prod.env -f deploy/docker/docker-compose.web-prod.yml run --rm \
  -v /opt/newscast-navigator/data:/legacy/data:ro \
  -v /opt/newscast-navigator/storage:/legacy/storage:ro \
  backend \
  python scripts/import_legacy_sqlite.py \
    --sqlite-path /legacy/data/app.db \
    --legacy-storage-root /legacy/storage
```

## Ограничения безопасности

По умолчанию importer:
- требует пустую target DB;
- не трогает legacy SQLite;
- не удаляет legacy storage;
- переносит данные в новый web-контур как отдельную копию.

Если target DB уже не пустая, importer остановится с ошибкой.

## Порядок запуска на сервере

1. Сделать backup legacy SQLite и legacy storage.
2. Сделать backup новой Postgres и нового web storage.
3. Проверить, что новый web-контур запущен и миграции применены.
4. Запустить importer.
5. Проверить логины, список проектов, editor/workspace, историю и экспорт.
6. Только после этого планировать cutover.
