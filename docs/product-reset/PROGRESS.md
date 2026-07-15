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
- [x] Commit 2.4: runner-owned CP2 evidence привязан к clean source `60c8f6721bcd3053c11fa2eb2316c8d8e94616fa`; `checkpoint verify CP2` проходит.

### Проверенная CP2 граница

- baseline содержит единственную миграцию `backend/migrations/versions/20260710_0001_product_reset.py`;
- actual synthetic seed подтвержден с `8` пользователями, `30` активными и `5` архивными сюжетами;
- тест чистой схемы выполняет `alembic upgrade head` для пустой БД;
- допускается один logical bridge `story_editor_compatibility_bridge` с exact пятью временными paths до CP3;
- CP2 runner на чистом source commit выполнил backend full suite: `202 passed`; migration/seed/bridge/legacy-policy focused suite: `56 passed`; чистый `alembic upgrade head`: exit `0`; frontend production build: exit `0`;
- каждый command record содержит exact команду, exit code, count, duration и hashes вывода; `checkpoint verify CP2` проходит;
- независимое повторное ревью полного CP2 range, включая immutable binding и historical bridge denylist, принято без замечаний;
- `final verify` ожидаемо остаётся красным с exit `2`: завершены только CP1 и CP2, а CP3–CP7 и `external_demo` ещё не реализованы.

Browser runner в CP2 не дал принятого результата из-за проблемы с mounted-volume metadata. Это не записано как успешная browser-проверка и остаётся явным риском до CP3/CP7.

## CP3 — сценарий, autosave, lease и session history

- [x] Commit 3.1: revision-safe ack-only backend, client-generated `seg_<UUID>`, 90-second owner lease, immutable revision snapshots и idempotent retry.
- [x] Commit 3.1: независимое ревью принято после трёх correction-коммитов; targeted backend: `17 passed`, полный backend: `209 passed, 2 skipped`, frontend production build: успешно.
- [x] Commit 3.2: local-authoritative single-flight autosave, final scenario UI и удаление CP2 bridge.
- [x] Commit 3.3: edit-session history, persisted semantic diff, opaque pagination и append-only restore.
- [x] Commit 3.4: CaptionPanels всегда экспортирует latest accepted scenario, фиксирует per-user revision открытия и показывает server-derived diff status без фонового обновления After Effects.

### Проверенная граница Commit 3.2

- открытый редактор остаётся локальным source of truth: ack-only ответ не подменяет rows, один save находится in-flight, а очередь хранит только последний snapshot;
- stable `seg_<UUID>` создаётся до первого сохранения; draft остаётся локально при ошибке, повторяется при `online`, а dirty state защищён `beforeunload`;
- обычный save тихий первые `2000ms`; status container имеет фиксированное место в layout;
- пять CP2 bridge-файлов и заменённые legacy services/tests удалены; old editor GET/PUT возвращают `404`, runtime denylist больше не имеет временных разрешений;
- focused backend: `19 passed`; full backend: `210 passed, 2 skipped`; frontend full component suite на bundled Node 24: `12 passed`; production build: успешно; root Compose config с `--env-file .env.example`: exit `0`;
- real-browser `scenario-autosave.spec.ts` с настоящим Tiptap на `1366` и `1920`: `4 passed`; input, добавленный во время in-flight ack, сохранён;
- independent review диапазона `7cff4f1..b17a473` принял Commit 3.2 без функциональных замечаний.

Local Node `25.7.0` зависает на jsdom/Tiptap component import graph; воспроизводимый component run выполнен bundled Node `24.14.0`. Test-local editor double ограничен component-контрактом; реальный Tiptap проверен Playwright.

### Проверенная граница Commit 3.3

- много autosaves группируются в один завершённый edit-session; no-op session скрывается, а intermediate snapshot rows компактизируются с сохранением idempotent retry hashes;
- persisted diff сопоставляет строки по стабильному `segment_uid`, не считает сдвиг от вставки перемещением и явно показывает added/removed/changed/moved с полными snapshot-полями;
- leadership restore создаёт новую актуальную revision и сохраняет последующую историю; архивные сюжеты не предлагают недоступное restore-действие;
- единый lock order `Scenario FOR UPDATE -> ScenarioEditSession FOR UPDATE` и persisted finalization истёкшей lease закреплены regression-тестами и PostgreSQL-dialect SQL contract;
- history UI получает права только из `available_actions`, не импортирует Tiptap, удерживает/возвращает modal focus, показывает retry для initial error и адресно загружает opaque-cursor страницы;
- полный backend после backend correction: `222 passed, 2 skipped`; финальный frontend component run: `21 passed`; production build: успешно;
- initial CP3.3 browser pair `scenario-autosave.spec.ts` + `story-history.spec.ts` на `chromium-1366`: `3 passed`; после финальных frontend corrections `story-history.spec.ts`: `1 passed`;
- реальный локальный FastAPI + synthetic SQLite проверен встроенным Chromium до review-corrections: semantic diff, modal focus, append-only restore `3 -> 4`, отсутствие console errors и горизонтального overflow на `390x844`;
- independent review полного диапазона `9fa7417..e2ccb73` принят после трёх correction rounds без оставшихся findings.

Финальный component gate выполнен системным Node `25.7.0` с `NODE_OPTIONS=--no-experimental-webstorage`: bundled Node `24.14.0` в последнем повторе не загрузил Rollup native binary из-за macOS code-signature Team ID на external volume. In-app Browser в финальном fix-subagent процессе не обнаружил browser binding; документированный standalone Playwright fallback прошёл. Эти ограничения не объявлены успешной проверкой отсутствующего контура и остаются явной средовой оговоркой до CP3/CP7 boundary.

### Проверенная граница Commit 3.4

- CaptionPanels import сохраняет прежнюю JSON-форму и стабильные `story_<id>` / segment IDs, но берёт rows только из текущего сценария под scenario lock и после успешной валидации фиксирует exact exported revision для текущего пользователя;
- `POST /api/v1/stories/{id}/scenario/opened` принимает только `scenario|video|titles|captionpanels`, проверяет принадлежность revision технической истории и upsert-ит per-user/per-context marker;
- scenario read model возвращает server-derived CaptionPanels state и latest completed non-noop diff-session после marker; обычное открытие web-страницы marker CaptionPanels не меняет;
- UI объясняет, что каждое открытие CaptionPanels получает актуальный серверный сценарий, а After Effects не обновляется автоматически; при изменении показывает адресную ссылку на history diff;
- focused backend: `10 passed`; full backend: `225 passed, 2 skipped`; frontend full component suite: `23 passed`; production build: успешно; Playwright `scenario-autosave.spec.ts`, `chromium-1366`: `2 passed` вместе с fixture-test;
- review correction сделала history link действительно адресным: query-session загружается существующим detail endpoint параллельно первой странице, автоматически раскрывается после direct load/reload и не дублируется при последующей cursor pagination; frontend full после correction: `25 passed`, Playwright `story-history.spec.ts`: `2 passed`;
- повторное review закрепило канонический порядок `edit-session.id DESC` при объединении addressable session с cursor-страницами и заменило проглатывание detail-ошибки на русское retryable-сообщение без потери обычной истории; frontend full: `26 passed`, Playwright direct-session retry на `1366` и `1920`: `2 passed`;
- independent review полного диапазона `0583711..f340a7d` принял Commit 3.4 после двух correction rounds без оставшихся findings;
- in-app Browser runtime вернул пустой список browser bindings, поэтому документированный standalone Playwright fallback использован и явно зафиксирован как средовая оговорка.

## Следующее действие

Выполнить Commit 3.5: прогнать полную границу CP3, записать runner-owned evidence и закрыть checkpoint только после независимого review.
