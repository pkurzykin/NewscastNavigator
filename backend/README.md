# Backend

FastAPI backend Product Reset. Python 3.11 и PostgreSQL 16 — канонический
runtime. SQLite допустим только как быстрый test double; обязательные database
gates используют `compose.test.yaml`.

## Установка

```bash
python3.11 -m venv .venv
./.venv/bin/python -m pip install --require-hashes -r requirements-dev.lock
```

`requirements.txt` и `requirements-dev.txt` — inputs для `pip-compile`.
`requirements.lock` используется runtime images, `requirements-dev.lock` — CI и
локальными тестами. После изменения input оба lock-файла пересобираются Python
3.11. Lock-generation toolchain закреплён как `pip==25.3`,
`setuptools==80.9.0`, `pip-tools==7.5.2` в development input/lock:

```bash
./.venv/bin/pip-compile --allow-unsafe --generate-hashes --no-emit-index-url \
  --no-emit-trusted-host --strip-extras \
  --output-file requirements.lock requirements.txt
./.venv/bin/pip-compile --allow-unsafe --generate-hashes --no-emit-index-url \
  --no-emit-trusted-host --strip-extras \
  --output-file requirements-dev.lock requirements.txt requirements-dev.txt
git diff --exit-code -- requirements.lock requirements-dev.lock
```

Для изменения dependencies сначала выполняются обе команды генерации и
коммитятся inputs вместе с locks. Проверка воспроизводимости выполняется
повторным запуском тех же двух команд в clean checkout зафиксированного commit;
только после него `git diff --exit-code` обязан вернуть `0`. Сразу после
намеренного изменения inputs ненулевой diff ожидаем и не является regeneration
check.

## Миграция и запуск

```bash
cp .env.example .env
./.venv/bin/alembic upgrade head
./.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8100
```

Backend проверяет migration head на старте. Первый начальник создаётся только
явной командой `scripts/bootstrap_admin.py` с `BOOTSTRAP_ADMIN_*`; пароль не
печатается. `scripts/seed_demo.py` создаёт только синтетические records и
запрещён в production.

## Модель

- один сюжет содержит один актуальный сценарий;
- autosave возвращает ack, а открытый editor остаётся local-authoritative;
- workflow и production меняются конкретными server-side commands;
- история показывает edit sessions, meaningful events и restore;
- CaptionPanels читает latest current scenario.

Адреса карточки: `/stories/:id/scenario`, `/stories/:id/production`,
`/stories/:id/history`.

## Проверка

```bash
./.venv/bin/pytest -q
./.venv/bin/python -m compileall app migrations scripts
./.venv/bin/python -m pip check
./.venv/bin/python scripts/check_dependency_licenses.py --repo-root ..
```

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
