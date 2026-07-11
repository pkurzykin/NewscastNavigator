# NewscastNavigator Product Reset — прогресс

Статус: реализация начата в отдельном worktree `NewscastNavigator-product-reset`, ветка `feat/product-reset`.

## Зафиксированные базы

- `ANALYZED_PRODUCT_BASE_SHA=5129e0bd19976bbf74ab01aeda9c29663cf152da`
- `IMPLEMENTATION_BASE_SHA=a540e47704b26afc02272e6c05e311f48b894f85`
- Между базами добавлен только утверждённый `docs/product-reset/IMPLEMENTATION_PLAN_RU.md`.

## Исходная проверка

До Commit 1.1 зафиксировано состояние прототипа:

- backend: `64 passed` после удаления игнорируемых AppleDouble metadata;
- frontend: production build проходит;
- root Compose: конфигурация валидна только с `--env-file .env.example`;
- рабочая архитектура: web-only React + FastAPI + PostgreSQL + Docker;
- runtime редактора сценария и CaptionPanels в Commit 1.1 не изменяются.

Эти результаты являются исходной базой, а не подтверждением готовности Product Reset.

## CP1

### Commit 1.1 — eval и изолированный test skeleton

- [x] Разделены checkpoint и final verification.
- [x] Базовые SHA обязательны в машиночитаемом eval.
- [x] `full_eval_passed` вычисляется и не принимается как ручной флаг.
- [x] Добавлен изолированный PostgreSQL test Compose.
- [x] Созданы ранние architecture/operations inventories, risk register и phased denylist.
- [x] CI запускает focused eval/repository-policy tests через test Compose.
- [ ] Frontend component/browser harness — Commit 1.2.
- [ ] Characterization и known-failure autosave tests — Commit 1.3.
- [ ] Synthetic seed contract — Commit 1.4.
- [ ] Полная CP1 evidence boundary — Commit 1.5.

Final verification намеренно остаётся красной до завершения всех локальных hard gates и разрешённого `EXT-DEMO`.

## Следующее действие

Commit 1.2 по утверждённому file-level plan. Самостоятельно он не начинается в рамках Commit 1.1.
