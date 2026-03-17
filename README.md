# Newscast Navigator

Внутренний инструмент для подготовки телевизионных/новостных сюжетов.

Сейчас репозиторий уже приведен к `web-only` состоянию:
- основная и единственная рабочая архитектура: `backend + frontend + PostgreSQL + Docker`;
- production на домашнем сервере обслуживается из `/opt/newscast-web`;
- старый Streamlit-контур удален из `main` и из server runtime после безопасного cutover и backup.

## Что сейчас главное

- `backend/` — основной FastAPI backend новой web-версии.
- `frontend/` — основной React/Vite frontend новой web-версии.
- `deploy/` — production compose, nginx, systemd, backup/update scripts.
- `docs/` — актуальная документация по deploy, проверкам, миграции данных и сопровождению.

Исторический legacy-контур больше не лежит в рабочем дереве. Если потребуется восстановить старую логику или повторить импорт данных, источниками остаются git history, server backups и importer в `backend/scripts/import_legacy_sqlite.py`.

## Быстрый старт локально

Для clean bootstrap контейнерного production-стека:

```bash
cp .env.example .env
docker compose up -d --build
```

После старта:
- frontend/nginx: `http://127.0.0.1:8088`
- backend health: `http://127.0.0.1:8088/api/health`

Миграции применяются автоматически на старте backend через `python scripts/bootstrap_runtime.py`.

## Быстрый dev-цикл

Для повседневной разработки не используй production deploy. Основной режим на этом Mac сейчас такой:

```bash
bash deploy/scripts/dev_native_backend.sh
```

Во втором терминале:

```bash
bash deploy/scripts/dev_native_frontend.sh
```

Дальше:
- frontend: `http://127.0.0.1:5173`
- backend: `http://127.0.0.1:8100`

Docker `web-dev` остается как дополнительный режим, но не как основной ежедневный цикл.

Подробный workflow: `docs/LOCAL_DEV_WORKFLOW_RU.md`

### Backend

Требуется Python `3.11+`.

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python scripts/bootstrap_runtime.py
uvicorn app.main:app --reload --host 127.0.0.1 --port 8100
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

По умолчанию frontend работает на `http://127.0.0.1:5173`.

## Документация

- `docs/WEB_MIGRATION_PLAN_RU.md` — исходный архитектурный план и итог migration.
- `docs/WEB_PARITY_AUDIT_RU.md` — итоговая карта паритета между legacy и web.
- `docs/LOCAL_DEV_WORKFLOW_RU.md` — быстрый локальный dev-цикл без касания production.
- `docs/WEB_SMOKE_CHECKLIST_RU.md` — ручной smoke-check нового web-контура.
- `docs/REPOSITORY_CLEANUP_PLAN_RU.md` — фиксирует завершенный cleanup репозитория.
- `docs/DEPLOYMENT_UBUNTU_RU.md` — актуальная production-схема и порядок сопровождения.
- `docs/LEGACY_DATA_MIGRATION_RU.md` — runbook повторного импорта legacy-данных из внешнего backup.
- `docs/POST_CUTOVER_STABILIZATION_RU.md` — пост-cutover сопровождение и day-2 ops.
- `docs/README_RU.md` — индекс документации.

## Текущее направление работы

1. Развивать только web-контур без возврата к legacy.
2. Усиливать runtime-качество: тесты, auth, UX и наблюдаемость.
3. Поддерживать clean git-based deploy на домашнем сервере.
4. Не засорять `main` build-артефактами, временными данными и ручными server-фиксациями.
