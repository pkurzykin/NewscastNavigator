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
- [x] CP1 evidence привязана к exact tested commit `ee8efc5b04ebe3672f71f0c6c287ee634d994910` после полного runner-owned boundary-run на его чистом checkout.
- [x] Post-binding docs-policy follow-up закрыл семь пропусков operations inventory; focused repository-policy/evaluator: `49 passed`, immutable `EVAL_RESULT.json` не изменялся.

### Проверенная commit-binding граница

- backend full suite: `154 passed`;
- frontend full component suite: `5 passed`;
- frontend production build: успешно;
- browser pair `editor-characterization.spec.ts` + `editor-autosave-known-failures.spec.ts`, `chromium-1366`: `5 passed`, включая две ожидаемые failure-классификации;
- root Compose: `docker compose --env-file .env.example -f compose.yaml config` — exit `0`;
- test Compose config и focused eval/repository-policy run: `48 passed`;
- checkpoint run записал exact commit `ee8efc5b04ebe3672f71f0c6c287ee634d994910` и вычислил `passed=true`, `missing=[]`;
- checkpoint verify CP1: exit `0`, `passed=true`, errors `[]`;
- final verify: ожидаемый exit `2`, единственная причина — `full_eval_passed=false`.

Перед runner-owned boundary-run удалены игнорируемые AppleDouble metadata, которые внешний том создал рядом с test-файлами. Test Compose services/volume после проверки удалены.

Hardening source намеренно не self-claim’ил CP1. Отдельный runner-owned binding-run после полной проверки записал `commit=ee8efc5b04ebe3672f71f0c6c287ee634d994910`, `checkpoint_results.CP1.evaluated_commit=ee8efc5b04ebe3672f71f0c6c287ee634d994910`, `checkpoint_results.CP1.passed=true`, `completed_checkpoints=["CP1"]`, `missing=[]`. Runtime-баги намеренно остаются неисправленными до CP3; `local_hard_gates_passed`, `hard_gates_passed` и `full_eval_passed` остаются `false`.

### CP1 reproducibility hardening — runner-owned boundary

- Playwright config запускает Vite `127.0.0.1:5173` через `webServer`; browser pair больше не требует вручную поднятого сервера.
- Expected-failure browser tests переходят в expected-failure режим только после положительных page/editor/status preconditions, поэтому infrastructure failure не считается воспроизведённым autosave-багом.
- Eval runner сам выполняет семь canonical CP1 commands и перезаписывает command evidence с hashes, count, summary и exact evaluated commit.
- Каждый checkpoint получает неизменяемый `checkpoint_results.<CP>.evaluated_commit`; CP1 command metadata, Git tree paths и runtime diff навсегда проверяются относительно CP1 commit, даже когда top-level `commit` продвинется к CP2/CP3.
- Clean-source guard учитывает tracked и nonignored untracked files; ignored artifacts не блокируют run.
- Evidence paths проверяются в дереве evaluated commit, чтобы последующее удаление CP1-only файлов в CP3 не делало final eval недостижимым.
- Runner на чистом source commit выполнил все семь canonical commands с exit `0`, записал их hashes/count/summary и подтвердил `CP1.evaluated_commit=ee8efc5b04ebe3672f71f0c6c287ee634d994910`. Историческая точная browser-мера воспроизведённой регрессии остаётся `103.03125px` против gate `<=1px`.

## CP2 — чистая схема и основной вертикальный срез

- [x] Commit 2.1: одна baseline migration `20260710_0001`, identity/bootstrap и actual synthetic demo seed.
- [x] Commit 2.2: реестр сюжетов, metadata permissions и адресная навигация.
- [x] Commit 2.3: ровно один временный `story_editor_compatibility_bridge`; legacy project runtime удален.
- [ ] Commit 2.4: template CP2 evidence и runner готовы; command evidence ожидает clean-source binding.

### Подготавливаемая CP2 граница

- baseline содержит единственную миграцию `backend/migrations/versions/20260710_0001_product_reset.py`;
- actual synthetic seed подтвержден с `8` пользователями, `30` активными и `5` архивными сюжетами;
- тест чистой схемы выполняет `alembic upgrade head` для пустой БД;
- допускается один logical bridge `story_editor_compatibility_bridge` с exact пятью временными paths до CP3;
- backend full suite: `197 passed, 2 skipped`; CP2 focused: `13 passed`; frontend production build: успешно — это входные результаты для runner-owned binding, а не принятые command records;
- CP2 runner канонически выполнит backend full suite, migration/seed/bridge/legacy-policy focused suite, `alembic upgrade head` и frontend production build на чистом source commit;
- до binding `checkpoint verify CP2` ожидаемо не проходит, final verify остаётся красным с exit `2`.

Browser runner в CP2 не дал принятого результата из-за проблемы с mounted-volume metadata. Это не записано как успешная browser-проверка и остаётся явным риском до CP3/CP7.

## Следующее действие

Сначала CP2 command evidence должна быть привязана runner-ом к чистому source commit. Только после успешного `checkpoint verify CP2` Checkpoint 3 реализует revision-safe сценарий, autosave и lease по утвержденному плану.
