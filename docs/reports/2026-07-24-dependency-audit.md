---
type: report
status: historical
owner: development
audience: developers, agents
reviewed: 2026-09-30
---

# Исторический аудит зависимостей: 24 июля 2026

Результат перенесён при реорганизации документации 30 сентября. Источник:
`09d4c52f085f6961d88366b439408f8ba4dc3e45:docs/THIRD_PARTY_NOTICES.md`.
Ниже сохранены сведения и выводы того этапа. Новый аудит не выполнялся;
упомянутый открытый риск относится к историческому состоянию реестра.
Текущие требования к поставке — в [checklist](../operations/RELEASE_LICENSE_CHECKLIST_RU.md).

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

© 2026 Павел Курзыкин. Все права защищены.
