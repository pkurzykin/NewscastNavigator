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

## CP1 — страховочная база

- [x] Commit 1.1: eval/repository-policy skeleton и изолированный PostgreSQL test Compose.
- [x] Commit 1.2: Vitest/Testing Library и Playwright harness с проектами `chromium-1366` и `chromium-1920`.
- [x] Commit 1.3: backend/frontend/browser characterization редактора и CaptionPanels.
- [x] Commit 1.3: обе autosave-регрессии воспроизводятся как детерминированные expected failures: stale response удаляет суффикс свежего ввода; ширина save-status меняется на `103.03125px` при gate `<=1px`.
- [x] Commit 1.4: synthetic fixture contract и reusable validator без runtime seed.
- [x] Commit 1.5: добавлены production-валидация CP1 evidence, проверка Git objects/ancestry/runtime diff и структурированные command records.
- [x] CP1 evidence привязана к exact tested commit `22a839cb0a07119354b4bf56ac19ded0fe0d9ce5` после полного boundary-run на его чистом checkout.

### Проверенная commit-binding граница

- backend full suite: `123 passed`;
- frontend full component suite: `5 passed`;
- frontend production build: успешно;
- browser pair `editor-characterization.spec.ts` + `editor-autosave-known-failures.spec.ts`, `chromium-1366`: `5 passed`, включая две ожидаемые failure-классификации;
- root Compose: `docker compose --env-file .env.example -f compose.yaml config` — exit `0`;
- test Compose config и focused eval/repository-policy run: `17 passed`;
- checkpoint run записал exact commit `22a839cb0a07119354b4bf56ac19ded0fe0d9ce5` и вычислил `passed=true`, `missing=[]`;
- checkpoint verify CP1: exit `0`, `passed=true`, errors `[]`;
- final verify: ожидаемый exit `2`, единственная причина — `full_eval_passed=false`.

Перед повторным frontend-run удалены игнорируемые AppleDouble metadata, которые внешний том создал рядом с test-файлом. Test Compose services/volume после проверки удалены.

Amended Commit 1.5 намеренно не self-claim’ил CP1. Отдельный binding-run после полной проверки записал `commit=22a839cb0a07119354b4bf56ac19ded0fe0d9ce5`, `checkpoint_results.CP1.passed=true`, `completed_checkpoints=["CP1"]`, `missing=[]`. Runtime-баги намеренно остаются неисправленными до CP3; `local_hard_gates_passed`, `hard_gates_passed` и `full_eval_passed` остаются `false`.

## Следующее действие

Checkpoint 2 по утверждённому file-level plan. Он не начинается в рамках Commit 1.5 и binding commit.
