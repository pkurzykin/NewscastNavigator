# NewscastNavigator

Внутреннее desktop-only веб-приложение телередакции.

> Один сюжет — один актуальный сценарий — одна понятная цепочка работы.

Приложение показывает общую очередь сюжетов, персональные действия и карточку
сюжета с тремя вкладками: «Сценарий», «Производство», «История». Проверка и
корректура — workflow-отметки над одним актуальным текстом. CaptionPanels при
каждом открытии получает этот актуальный сценарий.

## Стек и структура

- `backend/` — FastAPI, SQLAlchemy, Alembic, PostgreSQL;
- `frontend/` — React, TypeScript, Vite, TipTap;
- `compose.yaml` — единственный канонический local Compose;
- `deploy/home-test/compose.yaml` — постоянный домашний тестовый контур;
- `deploy/hostland/` — production на VDS и recovery;
- `deploy/compose.demo.yaml` — изолированный demo/rehearsal;
- `compose.test.yaml` — изолированный PostgreSQL test harness;
- `docs/` — текущие требования, runbooks и явно обозначенная история.

## Основной рабочий процесс

Изменения выполняются в отдельной ветке, проверяются на постоянном домашнем
LAN-only HTTPS-сервере и выпускаются на VDS после отдельного согласования.
Приложение на MacBook для обычной интеграционной проверки поднимать не нужно.
Начало задачи: [PROJECT_STATE_RU.md](docs/PROJECT_STATE_RU.md).
[Домашний контур](docs/HOME_TEST_WORKFLOW_RU.md) ·
[Выпуск релиза](docs/RELEASE_WORKFLOW_RU.md) ·
[Проектные агенты](docs/PROJECT_AGENTS_RU.md).

## Изолированный локальный запуск

```bash
cp .env.example .env
docker compose --env-file .env -f compose.yaml up --build --wait
```

Интерфейс: `http://127.0.0.1:5173`. Backend health:
`http://127.0.0.1:8100/api/health`.

Первый начальник создаётся явной командой, без default credentials:

```bash
docker compose --env-file .env -f compose.yaml exec \
  -e BOOTSTRAP_ADMIN_USERNAME \
  -e BOOTSTRAP_ADMIN_DISPLAY_NAME \
  -e BOOTSTRAP_ADMIN_POSITION \
  -e BOOTSTRAP_ADMIN_PASSWORD \
  backend python scripts/bootstrap_admin.py
```

Переменные `BOOTSTRAP_ADMIN_*` передаются через локальное окружение и не
коммитятся. Синтетический seed запускается отдельно:

```bash
docker compose --env-file .env -f compose.yaml exec backend \
  python scripts/seed_demo.py
```

## Зависимости и проверки

Python 3.11 зависимости воспроизводимо закреплены с hashes:

- runtime — `backend/requirements.lock`;
- runtime + tests — `backend/requirements-dev.lock`.

npm использует `frontend/package-lock.json`. Базовые проверки:

```bash
cd backend
python -m pip install --require-hashes -r requirements-dev.lock
pytest -q
python -m compileall app migrations scripts
python -m pip check
python scripts/check_dependency_licenses.py --repo-root ..

cd ../frontend
npm ci
npm test -- --run
npm run build

cd ..
docker compose --env-file .env.example -f compose.yaml config
docker compose -f compose.test.yaml config
docker compose --env-file deploy/env/demo.env.example \
  -f deploy/compose.demo.yaml config
```

## Документация

- [Спецификация продукта](docs/product/SPEC_RU.md) — действующая модель;
- [Критерии готовности](docs/product/EVAL_RUBRIC_RU.md) — проверки качества;
- `docs/ARCHITECTURE_RU.md` — текущая техническая архитектура;
- `docs/CAPTIONPANELS_CONTRACT_RU.md` — действующий integration contract;
- `docs/LOCAL_DEV_WORKFLOW_RU.md` — разработка и тесты;
- `docs/DEPLOYMENT_UBUNTU_RU.md` — demo deploy;
- `docs/product-reset/DEMO_RUNBOOK_RU.md` — permission-gated demo;
- [Навигация по документации](docs/README_RU.md) — актуальные документы и история;
- `docs/THIRD_PARTY_NOTICES.md` — прямые сторонние зависимости.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
