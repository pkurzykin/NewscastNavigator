# NewscastNavigator Product Reset — прогресс

Статус: реализация начата в отдельном worktree `NewscastNavigator-product-reset`, ветка `feat/product-reset`.

## Версия 1.1.0 — шапка сценария и DOCX

- База Product Reset: `3dd7dba`; утверждённый design: `4e258a7`;
  implementation-plan base: `f13f95e`.
- Рабочая ветка/worktree: `codex/scenario-docx-export` в
  `/private/tmp/NewscastNavigator-scenario-docx-export`; реальных данных,
  внешних серверов и deploy не использовалось.
- C1 baseline commands: `cd backend && ./.venv/bin/pytest -q
  tests/characterization/test_editor_contract.py
  tests/characterization/test_captionpanels_contract.py` — `4 passed`;
  `cd frontend && npm test -- --run
  src/pages/__tests__/EditorPage.characterization.test.tsx` — `19 passed`;
  `cd frontend && npx playwright test editor-characterization.spec.ts
  --project=chromium-1366 --workers=1` — `5 passed`.
- Первичный `npm ci` в этом окружении установил пакеты без `.bin`; проверка
  показала `omit=null`, `production=null` и присутствие `vitest` в
  `package.json`/`package-lock.json`. Повторный lock-based
  `npm ci --include=dev` восстановил bin-links; это environment-specific setup
  recovery, а не изменение product/runtime.
- Удалено: ничего. Остающиеся внешние gates 1.1.0: будущие C1--C4 runtime,
  render и clean-deploy проверки; push, PR, merge, tag и deploy не выполнялись.
- C1 backend slice: добавлен свободный `duration_text` длиной до 64 символов
  только в read-model и metadata patch. Пустая строка и явный JSON `null`
  сохраняются как `NULL`; история показывает «Хронометраж» без raw payload.
  Права автора/руководства, отказ для архивного сюжета, `updated_at` и
  неизменность `scenario.revision_no` покрыты TDD. Focused C1 gate:
  `41 passed, 1 skipped` (PostgreSQL-only проверка) с неизменённым
  CaptionPanels contract. Удалено: ничего; внешние runtime/render/deploy gates
  остаются следующими шагами.
- C1 frontend slice: обязательный `duration_text: string | null` протянут через
  `StoryListItem`, `ScenarioSnapshot`, metadata latest-wins coordinator и
  acknowledged parent patch. Явный `null` сохраняет смысл очистки; title,
  rubric и duration сериализуются максимум одним in-flight PATCH, а parent
  получает только подтверждённые сервером поля.
- В существующей синей шапке название стало auto-growing `textarea`: переводы
  строк нормализуются в один пробел, Enter запрещён, resize не remount-ит поле
  и не сбрасывает focus/selection/scroll. Рядом в том же desktop-ряду показаны
  рубрика и редактируемый хронометраж с trim, empty-to-null и `maxLength=64`;
  read-only состояние отключает поле. На breakpoint до 900 px шапка остаётся
  одноколоночной.
- C1 frontend gates: focused component/page — `32 passed`; полный Vitest —
  `25 files, 215 passed`; Playwright editor characterization — `10 passed`
  (`5` сценариев на `chromium-1366` и `chromium-1920`); story navigation —
  `2 passed`; production build (`tsc -b && vite build`) — успешно. Первый
  sandbox-запуск Playwright ожидаемо получил `listen EPERM`; разрешённый
  повтор использовал неизменные tests/product code. В выводе сохранились
  существующие Node warnings про `--localstorage-file` и `NO_COLOR`.
- Реестр и create UI не получили колонку/поле хронометража; ширины пяти
  editor-колонок, resizers, sticky offsets и CaptionPanels contract не
  менялись. Metadata PATCH не увеличивает technical scenario revision. В
  этом slice ничего не удалено; push, PR, merge, tag и deploy не выполнялись.
- C2 backend завершён authenticated endpoint
  `POST /api/v1/stories/{story_id}/scenario/export-docx`: обычная browser
  session-cookie обязательна, CaptionPanels bearer не принимается. Endpoint
  строит frozen revision-safe snapshot, рендерит DOCX только в памяти и
  возвращает exact DOCX content type, безопасные ASCII/RFC 5987 filenames и
  `Cache-Control: no-store`; `commit`, background task, export record, temp-
  или storage-файл не создаются. Активный и архивный сценарии доступны любому
  авторизованному сотруднику согласно общему read contract.
- Task 6 TDD: focused RED до route — `13 failed` с ожидаемым `404 NOT_FOUND`;
  focused GREEN — `13 passed`. Точный C2 gate
  `test_scenario_docx_snapshot.py + test_scenario_docx_renderer.py +
  test_scenario_docx_export_api.py + test_stories_api.py +
  characterization/test_editor_contract.py +
  characterization/test_captionpanels_contract.py` — `57 passed`.
  API tests независимо проверяют `401`, `404`, `422`, exact `409`, безопасные
  headers, reopen DOCX, полную неизменность `updated_at`/revision/events/
  workflow/production/notifications и одинаковые all-table counts/files после
  двух вызовов. Удалено: ничего; frontend, CaptionPanels routes и snapshot/
  renderer semantics не менялись; broad suite, push, PR, merge, tag и deploy
  не выполнялись.
- Task 8 C3 frontend завершён sticky-действием «Экспорт DOCX» и fail-closed
  coordinator. В редактируемом сценарии scenario PUT и metadata PATCH
  запускаются одновременно, а POST начинается только после обоих ack и
  получает подтверждённые revision/title/rubric/duration. Повторный click во
  время ожидания не создаёт второй POST; ошибка любого flush или export не
  создаёт download и не заменяет локальный текст/metadata.
- Read-only held/archive сохраняет кнопку экспорта, пропускает PUT/PATCH и
  отправляет canonical loaded state. Editing/add/delete/format controls при
  этом отсутствуют; в editable режиме сохранён ровно один formatting toolbar.
  Sticky offset таблицы и CaptionPanels UI/API contract не менялись.
- Task 8 TDD: pure coordinator сначала отсутствовал, затем stub дал `7 failed`;
  GREEN — `7 passed`. Первичная component-интеграция дала `9 failed`; отдельный
  StrictMode regression-тест воспроизвёл stale duration (`00:30` вместо
  `04:40`), после удержания общего metadata coordinator в parent получил
  GREEN. Финальный component gate — `46 passed`.
- Playwright Task 8: новый synthetic DOCX/download suite — `6 passed`, полный
  gate вместе с editor characterization — `16 passed` (`8` на
  `chromium-1366` и `8` на `chromium-1920`). Проверены пять типов блоков,
  PUT/PATCH-before-POST, exact expectations, один ZIP/DOCX download, sticky и
  отсутствие horizontal overflow, archive без save и `409` без download.
  Первый sandbox-запуск получил `listen EPERM`; разрешённый повтор использовал
  неизменные product/tests. Production build (`167 modules`) успешен после
  исправления test-only TypeScript tuple arity; дополнительный полный frontend
  suite — `27 files, 260 passed`. Удалено: ничего; backend не менялся; push,
  PR, merge, tag и deploy не выполнялись. Следующий slice — C4.
- Task 8 fix round 1 устранил расхождение metadata coordinator между parent
  export flow и шапкой после StrictMode replay, подтверждённой смены рубрики
  или conflict UI remount. `ScenarioEditor` теперь владеет одним coordinator
  на lifetime story, удерживает его через безопасный owner retain/release и
  передаёт тот же instance шапке; старый snapshot при смене story не создаёт
  coordinator с чужими initial metadata. Две behavioral-регрессии до fix
  получили `2 failed` (`export-post` вместо `metadata-patch`), после fix —
  `2 passed`; Task 7 header retention — `24 passed`; Task 8 component gate —
  `48 passed`; полный frontend — `27 files, 262 passed`; browser C3 —
  `16 passed`; build (`167 modules`) успешен. UX/backend не менялись.

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
- на CP4 binding-границе final verify ожидаемо оставался красным с exit `2` и единственной ошибкой `full_eval_passed имеет значение false`: тогда CP5–CP7, clean-deploy/restore rehearsal и внешний demo gate ещё не были завершены; актуальное состояние CP5 зафиксировано ниже.

## CP5 — правки и персональная работа

- [x] Commit 5.1: единый пакет правок реализован поверх существующих `CorrectionPackage` / `CorrectionPart` без миграции и параллельного task/status-контура.
- [x] Commit 5.1: внутренний one-part пакет, reusable external multi-part service primitive, assignee/leadership completion, leadership return/close и atomic video/title ready объединены одним server-derived workflow; combined ready доступен только после старта соответствующего production-трека, а для титров — после полного initial gate.
- [x] Commit 5.1: CP4 voiceover correction использует тот же generic service/read model; production GET содержит только correction summary, полный список загружается каноническим correction GET.
- [x] Commit 5.1: production UI показывает целый пакет и все части, открывает единую форму video/title corrections и исполняет только возвращённые сервером действия через общий single-flight coordinator.

### Проверенная граница Commit 5.1

- accepted runtime-граница состоит из `c6b708440cb8540a41a9d09041162d38f523dfba`, `0281186966d1c2245ac55e1ace604cf4e265b9c9` и `623f9f033d0400fb24259887f0a3adc3cab68903`; final runtime HEAD — `623f9f033d0400fb24259887f0a3adc3cab68903`;
- public create принимает только `source=internal`; service primitive поддерживает `internal|external`; scope-reset выполняется в одной транзакции и не снимает поздние editorial/proofread marks;
- pending part не блокирует public start соответствующего production-трека, но блокирует конфликтующий direct ready; после combined video completion leadership может публично выполнить approve-for-titles, даже если mixed package ещё открыт из-за другой pending part;
- actor-specific correction GET возвращает open/closed packages newest-first, deterministic parts, максимум один primary action, активные assignee options только при доступном create;
- component RED зафиксирован отсутствующими correction modules, backend RED — отсутствующими routes и последующими prerequisite/pre-start regressions; финальный focused backend: `59 passed`, frontend focused: `7 passed`;
- полный backend: `408 passed, 2 skipped`; frontend full: `14` files / `94 passed`; production build: `139 modules transformed`;
- Playwright `production-workflow.spec.ts`, `chromium-1366`: `6 passed`; synthetic flow проверяет пакеты правок, actor-specific actions, public video/title start при pending parts, блокировку direct ready, combined ready, leadership approve/return/close, all-parts review, видимость CP4 voiceover package, один primary на карточку и отсутствие console errors/overlay/overflow;
- фактические рендеры списка и тогдашнего multi-part dialog на `1366px` были проверены по screenshots; это промежуточное состояние позже отклонено rubric-проверкой Commit 5.3 и заменено one-part internal dialog, а external multi-part сохранён только в service contract;
- final independent review принят: обязательный production correction summary, production prerequisites, pre-start semantics и truthful browser fixtures закреплены; Critical/Important/Minor findings — `0/0/0`; parent runtime review — Critical/Important `0/0`;
- CP5 evaluator/evidence не начат: это отдельная утверждённая граница после Commit 5.2.

### Реализованная граница Commit 5.2

- [x] Сгруппированные внутренние notifications добавлены поверх существующих `Notification` / `ScenarioReadMarker` без миграции, внешних каналов и отдельной task/status-модели.
- [x] `GET /api/v1/me/actions` возвращает live server-derived персональные действия со стабильными ID и детерминированной сортировкой; `GET /api/v1/notifications` изолирует recipient, а idempotent read-команда не создаёт `StoryEvent`.
- [x] Assignment, workflow, production-ready и correction delivery адресуются только активным релевантным получателям, исключают actor; повтор неизменённого назначения не создаёт второе уведомление.
- [x] Late edits доставляются только из общей границы finalization, группируются по recipient/story/kind/session и сохраняют semantic diff от proofread или последней реально открытой downstream revision; snapshot промежуточной revision сохраняется как immutable baseline и для следующего edit-session.
- [x] Video/title/CaptionPanels markers монотонны и закрывают только соответствующие уведомления до effective revision; обычный scenario context их не закрывает, более позднее уведомление остаётся непрочитанным.
- [x] Компактный `AttentionQueue` не владеет состоянием таблицы и не занимает места при empty/initial-load error; preview показывает три действия, первый expand лениво загружает полный server total с доступными loading/error/retry состояниями, а collapse возвращает компактный вид. `NotificationTray` показывает серверный `unread_count` независимо от limit списка, русский summary и persisted diff, сохраняет item при ошибке manual read и revalidate-ит серверное состояние после successful opened-marker без polling.
- [x] Router хранит полный pathname/query/hash, поэтому same-path deep link открывает точный production context и переживает refresh; marker-context обновляется по уже загруженной revision без повторной hydration живого редактора, замены локального ввода или потери focus.

### Проверенная граница Commit 5.2

- TDD RED зафиксировал отсутствующие notification/action routes, delivery/grouping/baseline semantics, frontend modules, unhandled manual-read rejection, duplicate unchanged assignment, потерю intermediate recipient baseline и stale badge после successful opened-marker; финальный self-review отдельно воспроизвёл два точных frontend-дефекта (`scenario GET` выполнялся дважды при same-path query, badge показывал `items.length=1` вместо server `unread_count=3`) и довёл общий correction-run до `12 passed`.
- Первое независимое review отклонило исходный commit с Critical/Important/Minor `0/4/0`: stage-start/proofread baseline мог быть скомпактирован между edit-сессиями, CaptionPanels import не закрывал titles notification, production projection не учитывал CaptionPanels marker, а очередь из многих действий вытесняла таблицу. Отдельная TDD correction-wave воспроизвела все четыре дефекта и закрыла их без amend исходного commit.
- Correction сохраняет immutable snapshots всех эффективных late-diff baselines (`proofread`, `video_started`, `titles_started` и downstream markers), проводит реальный CaptionPanels import через общий marker/read path, использует максимум titles/CaptionPanels marker в production projection и показывает первые три действия с доступным раскрытием/сворачиванием в исходном server order.
- Повторное review отклонило первый correction commit с Critical/Important/Minor `0/1/1`: expand показывал только первые `20` при большем server total, а больше не нужные intermediate snapshot rows старых edit-сессий оставались навсегда. TESTS-ONLY RED дал `2 failed` backend, `2 failed / 6 passed` component и browser mismatch `20 != 21`.
- Вторая correction-wave оставила единый `/me/actions` endpoint с валидируемым limit до `10000`, загружает `limit=total` только при первом expand, не скрывает preview во время loading/error и сохраняет retry. Finalization теперь глобально удаляет только rows устаревших intermediate revisions, сохраняя revision headers, current/effective baselines, no-session snapshots и latest boundary каждого edit-session; старый session boundary остаётся восстанавливаемым.
- Третье independent review отклонило второй correction commit с Critical/Important/Minor `0/1/0`: глобальная compaction материализовала растущий список старых revision IDs в Python и передавала его в параметризованный `IN (...)`. Первый SQL-shape RED получил captured `DELETE ... REVISION_ID IN (?)`; финальный self-review усилил контракт и отдельно воспроизвёл ещё оставшийся materialized список session boundaries как `REVISION_NO NOT IN (?, ?, ?)`. Окончательная correction выполняет один `DELETE` с set-based subqueries для prunable `ScenarioRevision.id`, всех `ScenarioEditSession.latest_revision_no` и read-marker baselines; current revision и три workflow/production baseline остаются bounded scalar guards. Focused backend после correction: `19 passed`.
- exact new-behavior GREEN предыдущей волны: backend `2 passed`, component `8 passed`, focused browser `1 passed`; финальный полный backend после fully set-based correction: `423 passed, 2 skipped` (`999 warnings`, `594.60s`, exit `0`);
- сырой full frontend на локальном Node `25.7.0` дал инфраструктурные `26 failed / 103` из-за встроенного experimental `globalThis.localStorage` без `clear`; root cause подтверждён минимальным прогоном. Канонический полный прогон с уже утверждённым `NODE_OPTIONS=--no-experimental-webstorage` прошёл: `15` files / `103 passed`; CI Node 22 и Docker Node 20 этому сбою не подвержены. Production build: `142 modules transformed`;
- Playwright `notification-routing.spec.ts`, Chromium 1366: `2 passed`; очередь с server total `21` показывает preview из трёх, лениво загружает все `21`, сворачивается обратно и не вытесняет таблицу, а late notification сохраняет exact route, persisted diff и read-state;
- Playwright `production-workflow.spec.ts`, Chromium 1366: финальный post-correction run `6 passed`; совместимые fixtures возвращают пустой notification read model, а test-local timeout длинного correction flow был увеличен с 60 до 90 секунд после двух прогонов, завершивших все assertions и превысивших лимит только на teardown внешнего тома; прежняя internal multi-part формулировка относится к отклонённому состоянию до one-part correction Commit 5.3;
- screenshots `attention-queue-1366.png` и `notification-diff-1366.png` визуально проверены на предыдущей UI-волне: collapsed preview `3 / 21` проходит `<160px`, таблица полностью видима, popover и semantic before/after diff читаемы без overflow при 1366×768. Третья correction меняла только backend compaction; post-fix notification Playwright прошёл `2 / 2`, после чего production-run удалил transient screenshots;
- Compose config с `.env.example`, пустой migration diff и `git diff --check` проходят; финальный post-third-correction exact-scope self-review: Critical/Important/Minor `0/0/0`, миграций, CP5 evaluator/evidence и CP6 в diff нет;
- на runtime-границе Commit 5.2 evaluator ещё не запускался и runner-owned evidence отсутствовала; актуальная CP5 evidence и завершённые binding/pin границы зафиксированы ниже.

- [x] Checkpoint 5: strict evidence schema, exact runner commands/count contract, CP4→CP5 ancestry/tree/migration validation и synthetic runner tests завершены; runner-owned evidence привязана к exact source, binding commit и exact-SHA test pin созданы, checkpoint повторно verified.

### Проверенная и pinned граница Checkpoint 5

- evidence имеет точные разделы для единого correction package (`internal_one_part`, reusable external multi-part primitive), внутренней notification delivery, late-edit routing и baseline retention, персональной очереди, компактного frontend attention UI и deterministic tests;
- пять canonical commands требуют exit `0` и положительный parsed count: backend, frontend, build и отдельные production/notification browser specs; frontend full-suite наследует принятую CP4 Node 25 hardening-строку `NODE_OPTIONS=--no-experimental-webstorage` без фильтрации Vitest;
- command records обязаны иметь exact порядок/IDs/поля, expected/actual exit, runner/commit/hash/summary/duration metadata; malformed, лишние, пропущенные, дублированные и неизвестные записи отвергаются;
- Git gate проверяет CP4→CP5 ancestry, обе base SHA, существование обязательных CP5 paths именно в evaluated tree, отсутствие изменений `backend/migrations` после CP4 и exact CP1–CP4 subtrees из pinned binding commits;
- runner требует clean committed HEAD до, между и после каждой команды; до разрешённого запуска source template намеренно оставался незавершённым: `CP5.passed=false`, `evaluated_commit=null`, `missing=["command_evidence_pending"]`, `commands=[]`;
- первая actual попытка `run --checkpoint CP5` на exact source `cc1152c` остановилась на backend-команде до evidence/binding: `test_creation_resets_returned_production_scopes_but_preserves_started_and_text_marks` отправлял устаревший public internal пакет из четырёх частей и закономерно получил `422 INTERNAL_CORRECTION_ONE_PART_REQUIRED`; binding commit и CP6 не выполнялись;
- первое independent review source/template отклонило границу с Critical/Important/Minor `0/3/0`: internal package ошибочно допускал несколько частей, production browser evidence не имела собственной runner-команды, CP5 evaluator не имел зрелой fail-closed regression matrix;
- correction TDD закрепила `INTERNAL_CORRECTION_ONE_PART_REQUIRED` без частичной mutation, сохранила reusable external multi-part primitive и убрала из internal dialog add/remove controls; backend RED был `200` вместо `422`, component RED нашёл кнопку «Добавить часть»;
- повторное review обнаружило оставшийся legacy multi-part internal flow в production browser fixture: точечный RED завершился timeout на удалённой кнопке «Добавить часть»; fixture создания и leadership return/close переведены на один video-part, а pre-start atomic video/title flow — на два отдельных one-part internal package; focused Chromium `1366`: `2 passed`;
- post-source correction сохранила runtime one-part guard и перевела все четыре оставшихся backend multi-scope fixtures с public internal route на reusable atomic external service primitive: scope reset, availability combined actions, atomic video/title completion и deterministic action ordering; намеренный internal multi rejection test остался public. Focused backend: `tests/test_corrections.py` — `22 passed`, связанный `tests/test_production_workflow.py` — `25 passed`;
- повторный runner на exact clean source `38d01309eba9e9ffbe14fcf91ede785819f9b6fb` завершил все пять команд с exit `0`: backend `464`, frontend `103`, build `142 modules`, production browser `6`, notification browser `2`; `EVAL_RESULT.json` теперь содержит `checkpoint=CP5`, `completed_checkpoints=CP1..CP5`, `CP5.passed=true`, `missing=[]` и exact reproducibility records для этого SHA;
- checkpoint verify завершился exit `0` с `passed=true` и `errors=[]`; final verify ожидаемо завершился exit `2` только из-за `full_eval_passed=false`, поскольку незавершёнными остаются CP6, CP7 и внешний demo gate;
- binding commit `f87638588fdd606add683593f340378f5b1c3961` сохранил bound CP5 subtree без ручного изменения command records/hashes; отдельный pin commit `1842660d14653ca95daa06209a7e544225ae881c` сделал source-template reconstruction binding-aware и закрепил exact binding subtree fail closed;
- post-binding TDD сначала воспроизвёл RED (`checkpoint=CP5` вместо reconstructed `CP4`), затем дал GREEN: новый binding block `10 passed`, оставшийся CP5-focused subset `48 passed`, то есть все `49` уникальных CP5-focused tests покрыты; CLI checkpoint reverify после pin commit завершился exit `0`, `passed=true`, `errors=[]`;
- отдельный runner RED показал четыре вызова вместо пяти и отсутствие `production-workflow.spec.ts`; CP5 registry теперь запускает production и notification browser specs отдельными command IDs;
- CP5-specific evaluator matrix покрывает forbidden markers, каждый contract section, command order/ownership/record/repro types, failed/no-count commands, dirty tree, HEAD drift, immutable CP4 binding и Git ancestry/base/path/migration guards; focused результаты после correction: evaluator `40 passed`, backend correction regression `4 passed`, component correction suite `7 passed`.

## CP6 — внешнее согласование, эфир и архив

- [x] Commit 6.1: повторяемые циклы внешнего согласования реализованы поверх baseline `ExternalApprovalCycle` без новой миграции и без параллельной task/status/version-системы.
- [x] Руководство вручную отправляет сюжет, фиксирует `Согласовано` или один внешний multi-part пакет правок; одновременно допускается ровно один pending-цикл, а открытый пакет блокирует следующую отправку.
- [x] `changes_requested` атомарно использует канонический correction primitive: создаёт и связывает external package, его части, событие и внутренние уведомления, сбрасывает только затронутые production scopes и сохраняет editorial/proofread marks.
- [x] После выполнения частей руководство использует существующий review/close workflow пакета и повторно отправляет сюжет; персональная очередь показывает pending result и resend с устойчивыми точными production URL без дублей.
- [x] Production read model публикует external summary; отдельный server-derived read model управляет leadership actions, assignee options и read-only состояниями. Общий single-flight coordinator после mutation обновляет production, corrections и external, а stale external response изолирован по story/generation.
- [x] UI показывает историю повторных циклов, retryable loading/mutation errors и отдельный focus-trapped multi-part dialog; внутренний correction dialog остаётся one-part.

### Реализованная граница Commit 6.1

- backend RED: `11 failed` на отсутствующем route; frontend RED: missing `ExternalApprovalCycles` module до collection;
- focused GREEN: external backend `12 passed`; финальный связанный backend scope `81 passed`; frontend external component `5 passed`, связанный production/correction scope `29 passed`;
- production build завершился успешно: `145 modules transformed`;
- миграция не добавлялась: baseline уже содержит unique `(story_id, cycle_no)` и partial unique pending-cycle index;
- runtime и correction commits: `c184c4b22b123c859b3e2417e38550c56918c7e6`, `6256d28027a23f1c0f86aeaf114bac3e69823e34`, `3a2d8dd531c47d3ca1f3f9f5f6599e5ddbe4ac45`; test-only historical evaluator correction: `f3b7b0d3173af4876e0396240e12535d449d236d`;
- review-fix выровнял approved API-контракт: namespace `/external-approval/cycles`, отдельные `approved` / `changes-requested` команды и package resource для внешних правок; deep-link `?action=external-approval` переводит focus на стабильную секцию, а закрытие dialog после refetch возвращает focus туда, если trigger уже удалён;
- personal queue больше не предлагает resend, пока любой correction package остаётся открытым; после закрытия всех пакетов появляется ровно одно доступное resend-действие;
- полный backend на финальном HEAD: `485 passed, 2 skipped`; полный frontend: `16` files / `110 passed`; production build: `145 modules transformed`;
- Chromium `1366`: `production-workflow.spec.ts` + `notification-routing.spec.ts` — `8 passed`; root Compose с синтетическим `.env.example` и test Compose config завершились exit `0`;
- независимые review проверили полный диапазон `57ff4ca..f3b7b0d`; итоговые Critical/Important/Minor — `0/0/0`;
- Commit 6.2, CP6 evaluator/evidence, эфир, архив, restore, push/PR/merge/deploy ещё не начинались.

### Реализованная граница Commit 6.2

- [x] Каноническое создание сюжета добавлено через server-derived `create-options` и `POST /api/v1/stories`: одна транзакция создаёт `Story`, пустой `Scenario` revision `0`, workflow/production state и событие `story_created`; автор создаёт для себя, `chief` может выбрать другого активного автора.
- [x] Последний завершённый внешний цикл со статусом `approved` разрешает руководству отметить эфир; `aired_at` остаётся визуальной отметкой и не блокирует последующие правки актуального сценария.
- [x] После эфира руководство может архивировать сюжет; архив исключён из active list, доступен во всех read-model, сценарий возвращает `edit.state=archived`, mutation routes отвечают `STORY_ARCHIVED`, активная edit-session финализируется.
- [x] Restore возвращает тот же сюжет в active list без сброса `aired_at`, текущей revision, строк, workflow/production/correction/external history; действия создания/эфира/archive/restore вычисляются сервером.
- [x] Единый mutation lock order начинается с `Story FOR UPDATE`, затем `Scenario -> Workflow -> Production -> cycles/packages/sessions`; active/archive scenario GET читает revision/rows из одного locked aggregate snapshot с `populate_existing`, а save/workflow/history используют сохранённый prelocked Workflow state без post-session relock.
- [x] Frontend получил доступный focus-trapped dialog создания, stale-response guard списка, server-driven archive/restore controls, retryable mutation errors и read-only архивный редактор без lease/save.
- [x] Полный rendered Chromium flow закреплён как create → edit → external approved → air → edit still available → archive → read-only → restore; финальный success-screenshot проверен на `1366`.

### Проверки Commit 6.2

- backend feature RED: `11 failed` на отсутствующих create/lifecycle routes; SQL lock-shape RED: отсутствовал `story_for_update_statement`;
- backend финальный accepted scoped-набор: `132 passed`;
- frontend component RED: `5 failed`; финальный accepted scoped-набор: `4` files / `26 passed`;
- production build: успешно, `146 modules transformed`;
- Chromium `full-story-flow.spec.ts`, `chromium-1366`: `1 passed`, без console/page/request errors, dialog leakage и горизонтального overflow;
- review corrections `1ec2bfc` и `e30093e` закрепили exact single-author payload, server-provided confirmation, полный autosave fixture contract и единый lock order для save/workflow/active GET/history restore без post-session Workflow relock;
- exact public history restore SQL-order regression: `1 passed`; focused preservation history + archive + editorial + autosave: `46 passed`;
- deterministic identity-map RED воспроизвёл смешанный snapshot (`revision=0` при rows новой revision), а усиленные save/workflow SQL-order RED обнаружили post-session Workflow relock; после correction exact regressions: `3 passed`, focused scenario/product-flow/autosave/lease/workflow/archive/history: `52 passed`;
- общий PostgreSQL-aware SQL-order guard fail-closed требует отдельные single-target `FOR UPDATE` statements со строгими индексами Story < Scenario < Workflow < Production < Session, не считает scalar-subquery markers отдельными locks, сразу отклоняет любой mixed-target lock с aggregate/session table и запрещает post-session relock любой из четырёх aggregate tables; первичный meta-contract: `2 failed / 2 passed` до hardening, затем `5 passed`; RED на collapsed multi-table statement: `1 failed`, после structural correction `14 passed`; RED на ранних mixed tracked targets: `3 failed / 1 passed`, после correction полный meta-contract: `19 passed`, реальные save/workflow/active GET/history restore traces: `4 passed`, archive+history scope: `44 passed`;
- CaptionPanels `import-json` SQL-order RED после выравнивания синтетических fixtures с обязательным Production state: `1 failed` на фактической инверсии Scenario → Story → Scenario → Workflow → Production; export теперь один раз блокирует aggregate в порядке Story → Scenario → Workflow → Production, строит payload/revision из уже locked Story/Scenario и записывает actor-specific marker без reacquire; exact regression: `1 passed`, CaptionPanels current+characterization: `6 passed`, production read markers: `5 passed`, scenario lease+archive: `38 passed`, объединённый scope: `53 passed`;
- CaptionPanels exact helper получил subordinate barrier: RED `2 failed / 7 passed` показал, что ранние ScenarioEditSession/ScenarioReadMarker `FOR UPDATE` игнорировались, хотя DML-before-aggregate и noncanonical aggregate уже отклонялись; после test-only correction meta-contract: `9 passed`, actual import trace: `1 passed`, прежний shared meta: `19 passed`, реальные shared paths: `4 passed`, объединённый CaptionPanels/production/scenario/archive scope: `62 passed`;
- новая миграция не добавлялась;
- первый полный backend gate на runtime HEAD честно обнаружил две устаревшие characterization fixture: они создавали Story/Scenario/Workflow без обязательного Production state и получили `INVALID_TRANSITION`; production guard не ослаблялся, test-only correction `74d7be883f7b791afd802f6b7df0b3b892c1eabc` добавила недостающую часть агрегата, focused characterization+lease regression завершился `6 passed`;
- повторный полный backend на финальном HEAD `74d7be883f7b791afd802f6b7df0b3b892c1eabc`: `531 passed, 2 skipped` (`1291 warnings`, `1309.91s`, exit `0`);
- полный frontend: `17` files / `117 passed`; production build: `146 modules transformed`; Chromium `full-story-flow.spec.ts`, `chromium-1366`: `1 passed`; root Compose с `.env.example` и test Compose config завершились exit `0`;
- финальный независимый review полного диапазона `a6b72c2..74d7be8` принят: Critical/Important/Minor — `0/0/0`;
- на runtime-границе Commit 6.2 CP6 evaluator/evidence ещё не выполнялись; актуальный binding/pin зафиксирован ниже, CP7, push/PR/merge/deploy не выполнялись;
- остаточный риск: SQL traces и PostgreSQL statement contracts фиксируют порядок, но реальные конкурентные PostgreSQL blocking-interleavings в этой scoped-проверке не запускались.

### Commit 6.3 — source-template, runner evidence и exact-SHA pin

- [x] CP6 evidence привязана к exact source `1d97ecc18662f5530870e24aff4126f94b2bc4cc`: `passed=true`, `missing=[]`, четыре runner-owned command records сохранены в binding commit `837e0117c01e473c93f0469df4847e858f2654b5`.
- TDD RED: CP6-focused evaluator scope дал `38 failed / 1 passed`, потому что отсутствовали CP6 command/evidence registry, schema/git validators и immutable runner.
- Focused GREEN source-template: `39 passed`; строгий contract покрывает повторные external cycles, атомарное создание и lifecycle, aggregate consistency/lock order, полный product flow и deterministic backend/component/browser tests.
- Полный evaluator test file после расширения historical registry: `244 passed`; CP1–CP5 contracts и bindings не ослаблены.
- Канонический runner владеет точным порядком четырёх команд: полный backend, стабилизированный полный frontend, production build и `full-story-flow.spec.ts` на `chromium-1366`; failed/no-count command, dirty tree и HEAD drift оставляют checkpoint незавершённым.
- Git gate закрепляет exact CP5 binding/evaluated subtree, CP1–CP5 ancestry, наличие всех CP6 referenced paths в evaluated tree и отсутствие изменений `backend/migrations` между CP5 и CP6; CP5 validator остаётся явно ограничен предшественниками CP1–CP4.
- Независимый source review принят с Critical/Important/Minor `0/0/0`.
- Первая unprivileged runner-попытка подтвердила backend `570`, но frontend/build/browser получили `exit_code=1`, `count=0` из-за запрета sandbox на записи в sibling worktree; финальная запись `EVAL_RESULT.json` также завершилась `PermissionError`, поэтому partial evidence не была материализована и binding не создавался.
- Авторизованный exact rerun на том же clean source завершил все команды exit `0`: backend `570` (`1335253ms`), frontend `117` (`111686ms`), build `146 modules` (`23781ms`), browser `1` (`69825ms`); checkpoint verify завершился exit `0`, `passed=true`, `errors=[]`.
- Binding commit `837e0117c01e473c93f0469df4847e858f2654b5` сохранил runner-owned CP6 subtree. Exact-SHA pin TDD: `9 failed` до binding helper, затем `9 passed`; оставшийся CP6-focused scope `38 passed`; post-pin CLI verify повторно завершился exit `0`, `passed=true`, `errors=[]`. Pin проверяет source/count/duration, exact subtree, metadata drift и fail-closed unavailable commit/blob/JSON/subtree.
- `local_hard_gates_passed`, `hard_gates_passed` и `full_eval_passed` остаются `false`: CP7, clean-deploy/restore rehearsal и внешний demo gate ещё не завершены.

## CP7 — дизайн, UX hard-gate, operations и документация

### Реализованная граница Commit 7.1

- [x] Монолитный `frontend/src/styles.css` заменён прямыми imports `tokens.css`, `base.css`, `layout.css` и feature styles; новый Editorial Air использует тёплый нейтральный canvas, paper surfaces, синий action-цвет и адресный coral accent.
- [x] Corporate identity удалена из `App`, `AppShell`, tracked asset/config/docs и `.gitignore`; пользовательская идентичность теперь текстовая: `Newscast Navigator` и kicker `Редакционный эфир`.
- [x] Профиль больше не показывает raw `function_codes`; shell navigation использует `aria-current`, ошибки смены пароля получили live alert, focus outline имеет 3 px и reduced-motion fallback.
- [x] Локальный Onest взят byte-for-byte из официального `simpals/onest` на pinned commit `f18c06a14512e43a6191849278d6f07fdaf347d6`: upstream `fonts/webfonts/Onest[wght].woff2` сохранён как `Onest-VariableFont.woff2`, upstream `OFL.txt` сохранён без изменения. SHA-256: font `e117f6aee7c97fbc2f7e6514fa08a31ad43e7bd116105aeac15c8c1b8427f7db`, license `071195d8806e226faeee60259c28ca67b458227af5195a73f5cfcab06e3003bc`; byte comparison с pinned raw files прошёл.
- TDD RED до runtime-правки: AppShell не содержал `Редакционный эфир`, показывал corporate artwork/text и raw codes; browser identity test нашёл corporate image; keyboard-focus test получил outline `1px` при gate `>=2px`.
- Focused GREEN: AppShell `1 passed`; CP7.1 Playwright на `1366` — `3 passed`, на `1920` — `3 passed`; axe не нашёл serious/critical WCAG A/AA/2.1 AA violations на main screen, notification tray и create dialog; focus trap и возврат фокуса прошли.
- Полный frontend component gate: `18` files / `118 passed` с каноническим для локального Node 25 `NODE_OPTIONS=--no-experimental-webstorage`; raw Node 25 run дал известный infrastructure failure `26 failed` из-за experimental `localStorage`, а focused canonical retry тех же `26` тестов завершился `26 passed`.
- Production build: `154 modules transformed`. Актуальный combined browser regression на `1366`: editor characterization, autosave/workflow и полный create→edit→external approval→air→archive→restore flow — `8 passed`, `1 skipped`; skip относится только к actual BFCache, отключённому в headless Chromium.
- Старые browser fixtures выровнены с текущим контрактом без ослабления assertions: block-type locator не захватывает font selects, append caret не зависит от визуального line wrap Onest, shell `/me/actions` и `/notifications` получают синтетические пустые ответы, а ожидаемый workflow `503` остаётся проверяемым.
- Две итоговые screenshots `1366×768` и `1920×1080` созданы в untracked `artifacts/product-reset/playwright/results` и просмотрены визуально: corporate identity, horizontal overflow, overlap и clipping отсутствуют; единственная primary action реестра сохранена.
- Denylist `транснефт|transneft|logoPath|--brand-|Franklin Gothic` не находит совпадений в `frontend/src` и `frontend/public`.

Commit 7.1 не объявляет UX hard-gate или CP7 завершёнными: формальная оценка `>=90/100`, каждая категория `>=8`, before/after evidence, clean-deploy/restore rehearsal и полный evaluator относятся к следующим commits.

### Реализованная граница Commit 7.2

- [x] Добавлен отдельный `ux-hard-gate.spec.ts` с синтетическим набором из 30 активных сюжетов и точными desktop assertions: общий список остаётся первым при `scrollY=0`, на `1366×768` видны не менее шести строк, блок внимания компактен и полностью исчезает при empty response, горизонтальный overflow отсутствует, таблица имеет ровно шесть колонок, карточка — ровно три вкладки, URL переживает reload, primary action ровно одна, завершённые этапы production свёрнуты.
- [x] До runtime-изменений сохранена исходная матрица `before` для списка и production на `1366×768` / `1920×1080`; после минимальных aria/primary/density-правок создана соответствующая матрица `after`. Все восемь PNG и четыре стабильных axe JSON находятся под ignored `artifacts/product-reset/CP7/ux/` и связаны с human/machine rubric через SHA-256.
- [x] `UX_EVAL_RU.md` содержит десять фиксированных категорий, rationale, visual comparison и строгий machine-readable блок. Итог — `90/100`; оценки по порядку категорий: `9, 10, 9, 9, 9, 9, 9, 8, 9, 9`, каждая категория не ниже `8`.
- [x] Backend validator fail closed проверяет exact schema/order/labels, integer score `0..10`, пороги `>=90` и `>=8`, полный screenshot/axe matrix, безопасные фиксированные artifact paths, уникальные IDs, SHA-256 локальных файлов и согласованность `ux_total` / `ux_categories` с `EVAL_RESULT.json`.
- [x] В `EVAL_COMMANDS.json` зарегистрированы четыре точные команды группы `cp7_ux`: backend schema/evaluator, UX hard gate на `1366` и `1920`, accessibility/axe на `1366`. CP7 checkpoint остаётся незавершённым и не запускается до operations/docs/evaluator-границ следующих commits.

### Проверенная граница Commit 7.2

- Browser TDD RED: исходный hard gate дал `3 failed / 0 passed` из-за отсутствующего accessible name таблицы и primary marker production; после этих минимальных правок остался `1 failed / 2 passed` — высота attention queue `126.84375px` превышала предел `122px`. Компактная density-правка закрыла последний дефект.
- Accessibility artifact RED подтвердил отсутствие canonical axe JSON; следующий полный accessibility run обнаружил потерю ref у общего `ActionButton`, из-за которой не восстанавливался keyboard focus. `forwardRef` сохранил общий button contract и вернул focus regression в green.
- Backend TDD RED: новый UX evidence suite дал `25 failed`; после schema/loader/alignment implementation — `24 passed, 1 deselected`, затем integration boundary — `26 passed`. Registry RED дал `1 failed / 1 passed`, после регистрации exact commands — `3 passed`.
- Финальные browser gates: `ux-hard-gate.spec.ts` — `3 passed` на `chromium-1366` и `3 passed` на `chromium-1920`; `accessibility.spec.ts` — `3 passed` на `chromium-1366`, включая main/tray/dialog axe, production axe и keyboard focus.
- Repository policy: `7 passed`; полный frontend component suite после чистого `npm ci`: `18` files / `118 passed`. Первый production build честно упал из-за отсутствующих Node typings для нового Playwright JSON writer; добавлен dev-only `@types/node`, чистая установка lockfile прошла, повторный build — `155 modules transformed`.
- Первый полный focused backend run завершился `280 passed / 1 failed`: единственный failure был stale CP5 top-level snapshot, который ожидал `checkpoint=CP5`, хотя tracked result уже законно привязан к CP6. Исторический CP5 subtree не изменён; assertion обновлён на актуальное верхнеуровневое CP6-состояние, exact regression прошёл `1 passed`; полный focused rerun завершился `281 passed`.
- Общий backend suite после focused gate завершился `607 passed, 2 skipped`; оба skip — PostgreSQL-only проверки advisory lock и index inspector при текущем SQLite test runtime, failures отсутствуют.
- Финальный review Commit 7.2 вернул Critical/Important/Minor `0/1/1`: empty Attention assertion мог принять loading-state до empty response, а `EVAL_RESULT.json` и следующее действие оставались на старой границе. TDD RED получил `1 failed` на отсутствующем post-response marker; review-fix ждёт fulfilled response и rendered `data-attention-state="empty"`, проверяет его нулевую высоту, отсутствие region и позицию таблицы без sleep. Первый component-run честно дал `1 failed / 7 passed` на прежнем literal empty-DOM assertion; уточнённый hidden/zero-layout contract завершился `8 passed`. Targeted ready+empty browser gates: `2 passed` на Chromium 1366 и `2 passed` на Chromium 1920; build — `155 modules`, backend UX selection — `32 passed`, repository policy — `7 passed`, strict local evidence — `90 / 10 / 12` без alignment errors. Metadata указывает на Commit 7.3, сохраняя CP7/local/final false.

Commit 7.2 не запускает CP7 runner/binding и не объявляет CP7 завершённым: clean-deploy/restore rehearsal, operations cleanup, документационная сверка и финальная evaluator-граница относятся к следующим commits.

### Реализованная и проверенная граница Commit 7.3

- [x] Оставлены ровно три канонических Compose-контракта: local `compose.yaml`, test `compose.test.yaml` и production-oriented demo `deploy/compose.demo.yaml`; demo собирает отдельные production images backend/frontend/gateway, не использует host bind-mount runtime-кода и сохраняет read-only rootfs/no-new-privileges.
- [x] Удалены 22 заменённых deploy/env/nginx/backup/storage/dev/native/audit/prod-status файла из утверждённого списка Commit 7.3; synthetic seed остаётся единственным автоматическим seed, а demo dataset проходит отдельные schema/PII/path/approval/archived/completed проверки до любой записи.
- [x] Backup создаёт PostgreSQL custom dump и SHA-256, restore проверяет checksum, isolated `nn-product-reset-eval-*` project и пустую БД до `pg_restore`; smoke проверяет health, frontend, unauthenticated `401` и authenticated story request.
- [x] Clean-deploy rehearsal строит sanitized temporary source без real env и AppleDouble, выполняет fresh `--no-cache` build трёх production images, migration, synthetic seed, production-safe ephemeral smoke credential, health/auth smoke, backup/checksum, restore только в новую пустую БД, повторный authenticated smoke и exact count comparison; оба Compose project завершаются `down -v`.

### TDD и фактическая проверка Commit 7.3

- Начальный operations/dataset RED дал `20 failed, 1 passed`; после реализации validator/importer focused dataset boundary завершился `12 passed`, а operations contracts последовательно закрепили isolated project/empty restore, sanitized source, canonical demo Compose, production Dockerfiles/no runtime bind-mount, explicit Alembic config, production security guards и nginx writable tmpfs.
- Rehearsal честно обнаружил и закрыл четыре инфраструктурных расхождения: AppleDouble ломал BuildKit context; Colima не видел bind-mount из host `${TMPDIR}`; local dev Compose не доказывал demo path; read-only nginx не мог сгенерировать `/etc/nginx/conf.d`. Итоговый gateway упаковывает конфигурацию в image, поэтому demo runtime не зависит от host bind-mount.
- Production guards отдельно остановили insecure HTTP CORS/cookie и прямой synthetic seed. Итоговый rehearsal не ослабляет guards: seed выполняется одноразово с `ENVIRONMENT=development`, все synthetic users деактивируются, для `astra` генерируется не сохраняемый в artifacts случайный rehearsal-only пароль, и production startup принимает только этого активного пользователя с недефолтным hash.
- Финальный focused backend gate: `141 passed, 1 skipped` для operations, demo dataset, seed policy, migration baseline, repository policy и runtime setup. Все три Compose config-команды и `bash -n` всех актуальных deploy scripts завершились с exit `0`.
- Exact rehearsal `nn-product-reset-eval-local` завершился exit `0`: `fresh_build`, migration, synthetic seed, health smoke, backup checksum, empty restore, post-restore counts и post-restore smoke — `passed`; smoke до/после содержит `authenticated=true`.
- Counts до/после restore совпали: users `8`, rubrics `4`, stories `35`, archived `5`, scenarios `35`, scenario rows `0`. Ignored evidence сохранена в `artifacts/product-reset/CP7/ops`; source-preparation зафиксировал `appledouble_files=0`, `real_env_files=0`.
- CP7 runner/binding, full suite, docs/dependency/license gate и внешний demo намеренно не запускались: это границы Commit 7.4–7.5 и отдельного внешнего разрешения.

### Source correction после final review Commit 7.3

- Final review вернул Critical/Important/Minor `0/4/1`: пять findings про executable Git modes backup/restore, неполный env/secret sanitizer, узкий identity/path validator, несовместимый с exact EXT.1 smoke CLI и stale dump/evidence selection.
- TESTS-ONLY RED зафиксирован как `19 failed, 25 passed`: отдельно воспроизведены оба mode `100644`, `.env.production`/nested env/secret-like fixtures, nested identity/contact/path matrix, exact `smoke.sh --compose-file deploy/compose.demo.yaml` и stale/AppleDouble backup layout.
- Source correction переводит sanitized staging на `git archive` exact HEAD, требует полностью clean tracked/untracked-nonignored tree, фактически считает env/secret/AppleDouble в распакованном tree и fail closed; `.gitignore` и все три Docker contexts сохраняют только `*.env.example`.
- Demo validator рекурсивно закрывает расширенные identity/contact keys и Unix/Windows/home paths, сохраняя допустимые ISO timestamps и публичные HTTPS URL. Canonical smoke получает безопасные project/env defaults и обнаруживает loopback gateway port, а top-level Compose name связывает exact raw EXT.1 exec с тем же stack.
- Rehearsal создаёт уникальный run directory, снимает stale latest marker до работы, пишет exact dump/checksum без `find`, публикует atomic `latest-run.txt` только после полного успеха и связывает result с exact evaluated HEAD.
- GREEN source gate: operations + dataset `45 passed`; три Compose config и `bash -n` всех актуальных shell scripts завершились exit `0`.
- Source correction зафиксирован отдельным коммитом `285013047387765bf07db17cb1bcfc35b5324743` (`fix(ops): harden clean rehearsal contracts`) без amend исходного Commit 7.3.
- Clean-HEAD rehearsal `nn-product-reset-eval-local` выполнен на exact source `285013047387765bf07db17cb1bcfc35b5324743`, run `20260724T073133Z-285013047387-f2c7266c`, exit `0`: `fresh_build`, migration, synthetic seed, health smoke, backup checksum, empty restore, post-restore counts и post-restore smoke — `passed`; authenticated smoke до/после restore — `true`.
- Restore сохранил exact counts: users `8`, rubrics `4`, stories `35`, archived `5`, scenarios `35`, scenario rows `0`. Source preparation фактически зафиксировал `appledouble_files=0`, `real_env_files=0`, `secret_like_files=0`; поиск evidence не обнаружил локальных `/Users`, `/Volumes`, `/var/folders`, smoke password или private key.
- Backup run содержит только exact `postgres.dump` и `postgres.dump.sha256`; `shasum -a 256 -c` вернул `postgres.dump: OK`. Созданные SMB после завершения ignored AppleDouble companions подтверждены через `git check-ignore`, удалены и не участвовали в выборе dump/checksum либо latest-run pointer.
- Cleanup не оставил containers, volumes или networks обоих isolated Compose projects. Final review gate Commit 7.3 закрыт; CP7 runner/full backend suite намеренно не запускались на этой границе.
- Повторное review выявило один Important gap: runtime validator был уже, чем synthetic policy, для коротких absolute/relative paths и compact contact/identity keys. Новый TESTS-ONLY matrix дал `13 failed, 25 passed` на `/secret.mov`, `/srv`, `../private.mov`, `./private.mov`, `mail`, `mobile`, `whatsapp`, `colleague_id`, `real_name`, `family_name` и camelCase-эквивалентах.
- Последующая fail-closed цепочка review-fixes закрыла более широкий фактический
  boundary: embedded absolute/share/home/current/parent path fragments
  обнаруживаются внутри prose без ложного запрета обычных slash/HTML; URL
  hostname проходит strict percent/UTF-8 normalization и отклоняет credentials,
  malformed ports, forbidden/control codepoints и numeric-like local forms;
  разрешаются только public global IP либо syntactically public FQDN минимум из
  двух labels. DNS lookup намеренно не выполняется, поэтому это structural
  sanitizer, а не проверка фактического владельца/маршрута hostname.
- Финальный source SHA validator chain:
  `8f16c5a94dd6b16439610f96d3a2a3cabd66913f`. Focused gate завершился
  `124 passed`, расширенный boundary — `324 passed`; exhaustive manual review
  принят с Critical/Important/Minor `0/0/0`.
- Full clean-deploy rehearsal не повторялся: corrections после exact rehearsal
  меняют только pre-import structural validation JSON и tests, не затрагивают
  deploy, Compose, backup/restore, smoke или rehearsal orchestration.

### Реализованная и проверенная граница Commit 7.4

- [x] Python 3.11 runtime и development dependencies закреплены с exact versions
  и SHA-256 в `requirements.lock` / `requirements-dev.lock`; `PyYAML` объявлен
  прямой development dependency, потому что operations/repository tests
  импортируют `yaml`.
- [x] Оба backend Dockerfile устанавливают runtime lock с
  `--require-hashes`; CI устанавливает development lock и запускает
  `check_dependency_licenses.py`.
- [x] Автоматический dependency/license gate сверяет direct Python/npm
  manifests, frontend lock root, installed Python license metadata и
  `THIRD_PARTY_NOTICES.md`.
- [x] Созданы текущие architecture, CaptionPanels, third-party notices и
  permission-gated demo runbook; README, engineering, Git, local development,
  deployment и smoke docs переписаны под один Product Reset runtime.
- [x] Удалены 29 заменённых документов: legacy migration/state/workflow docs,
  два old contracts, весь `docs/archive/2026-04`, пять old implementation plans
  и шесть old design specs. Git history остаётся архивом.
- [x] Architecture/operations inventories получили финальную сверку, а
  denylist запрещает возвращение удалённых doc paths.

### TDD и фактическая проверка Commit 7.4

- Начальный tests-first gate: `7 failed, 1 passed` на отсутствующих PyYAML
  input, locks/canonical install paths, checker/notices, current docs и approved
  deletions. Отдельный inventory/denylist RED: `1 failed`.
- Focused GREEN:
  `pytest -q tests/test_dependency_policy.py tests/test_current_docs.py tests/test_repository_policy.py`
  — `16 passed`; license checker — `OK`; `pip check` — без конфликтов.
- Clean Python `3.11.15` environment в `/tmp` установил
  `requirements-dev.lock` с `--require-hashes`; compileall `app migrations
  scripts`, `pip check`, те же `16` tests и checker завершились exit `0`.
- Workspace `npm ci` честно остановился с filesystem-only `ENOTEMPTY`: SMB
  создавал игнорируемые AppleDouble `._*` внутри удаляемого `node_modules`.
  Чистая `/tmp` копия тех же `package.json`/`package-lock.json` завершила
  `npm ci`, `npm ls --all`, `118` component tests и build
  (`155 modules transformed`) с exit `0`.
- `npm audit` зафиксировал `9` findings во всём tree и `2` transitive runtime
  findings через не импортируемый приложением markdown subtree
  `@tiptap/pm`; `npm audit fix --force` не применялся. Major Vite/Vitest и
  unsupported transitive overrides требуют отдельного test-first checkpoint.
- Local, test и demo Compose config завершились exit `0`; current-doc stale
  reference grep пуст, `git diff --check` проходит.
- CP7 runner/binding и внешний demo не выполнялись. До Commit 7.5
  `local_hard_gates_passed=false`, `hard_gates_passed=false`,
  `full_eval_passed=false`; external demo остаётся `blocked_permission`.

### Review-fix границы Commit 7.4

- Review RED зафиксировал `13 failed, 5 passed`: test Compose устанавливал
  mutable inputs, direct specifiers не сверялись с exact lock versions,
  `pyproject.toml` не был связан с runtime inputs, npm license metadata не
  читалась из direct lock entries, Python notices не покрывали runtime
  transitives, Onest/OFL не входили в automated gate, а restore runbook и
  operations inventory неточно описывали isolated restore/latest pointer.
- Дополнительный RED отдельно закрепил расхождение одного runtime package между
  runtime/dev locks; lowercase-only project-name guard воспроизвёл
  несовместимый timestamp runbook.
- `compose.test.yaml` теперь устанавливает только `requirements-dev.lock` с
  `--require-hashes`. `packaging` объявлен direct dev dependency, а
  `pip-tools==7.5.2` закрепляет инструмент регенерации; оба locks заново
  получены Python 3.11 документированной командой `pip-compile
  --generate-hashes`.
- Policy теперь проверяет direct input specifiers, exact reconciliation
  `pyproject.toml`, идентичность всех runtime package/version в runtime/dev
  locks, direct npm lock entry/license/notices и установленный Python inventory.
  Покрыты `32` Python packages: `26` runtime packages с транзитивными и `6`
  дополнительных direct dev tools. Bundled Onest и OFL привязаны к exact
  SHA-256 и notice `OFL-1.1`; negative metadata/hash cases fail closed.
- Backup runbook использует exact `--output-file`; low-level restore поднимает
  только БД отдельного lowercase `nn-product-reset-eval-*` project с теми же
  compose/env и гарантированным `down -v` trap. Full counts/auth smoke отданы
  каноническому `rehearse_clean_deploy.sh`. Exact dump/checksum принадлежат
  backup-скрипту, atomic latest pointer — rehearsal orchestration.
- Clean Python `3.11` environment установил development lock с
  `--require-hashes`; compileall, `pip check` и metadata/license checker прошли.
  Focused dependency/current/repository/operations gate: `47 passed`. Frontend
  manifests и lock не менялись, поэтому component/build повторно не
  запускались; их direct npm metadata проверена checker по существующему exact
  `package-lock.json`. Local/test/demo Compose config прошли.
- Review-fix не запускает Commit 7.5, CP7 runner/binding или внешний demo.
  `local_hard_gates_passed=false`, `hard_gates_passed=false`,
  `full_eval_passed=false`; external demo остаётся `blocked_permission`.

### Финальный review-fix toolchain/runbook Commit 7.4

- Следующий tests-first gate дал `6 failed, 14 passed`: lock-generation
  toolchain не закреплял pip/setuptools, headers/docs не содержали
  `--allow-unsafe`, Python inventory ожидал ещё два direct tools, а backup
  example использовал `BACKUP_DIR` до определения.
- Отдельный executable RED на чистом Python 3.11 environment с pip `26.0.1` и
  pip-tools `7.5.2` воспроизвёл offline empty-input failure:
  `PackageFinder` не имел `allow_all_prereleases`.
- Direct dev inputs теперь закрепляют совместимую тройку `pip==25.3`,
  `setuptools==80.9.0`, `pip-tools==7.5.2`; оба lock headers и обе
  документированные команды используют `--allow-unsafe`. Clean dev-lock install
  понизил первоначальный pip `26.0.1` до `25.3`, после чего offline smoke прошёл.
- То же clean environment дважды регенерировало оба real locks byte-identical:
  SHA-256 runtime `8133ec95056fd944865f2821faa7815316e05467936d6c11484d7bdbdf04e4e5`,
  development
  `30fc043a2308e9c611cfadb4590980c7f8e58d713748a65f38502a5bc250c578`.
- Финальный dependency/current/repository/operations gate: `48 passed`;
  compileall, checker и `pip check` прошли, установленная версия pip — `25.3`;
  local/test/demo Compose config прошли.
- Backup example теперь определяет synthetic `${HOME}` directory вне repository
  до вычисления exact output file; deploy/backup не выполнялись.
- Этот review-fix также не запускает Commit 7.5, CP7 runner/binding или внешний
  demo; все три final flags остаются `false`, external demo —
  `blocked_permission`.

### Commit 7.5 — исходный шаблон перед локальным запуском CP7

- Сначала добавленные RED-проверки закрыли ложнозелёную границу, учитывавшую
  только UX: без схемы команд CP7, привязки эксплуатационных артефактов и
  проверки порядка предков Git результат был `6 failed, 1 passed`; отдельная
  проверка загрузчика эксплуатационных артефактов дала `1 failed`.
- Целевые GREEN-проверки: модуль оценки CP7 — `40 passed` (`254 deselected`),
  доказательства UX — `33 passed`, эксплуатационный контракт — `28 passed`.
  Модуль оценки теперь отдельно запускает backend pytest/compileall/pip/license,
  чистый `npm ci`, компонентные тесты, сборку, оба полных проекта Playwright,
  корневую проверку Compose и каноническую clean-deploy репетицию.
- Обход ограничения SMB является частью воспроизводимого контракта: исходники
  frontend извлекаются командой `git archive HEAD` во временный каталог `/tmp`
  с SHA в имени. Затем `npm ci`, `npm test -- --run`, сборка и браузерные
  проверки выполняются раздельно на одной точной зафиксированной версии.
  Исполнитель удаляет временный каталог в `finally` как после успеха, так и при
  ошибке запуска; рабочий `node_modules` не считается доказательством чистой
  установки.
- Эксплуатационные доказательства закрывают gate при любой ошибке и связывают
  последний уникальный запуск с точным SHA исходников. После фактической
  остановки репетиция проверяет значимые логи и отсутствие
  containers/volumes/networks, затем создаёт манифест SHA-256 для `result`,
  `counts` до/после, `smoke` до/после, подготовки исходников, точных
  dump/checksum, логов выполнения source/restore для
  `db`/`backend`/`frontend`/`gateway` без префикса Compose и остальных значимых
  логов. Только после этого публикуется указатель latest. Валидатор также
  закрывает gate при traceback Python с префиксом Compose, временных метках
  PostgreSQL severity, nginx error severity и необработанном исключении. Если
  предварительная проверка обнаруживает грязное дерево, предыдущий валидный
  указатель сохраняется. Новый указатель публикуется атомарно через уникальный
  обычный файл `mktemp` только после манифеста; предсказуемая символическая
  ссылка `.tmp` не читается и не перезаписывается. При ошибке проверки очистки
  trap повторяет `down -v`, поскольку флаги CLEANED выставляются только после
  обеих успешных проверок ресурсов.
- Доказательства UX входят в неизменяемое поддерево CP7 как точный манифест:
  SHA исходников, SHA-256 `UX_EVAL_RU.md`, фактические `ux_total/categories` и
  все 12 артефактов before/after/axe с `id/path/digest`. Обычная команда
  `verify` сравнивает манифест с текущими файлами, а до отдельного commit
  привязки закрывает gate сообщением
  `CP7 immutable binding commit ещё не закреплён`.
- Загрузчики UX и эксплуатационных доказательств отклоняют символическую ссылку
  в корне доказательств, любом родителе и отдельном файле. Корень UX обязан
  содержать ровно 12 обычных файлов и только каталоги
  `before`/`after`/`axe`; каталог эксплуатационного запуска — точный набор
  файлов манифеста и только каталог `backup`. AppleDouble не считается
  доказательством.
- После выполнения CP7 поле `operations_findings` очищается только при полностью
  успешных локальных доказательствах. Защита Git запрещает изменения runtime
  после проверки: A→B обязан изменить только `EVAL_RESULT.json`, а B→C допускает
  только документированный список файлов привязки.
- Рабочий исторический реестр расширен точной привязкой CP6
  `837e0117c01e473c93f0469df4847e858f2654b5` и проверенным исходным commit
  `1d97ecc18662f5530870e24aff4126f94b2bc4cc`; CP7 требует неизменное поддерево
  CP6 и порядок предков «привязка → исходники CP7».
- Текущая запись содержит только исходный шаблон. CP7 ещё не завершён:
  `CP7_BINDING_COMMIT=null`, доказательства команд отсутствуют,
  `local_hard_gates_passed=false`, внешний демоконтур остаётся
  `blocked_permission`.

### Commit 7.5 — предварительная коррекция после первого запуска на точном SHA

- Первый запуск CP7 на чистом точном исходном commit
  `5780c045e8b04ff4172f5fcb2e8e544da8c0d0ef` остановлен на первой
  опубликованной границе с ошибками; `EVAL_RESULT.json` не записан. Полный набор
  backend, workspace compileall и dependency/license checker вернули exit `1`;
  `pip check` прошёл.
- Целевая диагностика локализовала две средовые причины. Общий Python 3.11
  `.venv` расходится с `requirements-dev.lock` (включая pip `26.1.2` вместо
  `25.3`), поэтому dependency policy/checker остаются красными до отдельной
  установки по lock. Workspace compileall на внешнем томе видит ignored
  AppleDouble `._product_reset_eval.py` с NUL и получает `EPERM` при записи в
  существующий `__pycache__`.
- Tests-first RED для точной команды CP7 и очистки дал `3 failed`. Минимальная
  коррекция выполняет compileall по SHA-namespaced `git archive HEAD` в `/tmp`,
  использует интерпретатор исходного locked venv, направляет
  `PYTHONPYCACHEPREFIX` внутрь временного корня и удаляет backend temp после
  успеха и ошибки запуска. Целевой GREEN — `3 passed`; точный production
  executor `/bin/sh -lc` с полным archive compileall завершился exit `0`.
- Эта коррекция не меняет продукт, `EVAL_RESULT.json`, binding или итоговые
  флаги. CP7 остаётся pending; общий `.venv` ещё не изменён, повторный runner до
  source review и lock-aligned environment не запускается.

### Commit 7.5 — диагностика первого полного CP7 runner

- После review compileall-коррекции общий Python 3.11 `.venv` выровнен строго по
  `requirements-dev.lock --require-hashes`. Полный runner выполнен на чистом
  exact source `4a659f6161d7163f12aecae11521d33b09c79e0a` и впервые дошёл до
  всех локальных команд: backend — `825 passed`, archive compileall, `pip
  check`, dependency/license policy, чистый `npm ci`, `118` component tests,
  build (`155 modules transformed`) и root Compose config прошли.
- Runner fail-closed записал отрицательный `EVAL_RESULT.json`: оба полных
  Playwright project остановились при collection, а clean-deploy rehearsal —
  при production backend build. Поэтому `local_hard_gates_passed=false`;
  внешний demo по-прежнему не запускался. Операционный запуск
  `20260724T140051Z-4a659f6161d7-76cf1e6e` корректно не опубликован как
  successful latest и не оставил containers, volumes или networks.
- Причина rehearsal воспроизведена отдельно: SQLAlchemy `2.0.51` на Linux
  `aarch64`/`x86_64` требует `greenlet>=1`, но hash-locked runtime graph его не
  содержал. Tests-first проверка обеих deployment-архитектур была красной, после
  явного direct input `greenlet>=1,<4.0`, повторной генерации обоих locks и
  license/notice inventory стала зелёной. В locks закреплён
  `greenlet==3.5.4`; sanitized Linux/aarch64 production Docker build прошёл.
  Source commit:
  `0d902fb70f1dc724f52d0928461569c2e7ddfb57`.
- Причина browser collection также воспроизведена точно:
  `playwright.config.ts` ошибочно включал helper
  `fixtures/current-editor.ts` в `testMatch`, а helper дополнительно
  регистрировал собственный фиктивный test. Fail-closed contract сначала
  упал, затем закрепил только `**/*.spec.ts` и чистоту fixture.
- После исправления collection полная матрица выявила три устаревших
  test-contract: notification mock не отвечал на текущий
  `GET /api/v1/stories/create-options`; substring locator путал
  `Ролик готов` с допустимым correction action; characterization-тест ставил
  курсор в конец визуальной строки rich-text ячейки. Продуктовый runtime не
  менялся. Exact route, scoped exact locator и пользовательская операция
  «выделить всё → свернуть выделение вправо» закрыли причины тестов.
- Финальная чистая `/tmp` browser-матрица source commit
  `b78bc324bde74300171ddf396294384c8a7d46cb`: Chromium 1366 —
  `25 passed, 1 skipped`; Chromium 1920 — `25 passed, 1 skipped`.
  Проблемный editor-сценарий дополнительно прошёл `5/5` повторов. Dependency
  policy — `15 passed`; CP7/Playwright contracts — `41 passed`; `pip check`,
  dependency/license checker и `git diff --check` прошли. Два независимых
  read-only review: dependency diff — без замечаний; browser finding о fixture
  закрыт тем же tests-first изменением.
- Отрицательный runner-owned `EVAL_RESULT.json` намеренно не входит в source
  commits. Его причины полностью перенесены в этот журнал; перед повторным
  runner рабочее дерево будет возвращено к исходному pending-шаблону без
  смешивания source и evidence commits.

### Commit 7.5 — локальный CP7 runner и immutable evidence

- Предварительная exact-HEAD rehearsal на source
  `c4a097eb5cee226c884adadf0ac79958b8a71e53`, run
  `20260725T072418Z-c4a097eb5cee-89b6eb32`, прошла fresh build, migration,
  synthetic seed, health, backup checksum, empty restore, equal counts,
  post-restore smoke и полный cleanup.
- Полный CP7 runner на том же exact source завершил все 11 команд с exit `0`:
  backend `826 passed`; archive compileall, `pip check` и license policy;
  чистый `npm ci` (`236` packages), frontend `118 passed`, build
  (`155 modules`); Chromium 1366 и 1920 по `25 passed`; Compose config и
  clean rehearsal. Runner rehearsal:
  `20260725T090315Z-c4a097eb5cee-adfb9934`, manifest SHA-256
  `11948e44e17996a1f729537231839a7d4583eb01a1d18cc361d4ba1663e27c18`.
- Runner-owned результат сохранил `local_hard_gates_passed=true`,
  `operations_findings=[]`, UX `90/100` при каждой категории `>=8` и только
  `failed_gates=["external_demo"]`. Evidence зафиксирована отдельным commit
  `2194f5986146c3677bc7da794683bf00d164ae30`; его diff содержит только
  `docs/product-reset/EVAL_RESULT.json`.
- Verify без Docker-доступа ожидаемо не смог запустить read-only cleanup-check.
  Повтор с Docker-доступом устранил средовую причину и до pin вернул ровно
  `CP7 immutable binding commit ещё не закреплён`. Tests-first binding contract
  сначала воспроизвёл `CP7_BINDING_COMMIT=None`, затем закрепил exact evidence
  commit `2194f5986146c3677bc7da794683bf00d164ae30`.
- Локальные hard gates закрыты. `hard_gates_passed=false` и
  `full_eval_passed=false` остаются правильными, потому что внешний demo не
  разрешён и имеет статус `blocked_permission`.
- После binding независимый review воспроизвёл три stale historical assertions:
  tracked CP1/CP5/CP6 tests всё ещё связывали текущие top-level поля документа с
  прошлым checkpoint. Immutable historical subtrees были корректны. Assertions
  удалены tests-first без ослабления pinned subtree/binding проверок: CP1/CP5 и
  CP6/CP7 focused пары прошли. Risk register также очищен от четырёх
  remaining-actions, уже закрытых CP7 boundary.
- Exact binding HEAD checkpoint verify завершился `passed=true`, `errors=[]`.
  Final verify закономерно вернул только `full_eval_passed имеет значение
  false`; это соответствует единственному `failed_gates=["external_demo"]`.
- Первый post-binding полный backend-прогон выявил ещё один stale reconstruction
  helper: шаблон CP4 наследовал текущие положительные top-level gate flags из
  CP7 `EVAL_RESULT.json`. Прогон остановлен после первого точного failure
  (`433 passed`, `2 skipped`), а CP4 и превентивно CP5 стали явно сбрасывать
  `local_hard_gates_passed`, `hard_gates_passed` и `full_eval_passed` при
  реконструкции исторического source template. Focused RED→GREEN:
  `2 passed`; повторный полный backend-набор: `826 passed`, `2 skipped` за
  `7375.20s`. Текущий CP7 evidence и продуктовый runtime не менялись.
- Post-binding test-consistency зафиксирован commit
  `ea6695c12684422167b583bb0f5a6a6fb6b26663`. Checkpoint verify на точном HEAD
  повторно завершился `passed=true`, `errors=[]`; final verify вернул только
  ожидаемое `full_eval_passed имеет значение false`.
- Финальный независимый read-only аудит сверил CP1–CP7, все 12 UX artifacts и
  operations manifest с их SHA-256: незакрытых локальных требований не найдено,
  runtime drift после evidence commit отсутствует. Повторные CodeRabbit review
  post-binding range подключались с подтверждённой авторизацией, но не получили
  результат от review-сервиса до timeout; это не изменило локальный evidence.

### EXT.1 — authorized demo checkpoint template

- Permission reference `codex-thread-019f502e-78c0-7781-aad9-384296db58d9:ext-demo:2026-07-26`
  и exact locally evaluated application SHA
  `c4a097eb5cee226c884adadf0ac79958b8a71e53` закреплены в
  `DEMO_EVIDENCE.json` без hostname, IP, credentials, contacts, real paths,
  dataset или screenshots.
- External dataset validation, backup, deployed SHA, unauthenticated `401`,
  default-credentials rejection, authenticated story read, обе desktop
  resolutions и CaptionPanels latest scenario остаются `pending`. Template
  требует, чтобы dataset и screenshots оставались untracked.
- Eval сохраняет immutable CP7 subtree и post-binding drift guard. Пока
  template pending, `failed_gates=["external_demo"]`,
  `local_hard_gates_passed=true`, `hard_gates_passed=false` и
  `full_eval_passed=false`; final verification fail-closed.

### EXT.2 — authorized external demo evidence

- Exact application SHA
  `c4a097eb5cee226c884adadf0ac79958b8a71e53` развёрнут из отдельного
  clean checkout; pre-deploy backup проверен как PostgreSQL custom-format,
  checksum зафиксирован в redacted evidence.
- На чистой PostgreSQL валидированный sanitized dataset импортировал
  `5` обезличенных пользователей, `2` завершённых сюжета и `9` строк.
  Dataset и validation report защищены режимом `600`; реальные контакты,
  пути, hostname, IP и credentials в tracked evidence не записаны.
- Canonical smoke подтвердил health/root `200`, unauthenticated `401` и
  authenticated story read. Три default credential probe получили `401`
  без session cookie.
- Реальный Chromium проверил `1366x768` и `1920x1080`: горизонтального
  overflow нет, в чистой авторизованной вкладке console errors/warnings
  отсутствуют. Screenshot hashes записаны, сами screenshots остаются
  ignored и untracked.
- CaptionPanels проверен через штатный цикл restore → import → archive:
  export совпал с текущей revision `1` и тремя сегментами, exact opened
  marker обновился; сюжет после проверки возвращён в архив.
- Источник demo-данных ограничен: один разрешённый архивный сценарий имеет
  пустые строки, второй содержит только короткие служебные строки. Это
  остаётся риском содержательности демонстрации, но не ослабляет
  privacy/completion/exact-SHA gates и не заменяется синтетическими или
  неподтверждёнными рабочими сюжетами.

### CORR.1 — восстановление утверждённого табличного редактора

- После пользовательской проверки выявлено продуктовое расхождение: Product
  Reset заменил привычный плотный табличный редактор новым представлением,
  хотя `SPEC_RU.md`, `AGENTS.md` и characterization-контракт требуют сохранить
  прежнее рабочее поведение редактора и CaptionPanels. Исправление выполнено
  внутри текущей модели данных без параллельного v2-контура.
- Восстановлены пять колонок `№ / Блок / Текст / Имя файла / TC / В кадре`,
  компактные действия строки, одна общая sticky-панель форматирования, пять
  кнопок добавления типов, ширины/resize с localStorage, Ctrl/Cmd
  multi-selection и прежние keyboard/focus semantics.
- На новую модель одного актуального сценария перенесены структурированные
  поля `ЗК+гео`/`СНХ`, TipTap rich text, форматирование выделения и строк,
  несколько файлов с таймкодами и стабильные `segment_uid`. Ответ autosave
  по-прежнему не заменяет открытый редактор; устаревший ответ не может
  перезаписать свежий ввод.
- Tests-first закрыты регрессии синхронизации `text_lines`, HTML escaping,
  default-форматирования СНХ, форматирования нескольких выбранных строк,
  сохранения позиции при пустом ФИО, порядка обратного Ctrl/Cmd-выбора,
  возврата фокуса после add/duplicate/move/delete и каретки после `+`.
  Восстановлены старые placeholders, разделитель таймкодов, select chevron,
  focus outline и плотность структурированных строк.
- Локальные commits:
  `0abdec4` (`fix(editor): restore established table workflow`),
  `4132098` (`fix(editor): address local review findings`) и
  `69a7fb2` (`test(editor): harden browser storage coverage`).
- Проверки текущего кода:
  backend — `848 passed, 2 skipped`; frontend — `130 passed`; production build
  — `156 modules transformed`; Compose config — exit `0`; полная Playwright
  matrix на Chromium 1366/1920 — `52 passed, 2 skipped`, `0 failed`.
  BFCache-сценарий штатно пропущен обоими browser projects, когда Chromium не
  предоставил BFCache.
- Реальный browser characterization теперь отдельно проверяет TipTap
  selection marks, multi-row formatting, resize persistence, file bundles,
  нормализацию таймкода и structured conversion на обеих утверждённых ширинах.
  Визуальный осмотр локального Compose подтвердил пять колонок и отсутствие
  горизонтального overflow на 1366.
- Независимый read-only review после коррекции завершён без findings.
  CodeRabbit review точного diff сначала поднял `5` issues, затем `2` minor;
  все валидные issues закрыты tests-first. Предложение сохранять гео при
  переходе через другой тип отклонено, потому что старый редактор также
  очищал гео и обратное изменило бы утверждённый контракт. Финальный
  CodeRabbit pass для последнего commit: `0 issues`.
- Текущий внешний demo и `EVAL_RESULT.json` остаются исторически валидными
  только для application SHA `c4a097eb5cee226c884adadf0ac79958b8a71e53`.
  Они не являются external evidence для текущего HEAD `69a7fb2`; новый deploy,
  PR, merge или push не выполнялись. Для полного зелёного eval текущего кода
  потребуется отдельное разрешение на новый clean-deploy/demo и новая
  exact-SHA evidence.
- Fail-closed `product_reset_eval.py verify --scope final` ожидаемо завершился
  exit `2`: вычисленное финальное состояние для текущего runtime не совпадает
  с историческим `full_eval_passed=true`. Это подтверждает, что evidence старого
  demo не засчитана новому HEAD автоматически.

### CORR.2 — синяя шапка, sticky-форматирование и рубрики CaptionPanels

- После визуальной проверки владельца восстановлена синяя шапка непосредственно
  над таблицей: редактируемые `Название` и `Рубрика`. Хронометраж не возвращался,
  потому что его нет в утверждённой Product Reset модели. Цвет шапки сохранён
  из прежнего редактора: `rgb(190, 220, 230)`.
- Общая панель действий и форматирования теперь рендерится до выбора строки и
  остаётся sticky ниже desktop-шапки приложения. Без активного поля инструменты
  видимы, но disabled; после выбора работают с прежним selection/focus
  контрактом. Реальный browser при `1280x800` и прокрутке подтвердил:
  app header bottom `63px`, toolbar top `75px`, toolbar visible.
- Постоянный крупный блок CaptionPanels удалён. Штатная интеграция не удалялась:
  компактное предупреждение появляется только для подходящего сюжета, когда
  сценарий действительно изменился после последнего открытия в CaptionPanels.
- Канонический список взят из CaptionPanels
  `cep_src/shared/config.json`: `Новости`, `Специальный репортаж`,
  `Транснефть помогает`, `Волонтеры Транснефти`, `Люди компании`,
  `Новость дня`, `Оптимум`, `Спорт`. Synthetic demo seed создаёт эти восемь
  активных рубрик в указанном порядке и деактивирует прежние synthetic
  значения; администраторские дополнительные рубрики по-прежнему допустимы.
- Сохранение названия и рубрики использует текущий metadata endpoint и не
  перезагружает редактор. Tests-first закрыты гонки ответов: устаревший успешный
  ответ названия не заменяет последнее сохранение, а старая ошибка рубрики не
  откатывает более новый выбор. Сохранённый заголовок сразу обновляется и над
  редактором.
- Локальный implementation commit:
  `bbe6f5f1a10f9060b2b8ec813006137c125432ea`
  (`fix(editor): restore sticky table controls`).
- Проверки текущего кода: backend — `848 passed, 2 skipped`; frontend —
  `135 passed`; production build без очистки занятого SMB-artifact —
  `157 modules transformed`; Compose config — exit `0`; полная Playwright
  matrix — `54 passed, 2 skipped`, `0 failed`; отдельно editor browser
  characterization — `8 passed`.
- Обычная очистка `frontend/dist` в `npm run build` остаётся средово
  заблокирована тремя ignored `.smbdelete*`, удерживаемыми macOS
  Virtualization. TypeScript и Vite production build полностью прошли с
  `--emptyOutDir false`; исходники и tracked artifacts не затронуты.
- CodeRabbit сначала выявил две валидные гонки/рассинхронизации; обе закрыты
  tests-first. Повторный review оставил одно minor-предложение продублировать
  fallback пустого массива рубрик в родителе. Оно отклонено как
  невоспроизводимое: `ScenarioMetadataHeader` уже делает этот fallback сам.
- Push, PR, merge, deploy и обновление external demo evidence не выполнялись.
  Историческая exact-SHA evidence по-прежнему не относится к новому HEAD.
- Финальный fail-closed verify на новом локальном HEAD завершился ожидаемым
  exit `2` только с `full_eval_passed` errors: старый external demo не
  засчитан новому application SHA автоматически.

### CORR.3 — семантическая история без пользовательских номеров редакций

- Технические revision anchors сохранены в API, autosave, workflow commands и
  production read markers, но удалены из workflow summary, карточек истории,
  notification tray и restore dialog. Открытый diff использует единственный
  вторичный anchor `Сохранённые состояния X → Y`; restore остаётся append-only.
- История теперь строит fixed-order semantic projection видимых полей сценария:
  тип блока, гео, ФИО и должность СНХ, текст, имя файла/TC и `В кадре`.
  Formatting-only изменения сохраняют читаемый текст и разрешённое оформление.
  Raw `structured_data`, `formatting`, `rich_text`, HTML и неизвестные поля или
  типы не выводятся.
- Локальные commits Tasks 1–3:
  `1e31338` (`fix(history): hide technical revision numbers`),
  `25fa70f` (`feat(history): derive semantic scenario changes`),
  `07d0326` (`test(history): guard semantic projection`) и
  `604ff4e` (`fix(history): render readable scenario changes`).
- RED Task 1: backend history contract — `1 failed, 9 passed`, потому что
  confirmation ещё говорил о новой редакции; frontend workflow/notification/
  history contract — `7 failed, 20 passed`, потому что UI показывал
  `редакция 6`, диапазоны `Редакции X → Y` и старый restore copy. GREEN:
  targeted backend `10 passed`, targeted frontend `27 passed`.
- RED Task 2: test import сначала получил
  `Failed to resolve import "./semanticScenarioDiff"`. После mapper GREEN —
  `5 passed`; четыре mutation RED отдельно доказали выбор plain text вместо
  raw HTML, newline между file bundles, фильтрацию unknown formatting и
  безопасный label неизвестного типа. Финальный targeted GREEN — `8 passed`.
- RED Task 3: component renderer — `3 failed, 10 passed` на отсутствующих
  semantic moved label, before/after formatting sides и semantic label СНХ.
  Отдельный Playwright RED не запускался; это остаётся процессным риском.
  Targeted component GREEN — `4 files / 36 passed`.
- Независимые read-only reviews приняли Tasks 1–3. В Task 2 первый review round
  дал четыре замечания, все закрыты adversarial tests. Запуски CodeRabbit для
  Tasks 1 и 2 были аутентифицированы, но завершены по bounded timeout без
  итогового результата;
  это не считается успешным review. CodeRabbit Task 3 после одного
  rate-limit retry завершился с `0 issues`.
- Отложенные minor: удаление dead `.history-revisions` из Task 1 выполнено в
  Task 3; остаются отдельные browser assertions для allowed/unknown font и
  fill, значения `В кадре` и computed formatting style. Незакрытого
  продуктового расхождения по ним не выявлено.
- Финальная локальная проверка текущего HEAD: backend —
  `848 passed, 2 skipped`; frontend — `20 files / 144 passed`; Compose config —
  exit `0`; `/api/health` — `200 {"status":"ok"}`; db/backend/frontend —
  `healthy`.
- Стандартный `npm run build` прошёл TypeScript и трансформацию `158 modules`,
  но завершился exit `1` только при очистке занятого
  `frontend/dist/.smbdeleteAAA3fc0035`:
  `Unknown error: Resource busy`. Busy SMB-файл и macOS Virtualization process
  не удалялись и не останавливались. Безопасный
  `npm run build -- --emptyOutDir false` завершился exit `0`,
  `158 modules transformed`.
- In-app Browser actual-UI попытка на
  `http://127.0.0.1:5173/stories/1/scenario` вернула точное
  `No browser is available`; после штатной диагностики
  `agent.browsers.list()` вернул `[]`. Поэтому ручная Browser-сессия и
  screenshots в этой задаче недоступны и не подменяются fallback-проверкой.
- Repo Playwright fallback выполнен на безопасном
  `http://127.0.0.1:5174`: полная Chromium matrix —
  `54 passed, 2 skipped` на `1366×768` и `1920×1080`; оба skip относятся только
  к недоступному BFCache. Внешний SSH listener PID `27963` на `5173` не
  останавливался, после теста `5174` освобождён.
- Browser contract проверил отсутствие horizontal overflow; workflow actor
  `Астра` без `редакция N`; notification `Изменений: 2` без диапазона;
  историю `/stories/101/history` и addressable
  `/stories/101/history?session=4`; значения `Итоговая правка`, `Староград`;
  отсутствие `structured_data`, `schema_version`, `targets`; secondary
  `Сохранённые состояния 0 → 3`; dialog и action
  `Восстановить состояние`; append-only restore до двух карточек. Component
  contract дополнительно проверил formatting-only semantic value.
- Визуально просмотрены созданные этим прогоном notification diff screenshots
  `1366×768` и `1920×1080` из раздельных Playwright project output: tray,
  `Изменений: 2`, before/after значения и основные controls не перекрываются и
  не обрезаются. Точные ignored artifact paths:
  `artifacts/product-reset/playwright/results/notification-routing-late--ceef1-text-refresh-and-read-state-chromium-1366/notification-diff-1366.png`
  и
  `artifacts/product-reset/playwright/results/notification-routing-late--ceef1-text-refresh-and-read-state-chromium-1920/notification-diff-1366.png`.
  Это evidence repo Playwright, а не in-app Browser.
- Fail-closed
  `backend/.venv/bin/python backend/scripts/product_reset_eval.py verify
  --scope final --repo-root .` завершился ожидаемым exit `2` только с
  `full_eval_passed не соответствует вычисленному финальному состоянию` и
  `full_eval_passed имеет значение false`. Историческая external evidence
  exact-SHA не переносилась на текущий HEAD; новый clean deploy/demo и
  external evidence не выполнялись.
- Final-fix wave: notification route теперь сравнивает ровно сохранённый
  notification diff, а semantic projection не показывает raw payload и
  сохраняет безопасные runs TipTap с allowlist font/fill. Добавлены видимые
  поля СНХ/гео и direct-link/browser contracts истории и notification tray.
  Независимый reviewer дополнительно выявил два важных случая: edge spaces
  runs и collision обычной/notification metadata по одному session id.
  Первый закреплён через два начальных и два конечных пробела в formatted run;
  второй — order-independent merge, предпочитающий notification comparison с
  отличающимся `diff_summary`.
- Mutation RED подтверждены до GREEN: замена notification query на
  `session` дала `1 failed, 9 deselected`; пустой allowlist font дал
  `2 failed, 11 passed`. После восстановления: focused semantic/component
  tests — `2 files / 29 passed`; полный frontend — `20 files / 152 passed`.
  Backend full suite: `848 passed, 2 skipped`.
- Fresh browser verification выполнена только через временный localhost
  `5174` конфиг, затем конфиг удалён: targeted history/notification —
  `8 passed (1.9m)`; full matrix — `54 passed, 2 skipped (12.6m)`.
  Оба skip — BFCache capability tests. SSH listener `5173` и занятые
  `.smbdelete*` не затрагивались. Standard build по-прежнему упирается только
  в busy SMB cleanup после TypeScript/158 transforms; safe
  `npm run build -- --emptyOutDir false` — exit `0` (158 modules).
- CodeRabbit `0.7.0` аутентифицирован, но корректный
  `review --agent -t uncommitted -c AGENTS.md` дважды прерван после bounded
  10-minute ожидания без результата; это не засчитывается как review с
  отсутствующими findings. Ошибка отдельной первой команды `-t staged`
  (`Invalid review type`) не повторялась. Внешняя evidence не обновлялась.
- Push, PR, merge и deploy не выполнялись.

### CORR.4 — управление приоритетом и даты реестра

- В форме создания добавлен серверный выбор приоритета: значение по умолчанию
  `Стандарт`, руководство может выбрать `Высокий`, остальные пользователи
  получают только допустимый им вариант. POST всегда передаёт выбранное
  значение.
- В реестре руководство меняет приоритет inline через server-authorized
  action; остальные пользователи видят статическую метку. При ошибке прежнее
  значение сохраняется, при успехе выполняется refetch. Пока один PATCH
  активен, заблокированы все priority-select; изменение фильтра во время
  запроса не может вернуть реестр к устаревшему query.
- Справа от «Исполнители» добавлены «Изменён» и «Создан» в формате
  `ДД.ММ.ГГГГ, ЧЧ:ММ`, `Europe/Moscow`. `updated_at` отражает содержательные
  изменения всего агрегата, включая новый autosave, но не чтение, lease
  heartbeat, notification delivery или idempotent retry. Атомарный SQL
  predicate не позволяет запоздавшему событию уменьшить timestamp.
- Локальные commits среза:
  `e9ebbbc` (`docs(product-reset): design priority controls and registry dates`),
  `7ba6fdf` (`docs(product-reset): plan priority controls and registry dates`),
  `6cc595b` (`feat(stories): add managed priority controls`),
  `991a065` (`feat(stories): track aggregate activity time`),
  `982a05b` (`feat(stories): edit priority and show registry dates`) и
  `718dac7` (`fix(stories): harden activity and priority refresh`).
- Backend RED: пять contract/API failures до priority implementation;
  autosave timestamp оставался равен прежнему; out-of-order timestamp test
  получил `11` вместо `12`. После GREEN и review-hardening полный backend:
  `854 passed, 2 skipped`.
- Frontend RED: отсутствовали две колонки, create priority и inline command;
  review-regрессии отдельно доказали активный второй select и refetch по
  старому фильтру. После GREEN полный frontend: `21 files / 163 passed`.
- Стандартный `npm run build` один раз прошёл полностью, а повторный запуск
  упёрся только в средовую очистку занятого SMB `dist/assets` после успешных
  TypeScript и `158 modules transformed`. Безопасный
  `npm run build -- --emptyOutDir false` завершился exit `0`,
  `158 modules transformed`.
- Новый browser flow создания высокого приоритета и inline-смены прошёл на
  обоих viewport. Полная последовательная Chromium matrix:
  `56 passed, 2 skipped`, 0 failed; оба skip — BFCache capability.
  После review-fixes релевантный repeat `story-priority + ux-hard-gate`:
  `8 passed`. Восьмиколоночный реестр сохраняет минимум шесть строк на
  `1366×768` и не создаёт document-level horizontal overflow.
- Параллельная Playwright-попытка с шестью workers была остановлена как
  недостоверная после массовых teardown-timeout; один реальный fixture diff
  (`priority: "standard"` в full-story POST) исправлен и отдельно прошёл на
  обоих viewport. Канонический повтор выполнен с `--workers=1`.
- `PLAYWRIGHT_PORT` теперь валидируется, при отсутствии override сохраняется
  канонический `5173`; unit contract: `7 passed`. Для тестов использован
  свободный `5174`, существующий SSH listener на `5173` не останавливался.
- Первый CodeRabbit `0.7.0` review exact range от `0678d65` поднял `9 issues`:
  четыре major и пять minor. Восемь закрыты кодом, тестами или документами;
  замечание о create payload уже было покрыто отдельными high/default tests и
  не дублировалось. Второй pass завершён: `CodeRabbit raised 0 issues.`
- Compose config с `.env.example` — exit `0`. Push, PR, merge, deploy и
  обновление external demo evidence не выполнялись.
- Read-only final evaluator на новом локальном HEAD завершился ожидаемым
  exit `2` только с ошибками
  `full_eval_passed не соответствует вычисленному финальному состоянию` и
  `full_eval_passed имеет значение false`. `EVAL_RESULT.json` сохранён как
  историческая exact-SHA evidence; для зелёного final eval текущего HEAD нужен
  отдельно разрешённый clean deploy и новый external demo.

### CORR.5 — управление сотрудниками и временным паролем

- Закрыто расхождение с утверждённой Product Reset моделью: `/admin` теперь
  читает canonical `GET /api/v1/admin/users`, показывает active и inactive
  учётные записи и позволяет начальнику создать сотрудника с несколькими
  функциями, изменить его, отключить/активировать и сбросить временный пароль.
- `must_change_password` теперь является server-side gate: до успешной смены
  временного пароля доступны только auth recovery endpoints, а domain/admin
  запросы получают `403 PASSWORD_CHANGE_REQUIRED`. Frontend в этом состоянии
  не монтирует `AppShell`.
- Зафиксированы узкие технические документы
  `ADMIN_USERS_CORRECTION_DESIGN_RU.md` и
  `ADMIN_USERS_CORRECTION_IMPLEMENTATION_PLAN_RU.md`. Новая роль, v2-контур или
  новая продуктовая сущность не вводятся.
- Production-инвентаризация подтвердила совместимый password hash активного
  пользователя `admin`. При deploy сохраняются его логин, текущий password hash
  и `must_change_password=false`; пароль не читается и не выводится.
- Локальные commits среза:
  `52f4901fa2b829533637c5c8425b9721866f392c`
  (`fix(auth): enforce temporary password change`),
  `8fda73026a9f85aff1df5c26bb3c45e806039cd3`
  (`feat(admin): add employee read model`),
  `219e002dc824cc55102f2e33bd3022dca8e414c2`
  (`feat(admin): manage employee accounts`),
  `5ac75fbded47c9c9398e722d6f61dc38e7510a1c`
  (`fix(admin): harden account command dialogs`) и
  `5c30532e63b7740b384bd9556f545ab611162e6d`
  (`test(admin): verify employee account workflow`).
- Backend RED/GREEN: временный пользователь сначала получил `200` на domain
  route вместо требуемого `403`; после gate focused auth test — `1 passed`,
  auth+permissions — `13 passed`. Admin-list RED — `2 failed` с ожидаемым
  `405`; GREEN — `2 passed, 14 deselected`, полный admin — `15 passed,
  1 skipped`.
- Frontend component RED: отсутствующий `AdminUsersManager` не импортировался;
  hardening wave отдельно дала `6 failed, 7 passed`. После GREEN
  `AdminUsersManager + AppShell` — `14 passed`, полный frontend на итоговом
  HEAD — `22 files / 176 passed`.
- Browser RED Task 4: отсутствующий `frontend/e2e/admin-users.spec.ts`
  завершился `No tests found` (exit `1`). Первый новый run обнаружил только две
  ошибки test contract: StrictMode double initial GET и неточный label пароля;
  production менять не потребовалось. После исправления focused admin matrix —
  `6 passed`; канонический `admin-users + accessibility` — `14 passed` на
  `1366×768` и `1920×1080`.
- Browser contract подтверждает `command → refreshed GET` после каждой
  admin-команды, combined functions, edit/deactivate/reactivate/reset,
  отсутствие `AppShell` до смены временного пароля, отсутствие перехода
  «Сотрудники» у non-chief, отсутствие document-level horizontal overflow и
  отсутствие critical/serious axe violations у таблицы и трёх dialog.
- Полные локальные gates на `5c30532e63b7740b384bd9556f545ab611162e6d`:
  backend project venv — `857 passed, 2 skipped` за `371.15s`; bare `pytest`
  до retry честно не запустился (`command not found`, exit `127`); frontend —
  `22 files / 176 passed`; build `--emptyOutDir false` — exit `0`,
  `161 modules transformed`; полная последовательная Chromium matrix —
  `64 passed, 2 skipped` за `27.0m`, оба skip только BFCache capability;
  demo Compose config — exit `0`; `git diff --check main...HEAD` — exit `0`;
  тестовый `5174` освобождён, listener `5173` не затрагивался.
- CodeRabbit `0.7.1` был аутентифицирован. `backend/app` review завершился с
  `26 issues` по широкому historical `main...feat/product-reset` diff, включая
  один critical; ни один issue не относится к Task 4 paths, вне Task 4
  исправления не вносились. `backend/tests`, `frontend/e2e`, `deploy` и `docs`
  не получили результата из-за rate limit; исходный `frontend` scope отдельно
  был отклонён как `152 > 150` files. Эти попытки не считаются успешными
  reviews. Полные issue/error records сохранены в ignored SDD workspace:
  `coderabbit-backend-app.md`, `coderabbit-backend-tests.md`,
  `coderabbit-frontend.md`, `coderabbit-deploy.md`, `coderabbit-docs.md`.
- Push, PR, merge, deploy и external exact-SHA evidence не выполнялись.
  Историческая external evidence не переносилась на новый HEAD.

### CORR.6 — финальные pre-merge блокеры admin/auth/API

- Пароли теперь хешируются и проверяются по точной введённой строке.
  `strip()`/`casefold()` используются только для strength-check. Временный и
  постоянный пароль с начальными/конечными пробелами принимается только в
  точном виде; whitespace-only и короткое значение по нормализованной копии
  остаются запрещены.
- Удалён неиспользуемый compatibility-wrapper
  `build_captionpanels_import_payload`; текущий путь экспорта остаётся
  `build_captionpanels_current_export`.
- Добавлены серверные per-session сессии: случайный opaque ID, user FK
  `ON DELETE CASCADE`, `created_at`, `expires_at`, `revoked_at`. Login создаёт
  и commit-ит отдельную строку до ответа, signed cookie содержит user/session
  IDs, authentication требует действующую строку, logout отзывает только
  текущую сессию. Вторая параллельная сессия остаётся рабочей; временный
  password gate и настроенное имя cookie сохранены.
- Baseline `20260710_0001` не изменён. Новая forward Alembic migration
  `20260730_0002_user_sessions.py` проверена clean
  `base → head → head → base` вместе с точным совпадением ORM metadata и
  физической схемы.
- Generic `HTTPException` теперь сохраняет status и headers, выдаёт безопасные
  коды для `400/401/403/404/405/409/422/429` и `HTTP_ERROR` для остальных.
  Unknown route возвращает `404 NOT_FOUND`, unsupported method —
  `405 METHOD_NOT_ALLOWED`, `Retry-After` проходит без потери.
- RED evidence:
  exact-password — `2 failed, 2 passed`; server revocation/migration —
  `3 failed, 2 passed`; HTTP contract — `10 failed, 2 passed`.
  CaptionPanels cleanup использовал уже зелёные characterization-тесты до и
  после удаления: оба раза `15 passed`.
- GREEN evidence на итоговом production-коде: focused auth/admin/security/
  runtime/CaptionPanels/error/migration — `131 passed, 2 skipped`; полный
  backend — `876 passed, 2 skipped` за `401.22s`.
- Локальные commits:
  `cdfe3c6` (`fix(auth): preserve exact password bytes`),
  `8c325da` (`refactor(captionpanels): remove unused import wrapper`),
  `2742b43` (`feat(auth): revoke sessions server-side`) и
  `2575d01` (`fix(api): map generic HTTP errors safely`).
- При первом GREEN migration-run внешний том создал untracked AppleDouble
  `._20260730_0002_user_sessions.py`; Alembic ожидаемо отказался читать его как
  Python. Удалён только этот metadata-файл, повторный migration-набор прошёл.
- Известные non-blocking concerns: старые signed cookies без session ID после
  deploy станут невалидны; автоматическая очистка истёкших session rows этим
  срезом не вводилась. Сохраняются только существующие deprecation warnings
  Alembic/TestClient; новых warning-классов нет.
- Push, PR, merge, deploy, production password migration и external exact-SHA
  evidence не выполнялись.

### CORR.7 — whole-branch final review fix wave

- Critical 1 закрыт локально: несовпадающий persisted draft больше не
  игнорируется и не перезаписывается следующим вводом. Редактор показывает
  сохранённый локальный и самый новый серверный snapshot, блокирует ввод до
  явного выбора и предупреждает при уходе.
- «Продолжить с локальным текстом» переносит сохранённые строки на актуальный
  server revision, оставляет их dirty и ставит один autosave в очередь.
  «Использовать текст с сервера» сначала требует отдельного подтверждения и
  только затем удаляет local draft. До завершения fetch самого нового
  server snapshot обе resolution-команды заблокированы.
- `SCENARIO_REVISION_CONFLICT` переводит тот же autosave-контур в recovery
  state, очищает queued blind retry и сохраняет исходный latest local
  snapshot. Новая попытка ввода, `online` и ручной retry не могут заменить
  этот snapshot до явного разрешения. Совпадающий restored draft сразу
  становится pending и автоматически сохраняется.
- RED evidence: initial persisted mismatch не имел recovery alert; второй
  набор дал пять ожидаемых падений для local rebase, подтверждённого discard,
  matching-draft autosave, runtime conflict и freeze original snapshot.
  Отдельный race RED доказал, что resolution оставался доступен до загрузки
  newest server snapshot.
- GREEN evidence: focused hook/component — `21 passed`, race repeat —
  `1 passed`; production build `--emptyOutDir false` — exit `0`,
  `161 modules transformed`; browser recovery на `1366×768` и `1920×1080` —
  `2 passed` с `--workers=1`.
- Первый полный frontend run честно завершился `2 failed, 181 passed`:
  старый handoff test оставлял draft между тестами одного файла и раньше
  зависел от молчаливого игнорирования mismatch. Fixture изолирован через
  очистку localStorage; focused repeat — `6 passed`, свежий полный frontend
  repeat — `22 files / 183 passed`.
- Backend, push, PR, merge, deploy и external exact-SHA evidence в этом
  checkpoint не изменялись.
- Important 1 закрыт отдельным SPA navigation guard: programmatic
  `navigate`, перехваченные внутренние ссылки и `popstate` используют один
  dirty-контракт. Отмена сохраняет принятый route, редактор, selection/focus и
  local draft; отменённый browser Back восстанавливает URL без размонтирования.
  Подтверждённый переход не удаляет draft. Для чистого редактора диалог не
  показывается.
- RED evidence для SPA guard: отсутствующий shared-модуль сначала не
  импортировался, затем три behavioral-теста падали на programmatic/link,
  `popstate` и draft preservation. Editor integration отдельно показал
  ошибочный `true` для перехода до debounce. Первый browser run дошёл до
  ожидаемого RED на обоих viewport: после отменённого клика фокус оставался на
  ссылке вместо редактора.
- GREEN evidence для Important 1: focused router + editor —
  `2 files / 15 passed`; browser route/back/clean contract на `1366×768` и
  `1920×1080` — `2 passed` с `--workers=1`; полный frontend —
  `23 files / 188 passed`; production build `--emptyOutDir false` — exit `0`,
  `162 modules transformed`.
- Important 2 возвращает полную пользовательскую историю: завершённые
  `ScenarioEditSession` и allowlisted значимые `StoryEvent` объединяются в
  один порядок по времени с opaque cursor, содержащим стабильный
  timestamp/kind/id tie-break. Неизвестные и delivery-события отфильтрованы;
  payload в API и UI не отдаётся.
- Workflow rows имеют русскую label и только безопасный краткий summary.
  Покрыты metadata, management/priority, назначения, workflow, производство,
  пакеты правок, внешнее согласование, эфир, архив/restore и отдельное
  восстановление сценария. Frontend различает union по `kind`, сохраняет
  адресные session diff и не показывает `event_code` или raw payload.
- Metadata patch теперь атомарно записывает `story_metadata_changed` с
  читаемыми before/after title и rubric. Восстановление сценария записывает
  `scenario_restored`, связывает его с новым edit-session diff и обновляет
  aggregate `stories.updated_at`; последующая история остаётся append-only.
- RED evidence для Important 2: три backend-теста упали на отсутствующих union
  rows, metadata `event_id` и restore event; frontend workflow row падал при
  попытке прочитать отсутствующий `diff_summary`. GREEN: history API —
  `12 passed`; frontend timeline — `17 passed`; смежный backend-набор после
  kind-aware исправления старого session-only assertion — `120 passed`.
- Полные checkpoint gates Important 2: backend —
  `878 passed, 2 skipped` за `404.92s`; frontend —
  `23 files / 189 passed`; production build `--emptyOutDir false` — exit `0`,
  `162 modules transformed`; browser history на `1366×768` и `1920×1080` —
  `4 passed` с `--workers=1`; `git diff --check` — exit `0`.
- Important 3 завершает утверждённое leadership-управление реестром.
  `PATCH /api/v1/stories/{id}/management` атомарно принимает автора и/или
  приоритет, разрешает только активного пользователя с функцией `author`,
  запрещён обычному пользователю и архивному сюжету, пишет один семантический
  `story_management_changed` и обновляет aggregate `updated_at`.
- Старый узкий `priority_action` удалён из backend/frontend-контракта в том же
  checkpoint. Новый `management` read model отдаёт server-provided action,
  допустимых активных авторов и варианты приоритета; ordinary UI остаётся
  статическим. Если ранее назначенный автор уже недоступен, его имя остаётся
  видимым как выбранная отключённая опция и не предлагается для нового
  назначения.
- Добавлены leadership-команды `POST /api/v1/rubrics` и
  `PATCH /api/v1/rubrics/{id}` с нормализацией пробелов, case-insensitive
  уникальностью, create/rename/disable/reactivate и canonical refetch после
  каждой команды. Компактный dialog встроен в существующую страницу сюжетов,
  без отдельного режима или параллельной страницы.
- Отключённая используемая рубрика остаётся читаемой в story/history и как
  выбранное недоступное значение metadata, но отсутствует в create и
  reassignment options. Подтверждено сохранение восьми подготовленных активных
  рубрик и default-приоритета `Стандарт`.
- RED evidence Important 3: backend management contract дал `2 failed`,
  rubric API — `4 failed`; frontend сначала не находил author/rubric controls,
  отдельно воспроизведены исчезновение отключённой текущей рубрики и неверное
  отображение недоступного текущего автора. GREEN focused: backend
  stories/read-model/rubrics — `19 passed`; frontend management/table/metadata
  и смежные компоненты — `32 passed`, после последнего edge-case —
  `9 passed`; browser management на обоих viewport — `4 passed`.
- Полные checkpoint gates Important 3: backend —
  `884 passed, 2 skipped` за `394.54s`; frontend —
  `24 files / 193 passed`; production build `--emptyOutDir false` — exit `0`,
  `163 modules transformed`; полная последовательная Chromium matrix —
  `72 passed, 2 skipped` за `26.0m`, оба skip только BFCache capability;
  `git diff --check` — exit `0`.
- Important 4 удаляет легитимизированный двухшаговый обход correction
  completion. Для scope `video` допустим только `video_ready`, для `titles` —
  только `titles_ready`, для `text` и `voiceover` — только `none`.
  Неверное сочетание и отсутствующее поле получают единый domain error
  `COMPLETION_ACTION_SCOPE_MISMATCH` до любых мутаций.
- Завершение части и соответствующая production ready-отметка выполняются
  внутри одного locked aggregate/part transaction и одного commit. Публичная
  ready-команда по-прежнему блокируется открытой правкой; после атомарного
  completion она видит уже готовое состояние. Duplicate completion сохраняет
  `PART_ALREADY_COMPLETE`.
- Старый backend-тест `none → отдельная titles-ready` заменён на отрицательный
  bypass и атомарный success. RED: `4 failed, 2 passed` — video/titles с
  `none` отвечали `200`, missing field — общим `422`. GREEN: exact pairing —
  `6 passed`; связанный corrections/production/notifications/actions/external
  набор — `86 passed`.
- Полные checkpoint gates Important 4: backend —
  `889 passed, 2 skipped` за `393.30s`; frontend regression —
  `24 files / 193 passed`; production build `--emptyOutDir false` — exit `0`,
  `163 modules transformed`; browser production workflow на `1366×768` и
  `1920×1080` — `12 passed` за `5.9m` с `--workers=1`;
  `git diff --check` — exit `0`.
- Important 5 заменяет независимые metadata PATCH на single-flight
  latest-value queue с одним запросом в полёте на story. Название и рубрика,
  изменённые во время запроса, объединяются в одно последнее желаемое
  состояние и отправляются только после завершения предыдущего PATCH.
  Успешный старый ответ обновляет только подтверждённую server baseline, но не
  заменяет локальные поля. Ошибка сохраняет последнее локальное значение,
  удерживает shared navigation guard и даёт явную команду повторного
  сохранения. Уже поставленная в очередь работа продолжает drain после
  unmount; переход между story принудительно пересоздаёт metadata header по
  `storyId`.
- RED Important 5: два component-теста получили `2 failed` — прежняя
  реализация одновременно отправляла три PATCH и не удерживала dirty guard
  после ошибки. Дополнительный self-review RED воспроизвёл возврат к исходному
  заголовку во время старого in-flight PATCH: ожидалось два запроса, но
  отправлялся только старый один. Финальная очередь сравнивает desired state с
  projected результатом in-flight PATCH, поэтому возврат к исходному значению
  также становится последующей server-командой.
- GREEN Important 5: metadata component — `5 passed`; metadata/editor/router
  focused integration — `19 passed` до дополнительного edge-case; browser
  server-state regression на `1366×768` и `1920×1080` — `2 passed` с
  `--workers=1`. Synthetic server подтверждает максимум один активный PATCH и
  итоговые последние title/rubric после deferred старого запроса.
- Полные checkpoint gates Important 5: backend —
  `889 passed, 2 skipped` за `425.06s`; финальный frontend regression после
  self-review correction — `24 files / 195 passed`; production build
  `--emptyOutDir false` — exit `0`, `163 modules transformed`; повторный
  browser metadata contract — `2 passed` за `51.6s`; `git diff --check` —
  exit `0`.
- Important 6 вводит один server-side bulk revoke для активных
  `user_sessions`, без собственного commit. Admin reset меняет временный
  пароль и отзывает все сессии пользователя в одной транзакции; deactivation
  отзывает их в той же транзакции, что и `is_active=false`, поэтому
  reactivation не может оживить старую cookie.
- Self password change повторно проверяет подписанную текущую cookie после
  authenticated dependency, меняет пароль и отзывает все остальные сессии
  пользователя, исключая exact current `session_id`. Обычный logout не
  изменён и по-прежнему отзывает только текущую сессию.
- RED Important 6: три exact replay-теста получили `3 failed` — старая cookie
  после admin reset отвечала `200`, cookie после deactivate/reactivate снова
  отвечала `200`, а вторая параллельная сессия после self password change
  оставалась действующей с `200`. GREEN: эти проверки — `3 passed`;
  расширенный auth/admin/password набор, включая logout-only-current и
  temporary-password gate, — `36 passed, 1 skipped`.
- Полный backend checkpoint Important 6: `892 passed, 2 skipped` за
  `419.02s`; `git diff --check` — exit `0`. Frontend/runtime UI не менялись
  относительно уже проверенного Important 5 checkpoint.
- Bootstrap Minor разделяет обработку identity и password env. Username,
  display name и position по-прежнему нормализуются; для
  `BOOTSTRAP_ADMIN_PASSWORD` `.strip()` используется только для проверки
  отсутствия/whitespace-only, а `set_temporary_password` получает exact raw
  строку для хеширования.
- RED bootstrap regression создал пользователя, но exact пароль с
  ведущими/замыкающими пробелами не проходил `verify_password`. GREEN:
  exact regression — `1 passed`; связанный runtime setup и существующие
  admin/self password-space контракты — `65 passed`.
- Финальная локальная матрица выполнена последовательно на exact implementation
  commit `9e21199dd9e03b29e4c0697e13a76214071ab238`:
  - backend `./.venv/bin/pytest -q` —
    `893 passed, 2 skipped` за `432.04s`;
  - frontend `npm run test -- --run` —
    `24 files / 195 passed` за `132.53s`;
  - production build `npm run build -- --emptyOutDir false` — exit `0`,
    `163 modules transformed`;
  - полный browser
    `PLAYWRIGHT_PORT=5174 npx playwright test --workers=1` —
    `74 passed, 2 skipped` за `26.9m`; оба skip только BFCache capability,
    все остальные сценарии прошли без retry;
  - demo Compose config с `deploy/env/demo.env.example` — exit `0`;
  - `git diff --check main...HEAD` — exit `0`, worktree после runtime matrix
    был чистым.
- Отдельный migration gate `tests/test_migration_baseline.py` завершился
  `4 passed, 1 skipped`: проверены exact chain
  `base → 20260710_0001 → 20260730_0002`, empty database upgrade,
  повторный idempotent `upgrade head`, ORM/column parity и downgrade до
  `base`; skip относится только к PostgreSQL inspector в SQLite test double.
- Финальный self-review полного диапазона `f876fb6..9e21199`: все
  `1 Critical + 6 Important + 1 Minor` findings закрыты, открытых
  Critical/Important/Minor не найдено. Не добавлены migration, legacy/v2
  режим, реальные данные, секреты или fallback; утверждённая продуктовая
  модель не изменена. Push, PR, merge и deploy не выполнялись.

### CORR.8 — residual whole-branch blockers

- Credential/session mutations сериализованы общей блокировкой строки
  пользователя: login issuance, admin reset/deactivation и self password
  change используют PostgreSQL `SELECT ... FOR UPDATE`, после чего password,
  active state, session revoke/issue и commit выполняются в одном
  согласованном transaction order. Обычный logout остался current-session
  only.
- Рубрики получили DB-authoritative нормализованную уникальность:
  `name_key = normalized whitespace + Unicode casefold`, unique index в ORM и
  forward migration `20260730_0003`. Backfill сохраняет ID/имя/active state и
  fail-closed останавливается на существующей collision; конкурентный
  `IntegrityError` возвращается как `409 RUBRIC_NAME_TAKEN`.
- Metadata latest-value queue вынесена за React component lifecycle в один
  per-story coordinator. Unmount/remount не создаёт второй PATCH, не теряет
  desired/error/retry и не снимает shared dirty guard; устаревшие props не
  заменяют локальное authoritative состояние.
- AppRouter теперь разрешает hash-only и relative href от полного текущего
  `window.location.href`, поэтому сохраняются pathname/search текущей story
  вкладки.
- Recovery dialog стал hard gate: labelled `alertdialog`, keyboard focus trap,
  scrollable snapshot lists, отдельное destructive confirmation с safe cancel,
  `Escape` semantics и восстановление точного editor focus/window scroll после
  runtime `409`.
- Два contract follow-up выровняли metadata PATCH
  (`409 RUBRIC_INACTIVE`, `422 VALIDATION_ERROR`) и сохранили dirty draft
  одной рубрики при canonical refetch после команды над другой строкой.
- RED → GREEN evidence:
  - credential lock helper отсутствовал; GREEN auth/admin/password —
    `35 passed, 1 skipped`;
  - concurrent rubric create/rename не имели DB invariant; GREEN
    rubrics/migration — `12 passed, 1 skipped`;
  - metadata remount race воспроизведён component-тестом; GREEN metadata —
    `6 passed`, related frontend — `40 passed`;
  - router RED — `2 failed / 6`, GREEN — `6 passed`;
  - conflict component GREEN — `11 passed`; initial recovery browser —
    `2 passed`; runtime scroll/focus browser — `2 passed`;
  - metadata status RED получил `400` вместо `409/422`; GREEN stories/archive
    — `3 passed`;
  - rubric dialog RED потерял `Несохранённый репортаж` после refetch; GREEN
    management component — `2 passed`.
- Реализация разбита на семь локальных commits:
  `ed8e838`, `abb0c7b`, `bf63f96`, `5d9d0aa`, `a59f56b`, `1c57451`,
  `022827f`.
- Финальная матрица выполнена на exact implementation commit
  `022827ff3601f5b77964d53f417e80349a75d29f`:
  - backend — `900 passed, 2 skipped` за `479.29s`;
  - frontend — `24 files / 198 passed` за `113.99s`;
  - production build — exit `0`, `164 modules transformed`;
  - Playwright `--workers=1` — `76 passed, 2 skipped` за `27.6m`, оба skip
    только BFCache capability, retries отсутствовали;
  - migration baseline — `5 passed, 1 skipped`, skip только PostgreSQL
    inspector в SQLite test double;
  - root/test/demo Compose config — exit `0`;
  - `git diff --check main...HEAD` — exit `0`, worktree clean.
- Финальный self-review не нашёл открытых Critical/Important/Minor.
  Единственный environment concern: локальный Docker daemon недоступен, поэтому
  PostgreSQL-only row-lock/concurrency и inspector rehearsal нужно повторить в
  среде с запущенным Docker перед production deploy. Push, PR, merge и deploy
  не выполнялись.

#### CORR.8 CodeRabbit residual follow-up

- Finding о недостающем rubric characterization отклонён как дублирующий:
  существующие `test_rubrics_api.py` и `test_migration_baseline.py` уже
  покрывают кириллицу, casefold, крайние/внутренние пробелы, ORM/DB invariant,
  rename, duplicate и concurrent create/rename.
- PostgreSQL migration `20260730_0003` теперь получает
  `LOCK TABLE rubrics IN ACCESS EXCLUSIVE MODE` до первого SELECT, backfill и
  unique index. RED behavioral/dialect test выполнил реальный `upgrade()` path
  и увидел первым statement `SELECT`; GREEN подтвердил порядок
  `LOCK TABLE` → `SELECT`.
- `ScenarioMetadataHeader` больше не передаёт собственный ключ
  `rubric: undefined`, если сохранённый ID отсутствует в актуальном
  справочнике. Это закреплено отдельно для ack callback и initial
  reconciliation после unmount/remount: оба RED подтвердили лишний ключ, оба
  GREEN его исключили.
- Follow-up commits:
  `2f744e5ca74d63b64eb29f18cd9aa19894dc3410`,
  `74da574066d9d326069cfb026eccab77e05ac99b`.
- Targeted матрица на exact implementation commit
  `74da574066d9d326069cfb026eccab77e05ac99b`:
  - migration/rubrics — `13 passed, 1 skipped`;
  - metadata/editor — `3 files / 38 passed`;
  - production build — exit `0`, `164 modules transformed`;
  - `git diff --check` — exit `0`.
- Предыдущая полная backend/frontend/browser матрица остаётся привязана к
  `022827ff3601f5b77964d53f417e80349a75d29f`; два follow-up commits проверены
  указанной targeted matrix. Push, PR, merge и deploy не выполнялись.

### Интеграция Product Reset

- Пользователь отдельно разрешил push, готовый PR, merge и production deploy.
- Ветка `feat/product-reset` отправлена в `origin` на exact implementation SHA
  `3f129f165f0c7c82fe86dadd8b0110eec4801372`.
- Открыт ready-for-review PR `#31` в `main`.
- Production cutover выполняется fail-closed: до переключения трафика нужны
  проверенные backup старого и нового PostgreSQL, перенос существующего
  `admin` с точным совместимым password hash без чтения plaintext,
  authenticated smoke и готовый rollback на старый стек.
- Внешняя exact-SHA evidence ещё не обновлена: она должна фиксировать уже
  слитый и фактически развёрнутый merge SHA.

### Production cutover и повторная exact-SHA evidence

- PR `#31` слит обычным merge в `main` с сохранением checkpoint-истории.
  Два обнаруженных canonical deploy defect исправлены отдельными проверяемыми
  PR `#32` и `#33`; GitHub Actions для итогового `main`
  `1c7ef1be0f301272e8d3daa116bb471f1fc2ccc0` завершился успешно
  (`run 30529394798`).
- Перед переключением созданы и проверены отдельные backup legacy и Product
  Reset PostgreSQL, storage/exports и edge-конфигурации в защищённом каталоге
  вне checkout. Финальный freeze-backup legacy PostgreSQL имеет SHA-256
  `d95da939aadc781866e3a1415013c33162798cff858379ada2cfabe5f29bd8bf`;
  `pg_restore --list` прошёл.
- Exact `main` доставлен на сервер и развернут каноническим demo Compose:
  checkout HEAD совпадает с
  `1c7ef1be0f301272e8d3daa116bb471f1fc2ccc0`, migration head —
  `20260730_0003`, `db/backend/frontend/gateway` healthy.
- Существующий production `admin` перенесён атомарно без чтения или вывода
  plaintext. Source и target password hash побайтово совпадают, формат
  совместим, `must_change_password=false`; у `admin` ровно одна функция
  `chief`. Все другие Product Reset users отключены, все прежние сессии
  отозваны.
- Публичный edge переключён только заменой upstream на новый gateway после
  `nginx -t`. `https://ncastnav.ru/api/health` отвечает `200`, неавторизованный
  `/api/v1/auth/me` — `401`, default `admin/admin` — `401`; старый backend
  снова запущен и остаётся hot rollback без публичного трафика.
- Одноразовый chief smoke подтвердил публичные login, `/auth/me`, `/stories`,
  `/admin/users`; пользователь после проверки удалён. Отдельный одноразовый
  smoke с `Origin: null` подтвердил CaptionPanels story list и актуальный
  `import-json`; пользователь и cookie-файлы после проверки удалены.
- Фактический UI проверен в браузере на `1366x768` и `1920x1080`: реестр
  содержит восемь утверждённых колонок и inline priority, редактор сохраняет
  синюю шапку таблицы и sticky-панель форматирования, история показывает
  семантические тексты без сырого JSON. Console warning/error — `0`.
  Untracked screenshot SHA-256:
  `2cfcd7111fc2afaba607a1059f0a035eb4530021ae27262e2f80b99e2539b25d`
  и
  `7f4bdf842ce73be86f2eb115697ac39dce7c1aeb735a99bedf220a764d9bfa73`.
- Исторический CP7 subtree остаётся неизменяемым на source
  `c4a097eb5cee226c884adadf0ac79958b8a71e53` и binding
  `2194f5986146c3677bc7da794683bf00d164ae30`. Финальный verifier дополнен
  отдельным exact deployment binding
  `1c7ef1be0f301272e8d3daa116bb471f1fc2ccc0`: этот commit обязан быть между
  CP7 binding и текущим evidence HEAD, а после него допускаются только
  перечисленные evidence-файлы. Поэтому новая production evidence не
  переиспользует старый external SHA и остаётся fail-closed.
- Evidence RED подтвердил отказ старого demo SHA и отсутствие deployment
  binding. После исправления полный verifier/evidence набор
  `test_demo_evidence.py + test_product_reset_eval.py +
  test_ux_eval_evidence.py` завершился `351 passed` за `365.52s`.
- CodeRabbit uncommitted review поднял один valid major ancestry guard:
  `_cp7_git_errors` теперь самостоятельно требует
  `evaluated → CP7 binding → deployment binding → HEAD`, даже когда отдельная
  subtree-проверка отключена. RED дал `1 failed`, GREEN focused regression —
  `6 passed`; повторный CodeRabbit review — `0 issues`.
- Первый final verify fail-closed отказал только из-за локально
  перезаписанных untracked CP7 UX artifacts и остановленного local Docker
  cleanup check; schema, production external evidence и Git lineage были
  валидны. На detached historical CP7 source
  `c4a097eb5cee226c884adadf0ac79958b8a71e53` повторно выполнены
  `ux-hard-gate` для обоих desktop viewport и accessibility
  `chromium-1366`: `9 passed`, все 12 exact manifest hashes восстановлены.
  После запуска локального Colima operations cleanup evidence также прошла.
- Итоговый `verify --scope final` выполнен в чистом full-history clone на том
  же evidence HEAD с восстановленными untracked CP7 artifacts:
  `{"passed": true, "errors": []}`.

### Patch `1.0.1` — управление сотрудниками, версия и cache policy

- Утверждённый патч реализован в отдельном worktree
  `/Volumes/work/Projects/NewscastNavigator-v1.0.1`, ветка
  `codex/v1.0.1-user-management`. Exact implementation HEAD:
  `2a9991e594a29dbfe772d70571dcfee435e8791f`.
- Chief-only `PATCH /api/v1/admin/users/{id}` теперь принимает
  нормализованный уникальный `username`. Смена логина не меняет пароль,
  `must_change_password` или действующую сессию; конфликт остаётся атомарным и
  возвращает `USERNAME_TAKEN`.
- Chief-only `DELETE /api/v1/admin/users/{id}` физически удаляет только
  ошибочно созданную и ещё не использованную учётную запись. Self-delete,
  последний активный chief и любая доменная либо историческая ссылка
  блокируют удаление. Явно разрешённые технические связи очищаются вместе с
  допустимым пользователем; неизвестная ссылка или `IntegrityError` дают
  fail-closed `USER_DELETE_BLOCKED`.
- В существующем окне управления сотрудником добавлено редактирование логина,
  а в строке — отдельное опасное действие с подтверждением удаления.
  Command/refetch-модель, роли backend и утверждённая Product Reset модель не
  менялись.
- Backend/frontend metadata синхронизированы на `1.0.1`; общий компактный
  footer показывает версию и авторскую строку на странице входа и внутри
  AppShell. Footer остаётся в обычном потоке и не перекрывает рабочий
  интерфейс.
- HTML и SPA fallback получают
  `Cache-Control: no-cache, must-revalidate`; только успешно найденные
  content-hashed assets получают годовой `immutable`; отсутствующий asset
  отвечает `404`, `Cache-Control: no-store` и локализованным не-HTML телом.
  Новой миграции БД нет; сценарий, workflow, CaptionPanels и табличный редактор
  не изменялись.
- Реализация и review-fixes разбиты на локальные commits:
  `4bcfc94`, `c52abd8`, `a9679db`, `47cda14`, `72ef4c7`, `3ffa037`,
  `0cf5cbc`, `16b12b2`, `c3766cd`, `25e6264`, `ba8a989`, `8da62ee`,
  `2a9991e`.

#### Patch `1.0.1` — финальная локальная проверка

- Полная fresh matrix выполнена последовательно на exact
  `2a9991e594a29dbfe772d70571dcfee435e8791f`:
  - backend `pytest -q` — `944 passed, 2 skipped` за `520.52s`;
  - Vitest — `25 files / 210 tests passed`;
  - production build — exit `0`, `166 modules transformed`;
  - Playwright `--workers=1` в обоих desktop-проектах —
    `78 passed, 2 skipped` за `59.1s`; оба skip относятся только к
    browser-capability/BFCache;
  - root, test и demo Compose config — exit `0`;
  - `git diff --check main...HEAD` — exit `0`, tracked worktree clean.
- Канонический clean-deploy rehearsal прошёл на том же exact commit:
  run `20260730T224823Z-2a9991e594a2-d3dcf5fc`. Fresh build, migration,
  synthetic seed, health/auth/cache smoke, backup checksum, restore в пустую
  PostgreSQL, post-restore counts/smoke, logs validation и cleanup — passed.
  Source и restore containers/volumes/networks после проверки отсутствуют.
- Отдельный live stack из чистого `git archive HEAD` подтвердил:
  `/` и `/index.html` — `200` с `no-cache, must-revalidate`; hashed JS —
  `200` с `public, max-age=31536000, immutable`; отсутствующий JS — `404` с
  `no-store` и телом `Не найдено`; `/api/health` — `200 {"status":"ok"}`.
  Стек, архив и ранее оставшийся проверочный Docker project удалены.
- Final evaluator запущен один раз в чистом full-history clone, detached на
  exact HEAD. Он вернул ровно два ожидаемых до нового deploy/evidence
  сообщения:
  `full_eval_passed не соответствует вычисленному финальному состоянию` и
  `full_eval_passed имеет значение false`. Дополнительных ошибок нет; это
  согласованный stale deployment-binding gate, который будет закрыт отдельным
  evidence-only PR после production deploy.
- CodeRabbit выполнил три whole-branch прохода:
  - в первом проходе valid footer-layout замечание закрыто commits
    `25e6264` и `ba8a989`; повторение security headers отклонено, потому что
    публичный gateway уже добавляет и live-проверка сохраняет семь заголовков;
    release-authorization и сокращённый changelog подтверждены утверждённым
    планом;
  - во втором проходе добавлен реальный Playwright layout-контракт
    (`8da62ee`) и усилен missing-asset contract (`2a9991e`): локализованное
    тело, `no-store`, запрет ошибочного `immutable`;
  - единственное замечание третьего прохода об удалении проверки вертикального
    центрирования отклонено: предыдущий valid finding прямо потребовал этот
    runtime-контракт, он проходит на обоих утверждённых desktop viewport.
  Открытых actionable CodeRabbit findings не осталось.
- CodeRabbit review готового PR дополнительно обнаружил противоречие между
  design и implementation plan о моменте создания `v1.0.1`, а также
  дублирующую ветку только в Playwright fixture. Design приведён к выбранному
  fail-closed порядку: release tag создаётся лишь после успешного production
  smoke; redundant fixture branch удалён без изменения поведения. Focused
  `admin-users.spec.ts` после исправления — `6 passed` на обоих desktop
  viewport.
- Новых записей в risk register не требуется. Единственный ожидаемый concern —
  устаревшая exact-SHA production evidence, которая по плану обновляется только
  после merge и фактического deploy. Push, PR, merge и deploy патча на этом
  локальном checkpoint ещё не выполнялись.

#### Patch `1.0.1` — PR, production deploy и release tag

- Patch-ветка прошла готовый PR `#35`; GitHub Actions run `30590751046`
  завершился успешно, CodeRabbit findings закрыты, независимый финальный review
  не нашёл Critical/Important/Minor замечаний. PR слит обычным merge commit:
  exact runtime SHA `35cd8902258587e77a36e0885ee5b8f6db0154db`.
- Перед deploy создан и проверен custom-format backup PostgreSQL
  `v1.0.1-predeploy-20260730T235035Z.dump`; checksum и
  `pg_restore --list` прошли. Rollback manifest защищён вне checkout, а
  предыдущие backend/frontend images сохранены под `rollback-v1.0.0`.
- Несколько ранних deploy-попыток остановились fail-closed до переключения на
  type/remote/ref guards. После замены application containers канонический
  smoke сначала был ошибочно вызван по LAN-адресу и закономерно отклонил
  non-loopback URL; повтор через SSH localhost tunnel прошёл. Итоговый
  production checkout чистый и точно равен runtime SHA.
- Заменены только `backend` и `frontend`. Идентификаторы production `db` и
  `gateway` не изменились; все четыре сервиса healthy. Миграций не добавлено.
  Существующий `admin` активен, `must_change_password=false`, имеет ровно
  функцию `chief`; его password hash до/после совпал без чтения plaintext.
- Public smoke: health/root `200`, unauthenticated `401`, default
  `admin/admin` отклонён, HTML ревалидируется, hashed asset immutable, missing
  asset отвечает `404 + no-store`. Authenticated smoke подтвердил список
  сотрудников, смену логина, удаление неиспользованной учётной записи, отказ
  self-delete и CaptionPanels list/current `import-json` с `Origin: null`.
  Все синтетические пользователи, сессии и временные cookie-файлы удалены.
- Реальный браузер подтвердил публичную форму входа и авторизованное управление
  сотрудниками на `1366×768` и `1920×1080`, включая reload ранее
  использованной сессии: версия `1.0.1`, footer ordinary-flow, overflow
  отсутствует, действия «Изменить»/«Удалить» доступны, console warning/error
  после входа `0`. Новые публичные screenshots остались untracked; после
  вычисления SHA-256 локальные файлы удалены.
- Аннотированный `v1.0.0` указывает на baseline
  `33828d81e8489cdadcec2683f4c98a11d27538db`; аннотированный `v1.0.1`
  создан только после успешного smoke и разыменовывается в exact deployed
  runtime `35cd8902258587e77a36e0885ee5b8f6db0154db`.

#### Patch `1.0.1` — evidence-only checkpoint

- Отдельный worktree
  `/Volumes/work/Projects/NewscastNavigator-v1.0.1-evidence`, ветка
  `codex/v1.0.1-evidence`, создан от нового `origin/main`.
- RED подтвердил старые `schema_version=1` и deployment binding
  `1c7ef1be0f301272e8d3daa116bb471f1fc2ccc0`; после обновления focused GREEN
  для schema/runtime/tag — `3 passed`, полный `test_demo_evidence.py` —
  `31 passed`.
- `DEMO_EVIDENCE.json` schema v2 связывает permission, public URL, UTC
  timestamp, release tag и exact deployed SHA. В Git записаны только redacted
  IDs, SHA-256 и boolean outcomes; production credentials, password hash,
  dataset и screenshots не коммитятся.
- Полный предусмотренный evidence-набор
  `test_demo_evidence.py + test_product_reset_eval.py +
  test_ux_eval_evidence.py` завершился `363 passed` за `376.30s`.
- Первый final verifier корректно остался красным только потому, что новый
  worktree не содержал ignored/untracked immutable CP7 UX/operations
  artifacts. Исторические 12 UX artifacts и exact operations run
  `20260725T090315Z-c4a097eb5cee-adfb9934` скопированы из ранее
  валидированного worktree, повторно прошли hash/manifest contract и остаются
  untracked. Локальный Colima запущен обратно; cleanup check не нашёл
  оставшихся eval resources.
- Попытка дополнить prose `UX_EVAL_RU.md` release-примечанием была отменена до
  commit: CP7 manifest намеренно хеширует весь historical UX document. Patch
  browser evidence поэтому записана в `DEMO_EVIDENCE.json`, `PROGRESS.md` и
  risk register, а immutable CP7 UX-файл не изменён.
- Итоговый `product_reset_eval.py verify --scope final` завершился:
  `{"passed": true, "errors": []}`.
- CodeRabbit review uncommitted evidence diff нашёл один valid major и один
  valid minor: tag-check не должен пропускаться при недоступном deployed SHA,
  а «Следующее действие» не должно повторно обещать уже завершённый evaluator.
  Независимый review дополнительно потребовал строгие integer/boolean types и
  реальный разбор UTC-даты вместо одного regex. Все замечания воспроизведены и
  исправлены fail-closed.
- Новые negative tests покрывают недоступный deployed SHA, неверный tag target,
  `float` вместо integer, `1` вместо boolean и невозможный UTC timestamp.
  Focused review-fix regression — `40 passed`; повторный полный evidence-набор
  после исправлений — `370 passed` за `358.72s`.
- Повторный CodeRabbit review нашёл ещё одну fail-closed границу: голый
  `v1.0.1^{commit}` мог разрешить одноимённую ветку. Проверка ограничена exact
  `refs/tags/v1.0.1^{commit}`, mismatch-тест использует другой валидный SHA, а
  отдельный реальный Git regression подтверждает отказ ветки без тега.
  Focused regression — `41 passed`; финальный полный evidence-набор —
  `371 passed` за `350.80s`.
- После всех code/test review-fixes точный uncommitted diff перенесён во
  внутренний full-history clone; SHA-256 сериализованного Git diff в source и
  clone совпал. Post-fix final verifier повторно завершился:
  `{"passed": true, "errors": []}`.
- CP7 screenshots и operations run намеренно ignored/untracked по privacy и
  Product Reset contract. Поэтому final verifier не объявляется portable
  PR/CI gate: GitHub CI проверяет tracked schema/evaluator tests, а полный
  release-owner gate выполняется локально после явной подготовки защищённого
  artifact set и повторной проверки exact manifest hashes. В fresh clone без
  этих файлов verifier обязан оставаться красным.

#### Patch `1.0.2` — CaptionPanels auth compatibility hotfix

- 2026-08-03 подтверждена регрессия установленного CaptionPanels: CEP ожидает
  bearer из `access_token` и `/projects` API, тогда как Product Reset runtime
  `v1.0.1` возвращал только HttpOnly cookie и публиковал `/stories` API.
- Public preflight для точного `Origin: null` был исправен; проблема находилась
  в несовместимых auth/path contracts двух независимо зелёных test suites.
- Создана ветка `codex/fix-captionpanels-auth-compat` и чистый локальный worktree
  `/private/tmp/NewscastNavigator-captionpanels-auth-compat`; основной checkout
  остался на чистом `main`. Первый checkout на внешнем томе был остановлен как
  незавершённый из-за зависшего worktree index и полностью удалён без изменений.
- Baseline focused suite до правок: `29 passed`. TDD RED зафиксировал отсутствие
  token purpose, `access_token` и `/projects`; GREEN реализует отдельный
  `captionpanels` purpose, exact `Origin: null`, server-side revocation,
  восьмичасовой TTL, browser-cookie isolation и совместимые project aliases
  поверх единого story.
- Focused auth/CaptionPanels suite после TTL/config correction: `130 passed`;
  полный backend: `971 passed, 2 skipped`; frontend: `25` files / `210 passed`;
  production build: `166 modules transformed`. Local/test/demo Compose config
  прошли, оба runtime Compose явно получают `CAPTIONPANELS_TOKEN_TTL_SECONDS=28800`.
- Одноразовый HTTP smoke на отдельной SQLite test-double и порту `18102`
  подтвердил exact `Origin: null` preflight, отсутствие token у browser login,
  scoped login/me, список `30` `/projects` и current import-json. Token не
  печатался; временный сервер остановлен, БД удалена. Две предварительные
  попытки были fail-closed: старый Python без Alembic и SQLite вне test-env;
  sandbox localhost потребовал отдельного сетевого разрешения.
- Первый CodeRabbit review commit `dd2fdac` поднял `1 major + 2 minor`: в
  integration runbook отсутствовал полный backend gate, TTL assertion зависел
  от времени SQL lookup, а `0/-1` не отклонялись конфигурацией. Correction
  commit `29a3033` закрыл все три; corrected focused suite — `132 passed`.
  Второй review потребовал доказать exact TTL validation field и допустимую
  нижнюю границу `1`; test-only commit `5505390` это закрепил (`3 passed`).
  Финальный CodeRabbit review всех трёх commits: issues `0`.
- Production, push, PR, merge и deploy не выполнялись.

### Release `1.1.0` — Task 9 readiness slice

- Implementation commit:
  `d7ca25efbdabd89e7df6111b09f9621b78aa4e6a`
  (`chore(release): prepare Newscast Navigator 1.1.0`).
- Backend/frontend metadata и lock root синхронизированы на `1.1.0`; changelog
  содержит только утверждённые header/DOCX изменения без обещаний PDF,
  export archive или font embedding. `EVAL_COMMANDS.json` дополнен ровно семью
  release-records группы `v1_1_0_local`; historical `EVAL_RESULT.json` и
  `DEMO_EVIDENCE.json` не изменялись.
- TDD RED: version — `1 failed` на старом `1.0.2`; release registry —
  `1 failed` из-за отсутствия 7 records; smoke — `7 failed, 16 passed` из-за
  отсутствия `docx_export` и DOCX header/ZIP enforcement. Focused GREEN:
  version `1 passed`, registry `1 passed`, smoke `23 passed`.
- Authenticated smoke теперь получает первый story id, читает canonical
  scenario, формирует expectation stdlib JSON и только затем выполняет DOCX
  POST с session cookie. Он проверяет `200`, exact content type, attachment,
  `no-store`, ненулевой размер и ZIP. Cookie, пароль, story text и DOCX bytes
  не печатаются; клиентский temp удаляется существующим trap. Без credentials
  результат явно содержит `docx_export=false`.
- Synthetic render helper начат отдельным RED: `3 failed, 1 passed` при
  отсутствии script. GREEN — `4 passed`: frozen no-DB snapshot, длинное
  название, empty/non-empty duration variants, пять типов блоков, multiple
  bundles, 240 строк и все whitelist fonts/fills; output обязателен, только
  `.docx`, symlink запрещён, parent создаётся только в release artifacts или
  OS temp. Runtime route helper не импортирует.
- Operations inventory прошёл второй pass по migration, locks, smoke, helper,
  rehearsal, backup/restore, seed, health и CI. Новый deploy/recovery path не
  создан. Rollback additive migration требует предыдущие application images и
  predeploy DB restore. Зафиксированы открытые render/font substitution и
  concurrent snapshot mismatch риски.
- Полный exact backend gate из brief завершился: `357 passed` за `1051.09s`.
  Первый полный frontend gate выявил ровно два stale release literals:
  `260 passed, 2 failed`; после синхронизации footer tests на `1.1.0` повтор
  завершился `27 files / 262 tests passed`. Production build — exit `0`,
  `167 modules transformed`. `npm install --package-lock-only --ignore-scripts`
  выполнен повторно, lock остаётся синхронизированным. Actual browser render,
  clean rehearsal и CodeRabbit остаются Task 10.

## Следующее действие

Task 10 выполняет actual render, clean rehearsal, полный release review и
CodeRabbit. Внешняя интеграция, production smoke, push, PR, merge, tag и
deploy — только по отдельной команде.
