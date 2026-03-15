# Sprint 2 — MAIN + Roles + Действия По Проектам

Дата: 2026-02-16

Что добавлено в новом web-контуре:
- role-based доступ к операциям;
- создание проекта (`пустой`);
- создание на основе `последнего`;
- создание на основе `выбранного`;
- отправка проекта в архив;
- возврат проекта из архива в MAIN;
- выбор проекта кликом по строке в таблице.

## 1. Подготовка и запуск

На Mac:
```bash
rsync -av \
  --exclude '.venv' \
  --exclude '__pycache__' \
  /Volumes/work/Projects/NewscastNavigator/ \
  wysiati@192.168.2.200:/opt/newscast-navigator-dev/
```

На сервере:
```bash
cd /opt/newscast-navigator-dev
docker compose -f deploy/docker/docker-compose.web-dev.yml up -d --build
docker compose -f deploy/docker/docker-compose.web-dev.yml ps
```

## 2. API проверка

```bash
curl -fsS http://127.0.0.1:8100/api/health && echo

TOKEN=$(curl -sS -X POST http://127.0.0.1:8100/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -sS http://127.0.0.1:8100/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
curl -sS "http://127.0.0.1:8100/api/v1/projects?view=main" -H "Authorization: Bearer $TOKEN"
```

Ожидаемо:
- health = `{"status":"ok"}`
- `/auth/me` возвращает `admin`.
- `/projects` возвращает список.

## 3. UI проверка в браузере

Открыть:
- `http://192.168.2.200:5173`

Шаги:
1. Войти `admin / admin123`.
2. Нажать `Создать новый (пустой)` — в таблице появляется новый проект.
3. Нажать `Создать из последнего` — появляется копия последнего проекта.
4. Кликнуть строку и нажать `Создать из выбранного` — появляется копия выбранного.
5. В режиме `MAIN` выделить проект и нажать `В архив` — проект исчезает из MAIN.
6. Переключить вид на `ARCHIVE` и убедиться, что проект там.
7. В `ARCHIVE` выделить проект и нажать `Вернуть в MAIN`.
8. Нажать `F5` — пользователь остается залогинен (сессия восстановлена).

## 4. Проверка ролей (минимум)

Есть демо-пользователи:
- `admin / admin123`
- `editor / editor123`
- `author / author123`

Проверить:
1. `author` может создавать проекты (3 кнопки создания).
2. `author` не может архивировать/возвращать (кнопки заблокированы).
3. `admin` и `editor` могут архивировать/возвращать.

## 5. Частые проблемы

Если backend не стартует:
```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml logs backend --tail=200
```

Если фронт видит белый экран:
```bash
docker compose -f deploy/docker/docker-compose.web-dev.yml logs frontend --tail=200
```
