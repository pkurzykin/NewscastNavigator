# Сторонние зависимости

Список фиксирует прямые зависимости текущего репозитория и заявленные авторами
лицензии. Полные тексты и условия находятся в дистрибутивах соответствующих
пакетов. Транзитивные версии Python закреплены в `backend/requirements.lock` и
`backend/requirements-dev.lock`, npm — в `frontend/package-lock.json`.

## Python runtime

| Пакет | Экосистема | Лицензия | Назначение |
|---|---|---|---|
| `alembic` | Python | `MIT` | миграции PostgreSQL |
| `fastapi` | Python | `MIT` | HTTP API |
| `psycopg` | Python | `LGPL-3.0-only` | драйвер PostgreSQL |
| `pydantic` | Python | `MIT` | API-схемы |
| `pydantic-settings` | Python | `MIT` | конфигурация |
| `sqlalchemy` | Python | `MIT` | ORM и SQL |
| `uvicorn` | Python | `BSD-3-Clause` | ASGI server |

## Python development

| Пакет | Экосистема | Лицензия | Назначение |
|---|---|---|---|
| `httpx` | Python | `BSD-3-Clause` | API tests |
| `pytest` | Python | `MIT` | test runner |
| `pyyaml` | Python | `MIT` | проверка Compose/CI contracts |

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
