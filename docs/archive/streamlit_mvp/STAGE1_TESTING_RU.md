# Этап 1 — Как тестировать и проверять (подробно)

Дата: 2026-02-15

## Цель этапа
Проверить, что:
- миграции БД запускаются,
- новые таблицы и колонки появились,
- старые данные не потерялись,
- текущее приложение продолжает работать.

## 0. Подготовка окружения (один раз)
Если `streamlit` еще не установлен на машине:

```bash
cd /Volumes/work/Projects/NewscastNavigator
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install streamlit bcrypt
```

Проверка:

```bash
python -c "import streamlit, bcrypt; print('ok')"
```

Ожидается: `ok`.

## 1. Проверка структуры проекта
В корне проекта выполните:

```bash
ls -la
```

Ожидаемо увидеть новые папки:
- `app/`
- `migrations/`
- `scripts/`
- `tests/`
- `docs/`

## 2. Резервная копия базы перед миграцией

```bash
cp -f data/app.db data/app.db.backup
```

Проверка:

```bash
ls -la data/
```

Должны быть оба файла: `app.db` и `app.db.backup`.

## 3. Запуск миграций

```bash
python3 scripts/migrate_db.py
```

Ожидаемый результат:
- сообщение `Database migrations applied successfully.`
- без ошибок в терминале.

Если запускаете миграции второй раз:
- ошибок быть не должно,
- дублирующихся таблиц/колонок появляться не должно.

## 4. Проверка схемы БД

```bash
python3 scripts/inspect_db.py
```

Проверьте, что есть таблицы:
- `users`
- `projects`
- `script_elements`
- `comments`
- `schema_migrations`
- `project_events`
- `project_files`

И что в `projects` есть новые поля:
- `rubric`
- `planned_duration`
- `source_project_id`
- `author_user_id`
- `executor_user_id`
- `proofreader_user_id`
- `is_archived`
- `archived_at`
- `archived_by`
- `status_changed_at`
- `status_changed_by`
- `file_root`

И что в `script_elements` есть новые поля:
- `block_type`
- `speaker_text`
- `file_name`
- `tc_in`
- `tc_out`
- `additional_comment`

## 5. Проверка, что старые данные не сломались
Если в БД уже были данные, откройте приложение и проверьте, что:
- логин работает,
- проекты видны,
- текст элементов читается и редактируется,
- комментарии добавляются.

## 6. Запуск приложения (smoke test)

```bash
streamlit run app.py
```

Что проверить руками:
- вход под тестовым пользователем,
- открытие существующего проекта,
- изменение текста элемента,
- добавление комментария,
- смена статуса проекта.

## 7. Что считать успешным завершением Этапа 1
Этап 1 принят, если одновременно выполнены условия:
- миграции запускаются без ошибок,
- схема БД расширена,
- старый функционал не деградировал,
- приложение стартует и работает.

## 8. Частые ошибки и что делать
- Ошибка `no such table schema_migrations`:
  - повторно запустить `python3 scripts/migrate_db.py`.
- Ошибка `ModuleNotFoundError` в служебных скриптах:
  - запускать скрипты из корня проекта.
- Ошибка доступа к файлу БД:
  - проверьте права на папку `data/`.
- Приложение не стартует после миграции:
  - верните бэкап `cp -f data/app.db.backup data/app.db` и зафиксируйте текст ошибки.
