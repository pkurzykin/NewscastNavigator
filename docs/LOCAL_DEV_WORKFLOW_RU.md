# Локальная разработка

## Канонический путь

```bash
cp .env.example .env
docker compose --env-file .env -f compose.yaml up --build --wait
```

- frontend: `http://127.0.0.1:5173`;
- backend: `http://127.0.0.1:8100`;
- health: `http://127.0.0.1:8100/api/health`;
- PostgreSQL: loopback port `5433` по умолчанию.

Остановка:

```bash
docker compose --env-file .env -f compose.yaml down
```

`down -v` удаляет локальные данные и используется только осознанно.

## Native test tools

```bash
cd backend
python3.11 -m venv .venv
./.venv/bin/python -m pip install --require-hashes -r requirements-dev.lock
./.venv/bin/pytest -q

cd ../frontend
npm ci
npm test -- --run
npm run build
```

Для изменения Python dependencies редактируются input-файлы, затем оба locks
генерируются Python 3.11 через `pip-compile` с `--generate-hashes`. Точные
команды и обязательный `git diff --exit-code` regeneration check приведены в
`backend/README.md`. Ручное редактирование lock-файлов запрещено.

## Перед commit

```bash
git status --short
git diff --check
```

Browser tests запускаются на Chromium `1366×768` и `1920×1080`. Фактический UI
проверяется отдельно от build. Артефакты остаются в
`artifacts/product-reset/` и не коммитятся.

Один сюжет — один актуальный сценарий.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
