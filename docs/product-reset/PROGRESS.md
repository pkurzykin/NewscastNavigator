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
- [x] Commit 3.5: runner-owned CP3 evidence привязана к clean source `f867c470e917868e4b039d1d247ba61e8b79b791`; checkpoint verify проходит.

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

### Source/template граница Commit 3.5

- CP3 evaluator принимает только точную структурированную evidence для scenario backend, local-authoritative autosave, session history, always-latest CaptionPanels и окончательного удаления runtime bridge;
- пять канонических CP3-команд имеют exact command strings, deterministic count parsers, уникальные IDs и runner-owned metadata с hashes, duration и полным `evaluated_commit`;
- Git gate проверяет ancestry CP2→CP3 и обеих base SHA, обязательные source/test/e2e paths в дереве CP3 commit, отсутствие пяти bridge paths и историческую CP2 evidence относительно её собственного commit;
- runner проверяет clean committed source, HEAD и tracked/nonignored side effects до и после каждой команды;
- source template намеренно остаётся незавершённым: `CP3.passed=false`, `evaluated_commit=null`, `missing=["command_evidence_pending"]`, `commands=[]`; CP3 не добавлен в `completed_checkpoints`, а hard gates остаются `false`;
- реальный evidence-writing `run --checkpoint CP3` в source commit не выполнялся: его запускает boundary controller только после независимого review чистого commit.

### Проверенная CP3 binding-граница

- реальная браузерная диагностика исходной границы обнаружила phantom hydration save и self-lock после hard reload; три локальных guard-correction не закрыли весь класс, поэтому ownership lease заменён единым controller с epoch, exact credential identity, acquire/release drain barrier, single-flight heartbeat и parent-owned handoff между story editors;
- controller и autosave закрывают deferred heartbeat `A -> BFCache -> B`, explicit release, inactivity и server `expires_at`, terminal heartbeat, StrictMode, actual `StoryScenarioPage` loading-unmount/remount, story scope isolation и recovery latest draft через новую lease B;
- adverse-order hard-reload browser test принудительно получает временный `SCENARIO_LEASE_HELD`, подтверждает сохранность текста/draft, exact release A и успешный supported retry через B; actual-navigation BFCache test честно даёт explicit skip в headless Chromium, который запущен с отключённым BFCache, а deterministic lifecycle matrix остаётся обязательной;
- полный accumulated CP3 fix-range после трёх review/correction циклов принят независимо: `Spec compliance: Approved`, `Code quality: Approved`, Critical/Important/Minor findings отсутствуют;
- runner на clean source `f867c470e917868e4b039d1d247ba61e8b79b791` выполнил backend full suite: `245 passed`; frontend full suite: `57 passed`; production build: `127 modules transformed`;
- browser pair `scenario-autosave.spec.ts` + `story-history.spec.ts`, `chromium-1366`: `5 passed`; `scenario-autosave.spec.ts`, `chromium-1920`: `3 passed`; обе команды завершились с exit `0`;
- каждый из пяти command records содержит exact command, exit code, count, duration, output/command hashes и exact evaluated commit; `checkpoint_results.CP3.passed=true`, `missing=[]`, `completed_checkpoints=["CP1","CP2","CP3"]`;
- `product_reset_eval.py verify --scope checkpoint --checkpoint CP3 --repo-root ..` завершился с exit `0`, `passed=true`, errors `[]`;
- `local_hard_gates_passed`, `hard_gates_passed` и `full_eval_passed` корректно остаются `false`: впереди CP4–CP7 и внешний demo gate.

## CP4 — редакционный и производственный workflow

- [x] Commit 4.1: editorial review и proofread реализованы как revision-bound workflow-отметки одного актуального сценария; combined functions не создают self-request, поздняя правка сохраняет marks, а повторная вычитка запускается только явным действием руководства.
- [x] Commit 4.2: назначения, материалы, бинарная озвучка, монтаж и титры реализованы серверными transitions/gates; production GET остаётся read-only, video/titles read markers привязаны к actor, stages/actions вычисляются сервером, архивная карточка не предлагает mutations.
- [x] Commit 4.2: страница «Производство» встроена в единый shell с тремя вкладками; действия используют `scenario_revision` из production read model без hydration строк сценария и без frontend gate/status calculator; deterministic backend/component и `production-workflow.spec.ts` закрепляют границу.
- [x] Commit 4.3 source/template: добавлены strict CP4 evidence schema, exact runner commands/count/expected-exit contract, Git ancestry/tree validation и synthetic runner tests.
- [x] Commit 4.3 review follow-up: historical CP1–CP3 subtrees привязаны к exact `EVAL_RESULT.json` из immutable binding commits, а CP4 manifest дополнен integration paths и явными transition/gate IDs.
- [x] Commit 4.3 source correction: CP4 frontend full-suite явно отключает experimental Node webstorage без фильтрации Vitest; exact команда прошла все `13` test files / `87` tests.
- [x] Commit 4.3 binding: runner-owned CP4 evidence привязана к clean source `5b25658f84e5b94c267ef59f3bfa2c9552fa04dd`; checkpoint verify проходит.

### Source/template граница Commit 4.3

- evidence содержит точные contracts, integration source/test paths, assignment/material IDs и полный набор production transition/gate IDs для editorial workflow, current-revision/late-edit/read-marker semantics, server-derived read model, three-tab frontend и deterministic CP4 tests;
- четыре positive commands требуют exit `0` и положительный parsed count; raw frontend denylist требует exact exit `1` и count `0`, причём совпадения считаются и при ожидаемом exit `1`, поэтому найденный запрещённый identifier не может стать ложным нулём;
- canonical `frontend-full-suite` использует `NODE_OPTIONS=--no-experimental-webstorage npm test -- --run`: это стабилизация Node 25 runtime, а не test filtering; count parser по-прежнему считает полный итог Vitest;
- command records обязаны иметь exact порядок/IDs/поля, runner/commit/hash/summary/duration metadata; лишние, пропущенные, дублированные и неизвестные записи отвергаются;
- Git gate проверяет CP3→CP4 ancestry, обе base SHA, существование обязательных paths именно в CP4 evaluated tree и exact полные CP1–CP3 result subtrees из pinned binding commits `57743e1`, `ec630cd`, `82f5eaa`; отдельно закреплены исходные evaluated commits `ee8efc5`, `60c8f67`, `f867c47`;
- недоступный pinned commit/blob, любое изменение historical count/hash/summary/duration/evidence/evaluated commit и malformed нестроковый command ID fail closed;
- runner требует один clean committed HEAD до, между и после каждой команды; failed command не добавляет CP4 в completed checkpoints;
- source template намеренно остаётся незавершённым: `CP4.passed=false`, `evaluated_commit=null`, `missing=["command_evidence_pending"]`, `commands=[]`; CP4 остаётся в `failed_gates`, все hard gates — `false`;
- в текущем source correction повторный evidence-writing `run --checkpoint CP4` не выполнялся: он разрешён только после independent review нового чистого source commit.
- первая разрешённая попытка boundary на `1d4b891` честно остановилась только на raw frontend-команде (`26 failed`, `window.localStorage.clear is not a function`); failed-run record не сохранён как binding, source template возвращён в unbound state, повторный runner в correction не выполнялся.

### Проверенная CP4 binding-граница

- CP4.1 review закрепил revision-bound editorial/proofread marks, отсутствие self-request для combined functions и refetch workflow после autosave ack без замены локальных rows/focus;
- CP4.2 review corrections сделали video/titles read markers actor-specific и production GET идемпотентным, восстановили корректный tab/refresh flow, изолировали stale async responses между разными story и согласовали browser fixture с server-derived gates;
- первая boundary-попытка на `1d4b891` не стала evidence: она честно выявила только Node 25 experimental-webstorage failure старой raw frontend-команды; после TDD-correction и повторного independent review runner был запущен заново на exact clean source `5b25658f84e5b94c267ef59f3bfa2c9552fa04dd`;
- runner выполнил backend full suite: `378 passed`; stabilized frontend full suite: `13` files / `87 passed`; production build: `136 modules transformed`; Playwright `production-workflow.spec.ts`, `chromium-1366`: `4 passed`;
- raw frontend denylist завершился с ожидаемым exit `1`, count `0`, `automated_pass`; каждый из пяти records содержит exact command, expected/actual exit, count, duration, output/command hashes и exact evaluated commit;
- `checkpoint_results.CP4.passed=true`, `missing=[]`, `completed_checkpoints=["CP1","CP2","CP3","CP4"]`; CP4 checkpoint verify завершился с exit `0`, `passed=true`, errors `[]`;
- final verify ожидаемо остаётся красным с exit `2` и единственной ошибкой `full_eval_passed имеет значение false`: CP5–CP7, clean-deploy/restore rehearsal и внешний demo gate ещё не завершены.

## CP5 — правки и персональная работа

- [x] Commit 5.1: единый пакет правок реализован поверх существующих `CorrectionPackage` / `CorrectionPart` без миграции и параллельного task/status-контура.
- [x] Commit 5.1: внутренний multi-part пакет, reusable external service primitive, assignee/leadership completion, leadership return/close и atomic video/title ready объединены одним server-derived workflow; combined ready доступен только после старта соответствующего production-трека, а для титров — после полного initial gate.
- [x] Commit 5.1: CP4 voiceover correction использует тот же generic service/read model; production GET содержит только correction summary, полный список загружается каноническим correction GET.
- [x] Commit 5.1: production UI показывает целый пакет и все части, открывает единую форму video/title corrections и исполняет только возвращённые сервером действия через общий single-flight coordinator.

### Проверенная граница Commit 5.1

- public create принимает только `source=internal`; service primitive поддерживает `internal|external`; scope-reset выполняется в одной транзакции и не снимает поздние editorial/proofread marks;
- pending part блокирует конфликтующий direct ready и скрывает ручные действия своего production scope; после combined video completion leadership может публично выполнить approve-for-titles, даже если mixed package ещё открыт из-за другой pending part;
- actor-specific correction GET возвращает open/closed packages newest-first, deterministic parts, максимум один primary action, активные assignee options только при доступном create;
- component RED зафиксирован отсутствующими correction modules, backend RED — отсутствующими routes; после реализации focused backend: `51 passed`, frontend focused: `7 passed`;
- полный backend: `400 passed, 2 skipped`; frontend full: `14` files / `94 passed`; production build: `139 modules transformed`;
- Playwright `production-workflow.spec.ts`, `chromium-1366`: `5 passed`; synthetic flow проверяет multi-part create, assignee-only atomic video/title actions, leadership return/close, all-parts review, видимость CP4 voiceover package, один primary на карточку и отсутствие console errors/overlay/overflow;
- фактические рендеры списка и multi-part dialog на `1366px` проверены по screenshots; Compose config с `.env.example` проходит;
- independent review после двух correction rounds принят: обязательный production correction summary и truthful browser action fixture закреплены; Critical/Important/Minor findings — `0/0/0`;
- CP5 evaluator/evidence не начат: это отдельная утверждённая граница после Commit 5.2.

## Следующее действие

После отдельного разрешения начать Commit 5.2 — notifications и персональные действия; не начинать CP5 evaluator или CP6 автоматически.
