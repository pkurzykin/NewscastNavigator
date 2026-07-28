# Final fix: semantic history and notification comparison

Дата: 2026-07-28
Ветка: `feat/product-reset`
Граница: только локальная рабочая копия; push, PR, merge и deploy не выполнялись.

## Изменения

- Backend history notification route использует сохранённый diff конкретного
  notification и передаёт exact notification deep link.
- Semantic diff строит block-aware projection видимых полей: тип, гео, СНХ
  (включая пустое ФИО и отдельную должность), текст, file bundle и `В кадре`.
  Raw structured payload, HTML и неизвестные типы не отображаются.
- TipTap runs безопасно проецируются в React text spans; font/fill разрешены
  только allowlist. Форматированные runs сохраняют leading/trailing spaces и
  пустой первый paragraph.
- Notification comparison всегда вытесняет обычную metadata с тем же session
  id, независимо от порядка групп; regression test использует разные summary.
- UI, component и Playwright contracts покрывают notification tray, историю,
  deep link, direct URL и видимые semantic fields.

## Проверки

- Mutation RED backend: подмена `notification` на `session` дала ожидаемый
  `1 failed, 9 deselected`; после восстановления focused test зелёный.
- Mutation RED frontend: пустой font allowlist дал `2 failed, 11 passed`;
  после восстановления focused semantic/history tests: `2 files / 29 passed`.
- Backend full: `848 passed, 2 skipped`.
- Frontend full: `20 files / 152 passed`.
- Typecheck и safe build: exit `0`, `158 modules transformed`.
- Targeted Playwright на изолированном `5174`: `8 passed (1.9m)`.
- Full Playwright на `5174`: `54 passed, 2 skipped (12.6m)`; skips относятся
  к capability BFCache.

## Review и границы

- Независимый reviewer нашёл два Important случая (edge spaces и duplicate
  notification metadata); оба исправлены и защищены регрессиями.
- CodeRabbit 0.7.0 был аутентифицирован. После исправления некорректного
  `-t staged` корректный uncommitted review дважды ждал 10 минут без результата
  и был остановлен по bounded retry. Это не выдаётся за review без findings.
- Обычный `npm run build` проходит TypeScript и transform, но завершает
  очистку `dist` с `Resource busy` на существующем `.smbdelete*`; busy-файлы
  не удалялись. Использован безопасный `--emptyOutDir false`.
- Временный Playwright config удалён. SSH listener `5173`, external evidence,
  in-app Browser и занятые SMB-артефакты не менялись.

## Локальные commits

- `bf4a95a` — `fix(history): preserve semantic notification comparisons`.
- Следующий documentation commit содержит этот отчёт.
