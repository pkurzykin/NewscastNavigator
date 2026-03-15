# Newscast Navigator

Внутренний инструмент для подготовки телевизионных/новостных сюжетов.

Сейчас проект находится в состоянии управляемой миграции:
- целевая версия: `backend + frontend + PostgreSQL + Docker`;
- старая версия на Streamlit вынесена в `legacy/streamlit_mvp/` и больше не считается основной архитектурой;
- перед любыми изменениями на домашнем сервере нужен отдельный аудит, потому что там уже запущена какая-то рабочая версия проекта.

## Что сейчас главное

- `backend/` — основной FastAPI backend новой web-версии.
- `frontend/` — основной React/Vite frontend новой web-версии.
- `deploy/` — инфраструктурные файлы для будущего web-deploy.
- `docs/` — актуальная документация по миграции, проверкам и cleanup.

## Что пока legacy

Старая Streamlit-версия теперь лежит в отдельной папке:
- `legacy/streamlit_mvp/`

Там сохранены:
- старый код приложения;
- старая SQLite-база и локальные данные;
- старые миграции и вспомогательные скрипты;
- старые deploy-артефакты.

Этот слой сохраняется как источник логики для переноса и как архив, но не как целевая архитектура.

## Быстрый старт локально

### Backend

Требуется Python `3.11+`.

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8100
```

API health:

```bash
curl http://127.0.0.1:8100/api/health
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

По умолчанию frontend работает на `http://localhost:5173`.

## Документация

- `docs/WEB_MIGRATION_PLAN_RU.md` — основной план переезда.
- `docs/WEB_PARITY_AUDIT_RU.md` — карта паритета между legacy и web.
- `docs/REPOSITORY_CLEANUP_PLAN_RU.md` — план очистки репозитория.
- `docs/README_RU.md` — индекс документации.

## Текущее направление работы

1. Довести новый web-контур до полного рабочего состояния.
2. Почистить репозиторий и явно отделить `legacy`.
3. Подготовить нормальную основу под GitHub.
4. Только после этого аккуратно разбираться с домашним сервером и production deploy.
