# Legacy Streamlit MVP

Здесь сохранена старая версия `Newscast Navigator` на `Streamlit + SQLite`.

Эта папка больше не считается основной архитектурой проекта. Она нужна для двух задач:
- как архив рабочей старой версии;
- как источник бизнес-логики для переноса в новый web-контур.

## Что здесь лежит

- `app.py` — старое Streamlit-приложение;
- `db.py`, `auth.py`, `permissions.py` — старая инфраструктура SQLite/MVP;
- `migrations/` — старые миграции;
- `scripts/` — старые утилиты работы с SQLite-данными и backup/restore;
- `data/`, `storage/`, `backups/` — локальные legacy-данные;
- `deploy/` — старые deploy-артефакты под Streamlit-контур.

## Если нужно поднять legacy локально

Работать надо из этой папки:

```bash
cd legacy/streamlit_mvp
python3 scripts/migrate_db.py
streamlit run app.py
```

## Важно

- Не развивать эту версию как основную.
- Новые изменения по умолчанию делать только в `backend/` и `frontend/`.
- Если нужно перенести поведение из legacy, переносить не старую архитектуру, а бизнес-логику.

