# Сторонние зависимости

Список фиксирует весь Python runtime inventory, прямые development/npm
dependencies и bundled asset. Лицензии Python и npm совпадают с metadata
установленных exact lock entries; полные тексты и условия находятся в
дистрибутивах соответствующих пакетов. Версии Python закреплены в
`backend/requirements.lock` и `backend/requirements-dev.lock`, npm — в
`frontend/package-lock.json`.

## Python runtime, включая транзитивные пакеты

| Пакет | Экосистема | Лицензия | Назначение |
|---|---|---|---|
| `alembic` | Python | `MIT` | миграции PostgreSQL |
| `annotated-doc` | Python | `MIT` | metadata FastAPI |
| `annotated-types` | Python | `MIT` | типы Pydantic |
| `anyio` | Python | `MIT` | async runtime |
| `click` | Python | `BSD-3-Clause` | CLI Uvicorn |
| `fastapi` | Python | `MIT` | HTTP API |
| `greenlet` | Python | `MIT AND PSF-2.0` | SQLAlchemy runtime switching |
| `h11` | Python | `MIT` | HTTP protocol |
| `httptools` | Python | `MIT` | HTTP parser Uvicorn |
| `idna` | Python | `BSD-3-Clause` | internationalized domains |
| `lxml` | Python | `BSD-3-Clause` | OOXML parsing and generation for python-docx |
| `mako` | Python | `MIT` | Alembic templates |
| `markupsafe` | Python | `BSD-3-Clause` | safe Mako markup |
| `psycopg` | Python | `LGPL-3.0-only` | драйвер PostgreSQL |
| `psycopg-binary` | Python | `LGPL-3.0-only` | binary PostgreSQL implementation |
| `pydantic` | Python | `MIT` | API-схемы |
| `pydantic-core` | Python | `MIT` | Pydantic runtime |
| `pydantic-settings` | Python | `MIT` | конфигурация |
| `python-docx` | Python | `MIT` | in-memory DOCX export |
| `python-dotenv` | Python | `BSD-3-Clause` | env-file parsing |
| `pyyaml` | Python | `MIT` | YAML parser Uvicorn/tests |
| `sqlalchemy` | Python | `MIT` | ORM и SQL |
| `starlette` | Python | `BSD-3-Clause` | ASGI toolkit FastAPI |
| `typing-extensions` | Python | `PSF-2.0` | typing runtime |
| `typing-inspection` | Python | `MIT` | Pydantic typing inspection |
| `uvicorn` | Python | `BSD-3-Clause` | ASGI server |
| `uvloop` | Python | `MIT License` | Uvicorn event loop |
| `watchfiles` | Python | `MIT` | Uvicorn reload |
| `websockets` | Python | `BSD-3-Clause` | Uvicorn WebSocket runtime |

Runtime inventory: **29** packages.

## Python direct development tooling вне runtime inventory

| Пакет | Экосистема | Лицензия | Назначение |
|---|---|---|---|
| `httpx` | Python | `BSD-3-Clause` | API tests |
| `packaging` | Python | `Apache-2.0 OR BSD-2-Clause` | lock/specifier policy |
| `pip` | Python | `MIT` | pinned lock-generation installer |
| `pip-tools` | Python | `BSD` | воспроизводимая генерация locks |
| `pytest` | Python | `MIT` | test runner |
| `setuptools` | Python | `MIT` | pinned lock-generation build backend |

`pyyaml` также является прямым development input, но уже входит в runtime graph
через `uvicorn[standard]`; в общем Python inventory она учитывается один раз.
Полный автоматизированный Python inventory: **35** пакетов.

## Bundled asset

| Пакет | Экосистема | Лицензия | Назначение |
|---|---|---|---|
| `Onest` | Asset | `OFL-1.1` | локальный UI font: exact `Onest-VariableFont.woff2` и `OFL.txt` |

## npm runtime

| Пакет | Экосистема | Лицензия | Назначение |
|---|---|---|---|
| `@tiptap/extension-font-family` | npm | `MIT` | форматирование сценария |
| `@tiptap/extension-highlight` | npm | `MIT` | выделение текста |
| `@tiptap/extension-text-style` | npm | `MIT` | стили текста |
| `@tiptap/pm` | npm | `MIT` | ProseMirror runtime |
| `@tiptap/react` | npm | `MIT` | React bindings редактора |
| `@tiptap/starter-kit` | npm | `MIT` | базовые расширения редактора |
| `react` | npm | `MIT` | UI runtime |
| `react-dom` | npm | `MIT` | browser renderer |

## npm development

| Пакет | Экосистема | Лицензия | Назначение |
|---|---|---|---|
| `@axe-core/playwright` | npm | `MPL-2.0` | accessibility browser checks |
| `@playwright/test` | npm | `Apache-2.0` | browser tests |
| `@testing-library/dom` | npm | `MIT` | DOM assertions |
| `@testing-library/jest-dom` | npm | `MIT` | DOM matchers |
| `@testing-library/react` | npm | `MIT` | component tests |
| `@testing-library/user-event` | npm | `MIT` | user interaction tests |
| `@types/node` | npm | `MIT` | Node.js types |
| `@types/react` | npm | `MIT` | React types |
| `@types/react-dom` | npm | `MIT` | React DOM types |
| `@vitejs/plugin-react` | npm | `MIT` | React build integration |
| `jsdom` | npm | `MIT` | component test DOM |
| `typescript` | npm | `Apache-2.0` | type checker |
| `vite` | npm | `MIT` | frontend build |
| `vitest` | npm | `MIT` | component test runner |

Проверка:

```bash
cd backend
python scripts/check_dependency_licenses.py --repo-root ..
```

## npm audit на границе Commit 7.4

Проверка 24 июля 2026 года на clean `npm ci`:

- полный tree: `9` findings (`1 low`, `4 moderate`, `3 high`, `1 critical`);
- `npm audit --omit=dev`: `2` transitive findings (`1 moderate`, `1 high`);
- dev findings относятся к Vite/Vitest/Babel/PostCSS toolchain;
- runtime findings `markdown-it`/`linkify-it` приходят через
  `@tiptap/pm -> prosemirror-markdown`; приложение этот markdown module напрямую
  не импортирует.

Доступные fixes требуют major Vite/Vitest либо overrides за пределами
поддерживаемых transitive ranges. Автоматический `npm audit fix --force` не
применялся: такой переход требует отдельного test-first dependency checkpoint.
Production image содержит только собранные static assets, а Vite/Vitest servers
в demo runtime не запускаются. Риск остаётся в реестре до совместимого
обновления TipTap/toolchain.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
