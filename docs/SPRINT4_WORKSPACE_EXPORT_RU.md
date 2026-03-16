# Sprint 4 — Файлы/Комментарии Проекта + Экспорт DOCX/PDF

Дата исходного спринта: 2026-02-17
Дата актуализации: 2026-03-16

Что добавлено:
- в `EDITOR` появился блок `Файлы и комментарии проекта` (это отдельная сущность проекта, не строки);
- сохранение параметров проекта:
  - `Путь к файлам проекта`,
  - `Комментарий проекта`;
- проектные комментарии:
  - добавить,
  - удалить;
- проектные файлы:
  - загрузить,
  - скачать,
  - удалить;
- экспорт проекта:
  - `DOCX`,
  - `PDF`.

## 1. Подготовка и запуск

Это исторический спринтовый чек-лист. Для dev-проверки используй текущий web-dev compose из корня репозитория:

```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml up -d --build
docker compose -f deploy/docker/docker-compose.web-dev.yml ps
```

Ожидаемо:
- `backend`, `frontend`, `db` — `Up`.

## 2. Миграции и health

```bash
# Если база уже была создана раньше через AUTO_CREATE_SCHEMA (до Alembic),
# сначала проставь текущую ревизию:
docker compose -f deploy/docker/docker-compose.web-dev.yml exec backend alembic stamp 20260216_0002

docker compose -f deploy/docker/docker-compose.web-dev.yml exec backend alembic upgrade head
curl -fsS http://127.0.0.1:8100/api/health && echo
```

Если `alembic current` показывает `20260217_0003`, но backend падает с ошибкой
`column projects.project_file_root does not exist`, значит ревизия была проставлена,
а SQL-изменения не применились. Восстановление:
```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml exec backend alembic stamp 20260216_0002
docker compose -f deploy/docker/docker-compose.web-dev.yml exec backend alembic upgrade head
docker compose -f deploy/docker/docker-compose.web-dev.yml exec db psql -U newscast -d newscast -c "SELECT column_name FROM information_schema.columns WHERE table_name='projects' AND column_name IN ('project_file_root','project_note') ORDER BY column_name;"
docker compose -f deploy/docker/docker-compose.web-dev.yml restart backend
```

## 3. API проверка (быстрый smoke test)

```bash
TOKEN=$(curl -sS -X POST http://127.0.0.1:8100/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

PROJECT_ID=$(curl -sS "http://127.0.0.1:8100/api/v1/projects?view=main" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["items"][0]["id"])')

curl -sS "http://127.0.0.1:8100/api/v1/projects/${PROJECT_ID}/workspace" \
  -H "Authorization: Bearer $TOKEN"
```

Проверка экспорта:
```bash
curl -fSs -o /tmp/newscast_test.docx \
  "http://127.0.0.1:8100/api/v1/projects/${PROJECT_ID}/export/docx" \
  -H "Authorization: Bearer $TOKEN"

curl -fSs -o /tmp/newscast_test.pdf \
  "http://127.0.0.1:8100/api/v1/projects/${PROJECT_ID}/export/pdf" \
  -H "Authorization: Bearer $TOKEN"

ls -lh /tmp/newscast_test.docx /tmp/newscast_test.pdf
```

Ожидаемо:
- оба файла созданы и имеют ненулевой размер.

## 4. UI проверка в браузере

Открыть:
- `http://127.0.0.1:5173`

Шаги:
1. Войти `admin / admin123`.
2. Открыть любой проект в `EDITOR`.
3. В блоке `Файлы и комментарии проекта`:
   - заполнить `Путь к файлам проекта`,
   - заполнить `Комментарий проекта`,
   - нажать `Сохранить параметры проекта`.
4. Добавить комментарий проекта.
5. Удалить комментарий проекта.
6. Выбрать файл и нажать `Загрузить файл`.
7. Нажать `Скачать` у загруженного файла.
8. Нажать `Удалить` у загруженного файла.
9. Нажать `Экспорт DOCX`.
10. Нажать `Экспорт PDF`.

Ожидаемо:
- все действия проходят без 500 ошибок;
- скачивание экспорта и файла работает;
- изменения после `Обновить` остаются.

## 5. Проверка ограничений архива

1. В `MAIN` отправить проект в архив.
2. Открыть его в `EDITOR` из `ARCHIVE`.

Ожидаемо:
- редактирование таблицы, workspace, комментариев и файлов отключено.

## 6. Если что-то не работает

```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml logs backend --tail=250
docker compose -f deploy/docker/docker-compose.web-dev.yml logs frontend --tail=250
```
