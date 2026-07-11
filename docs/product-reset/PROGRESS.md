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
- [ ] CP1 evidence ещё не привязана к exact tested commit: binding выполняется только после полного boundary-run на чистом amended Commit 1.5.

### Последний preflight и обязательная commit-binding граница

- backend full suite: `123 passed`;
- frontend full component suite: `5 passed`;
- frontend production build: успешно;
- browser pair `editor-characterization.spec.ts` + `editor-autosave-known-failures.spec.ts`, `chromium-1366`: `5 passed`, включая две ожидаемые failure-классификации;
- root Compose: `docker compose --env-file .env.example -f compose.yaml config` — exit `0`;
- test Compose config и focused eval/repository-policy run: `17 passed`;
- checkpoint run/verify и новый Git binding должны быть повторены на чистом amended Commit 1.5;
- final verify и после binding обязан вернуть exit `2`, пока не завершены остальные checkpoints и `EXT-DEMO`.

Перед повторным frontend-run удалены игнорируемые AppleDouble metadata, которые внешний том создал рядом с test-файлом. Test Compose services/volume после проверки удалены.

Текущий amended Commit 1.5 намеренно не объявляет CP1 завершённым: `checkpoint_results.CP1.passed=false`, `completed_checkpoints=[]`, `missing=["evidence_commit_binding"]`. Поле `commit` означает проверенный committed source tree и до отдельного binding-run остаётся `null`. Runtime-баги намеренно остаются неисправленными до CP3; `local_hard_gates_passed`, `hard_gates_passed` и `full_eval_passed` остаются `false`.

## Следующее действие

Выполнить полный CP1 boundary на чистом amended Commit 1.5, привязать evidence через eval runner и записать отдельный binding commit. Checkpoint 2 в рамках этой работы не начинается.
