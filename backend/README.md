# Backend

FastAPI backend NewscastNavigator. Python 3.11 и PostgreSQL 16 — канонический
runtime. SQLite допустим только как быстрый test double; обязательные database
gates используют `compose.test.yaml`.

Рабочий каталог команд ниже — `backend/`. Общие [правила разработки](../docs/engineering/DEVELOPMENT_RU.md)
и [локальный Compose](../docs/engineering/LOCAL_DEV_WORKFLOW_RU.md) описаны в документации.

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

## Контракты

Поведение данных и API описывают [архитектура](../docs/engineering/ARCHITECTURE_RU.md)
и [контракт CaptionPanels](../docs/engineering/CAPTIONPANELS_CONTRACT_RU.md).
Правила продукта — в [спецификации](../docs/product/SPEC_RU.md).

## Проверка

```bash
./.venv/bin/pytest -q
./.venv/bin/python -m compileall app migrations scripts
./.venv/bin/python -m pip check
./.venv/bin/python scripts/check_dependency_licenses.py --repo-root ..
```

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
