# Финальный обзор ветки UI System

## Scope и процесс

Диапазон: `d7a0300f8e68e24c7dd5aafb8a9ce02bf48df26f..f1ed4cf7b5b0d1ee4aefc3532867660a1287a635`, ветка `codex/ui-system`, worktree `/private/tmp/NewscastNavigator-ui-system`.

Выполнен один общий read-only обзор интеграции по `final-review-brief.md` и предоставленному `final-review-package.txt`. Проверены утверждённый `UI_SYSTEM_IMPLEMENTATION_PLAN_RU.md`, `docs/design/UI_SYSTEM_RU.md`, текущие уточнения SPEC/EVAL, ledger и scoped reports/reviews. Основное внимание — границы между доступом, первым вводом, autosave, основным шрифтом, историей, DOCX, автором, производством и удалением архива; также общая тема, формы, зависимость MUI, документация и назначение дизайн-артефактов. Сгенерированные Paper exports рассматриваются как артефакты дизайна, а не исполняемые компоненты приложения. Их hash-проверку и визуальную проверку итоговых снимков выполнил root; reviewer не выдаёт их за собственный повторный render.

Тесты и сборки повторно не запускались. CodeRabbit и субагенты не использовались. Source, index и HEAD не менялись; единственная запись reviewer — этот отчёт. Финальная актуализация evidence-документов после результатов проверок принадлежит root и не входит в reviewed runtime SHA.

## Strengths

- `frontend/src/features/scenario/useScenarioAutosave.ts:152`, `backend/app/services/scenario_service.py:324`, `backend/app/services/scenario_history.py:376`: строки и основной шрифт проходят через один snapshot/очередь/revision. Поздний ACK сравнивается с конкретным доставляемым snapshot, поэтому новая font-only правка не становится ложно сохранённой. История, draft и restore используют тот же состав состояния.
- `frontend/src/features/scenario/useScenarioAccess.ts:39`, `frontend/src/features/editor-core/EditorField.tsx:87`: право мутации связано с собственным действующим токеном, а canonical ProseMirror закрыт транзакционным барьером. Первый ввод отделён от canonical rows; polling не гидратирует редактор. `useScenarioAccess.ts:136` сохраняет порядок flush → release; release-only retry не пересылает текст повторно.
- `frontend/src/features/scenario/scenarioTableModel.ts:138`, `frontend/src/features/editor-core/RegistryFontFamily.ts:6`: missing/empty/null font наследует основной, а непустые явные гарнитуры сохраняются. B/I не материализуют дефолт. DOCX и semantic history получают контекст обеих сторон, без изменения внешнего CaptionPanels JSON.
- `frontend/src/pages/StoryHistoryPage.tsx:242`, `:252`, `:286`: открытость, загрузка и кэш сравнений разделены; адресный retry сохраняет более позднее намерение пользователя. ACK восстановления отделён от последующего GET, а no-op получает нейтральное объяснение. `frontend/src/features/history/textChangeRanges.ts:22` ограничивает стоимость сравнения и сохраняет исходные UTF-16 offsets; React выводит текст без внедрения HTML.
- `backend/app/services/scenario_history.py:341`: no-op сравнивает rows и font после серверных guards и до создания новой revision/session/event. Восстановление использует конец выбранного сеанса и сохраняет последующую историю.
- `backend/app/services/story_service.py:177`, `:334`: шаблон создаётся только внутри создания сюжета; удаление архива использует существующий aggregate lock, повторную проверку активного пользователя/функций и FK cascade. Общие users/rubrics и внешние файлы не являются объектами удаления.
- `frontend/src/features/stories/components/StoryAuthorControl.tsx:49`: смена автора обновляет только author/management, без замены локального содержимого сценария. В production и archive сохранено разделение команды и canonical refresh; действия и доступность берутся из серверного read model.
- `frontend/src/shared/ui/theme.ts:5`, `frontend/src/shared/ui/UiProvider.tsx:6`: тема читает действующие CSS tokens и подключается один раз. Глобальный CssBaseline не добавлен, собственная типографика редактора сохранена. Заменённые author-select, отдельная карточка озвучки и соответствующие старые стили удалены, параллельного UI-режима не создано.

## Issues

### Critical — Must Fix

Новых подтверждённых замечаний нет.

### Important — Should Fix

Новых подтверждённых замечаний нет. Прежние findings Task2/3/5/6/7b закрыты направленными исправлениями и scoped re-review; общий обзор не выявил их повторного появления на межфункциональных границах.

### Minor — Nice to Have

Новых actionable замечаний нет. Унаследованные deprecation warnings, dependency advisories и ограничение downgrade compact retry cache остаются явно указанными ограничениями, а не новыми дефектами этого обзора.

## Spec compliance

Рассмотренная реализация соответствует R-001–R-012 и утверждённым ограничениям: один актуальный сценарий; пять колонок и синяя шапка; Onest только для UI; два основных и шесть ручных шрифтов; одноразовый шаблон; техническое чтение по умолчанию с редакционным входом при совмещении; приоритет запрещающих функций при удалении; корректные Unicode shortcuts; сохранённые workflow, DOCX и CaptionPanels. Отложенная визуальная проба таблицы не импортирована в runtime.

Отдельно проверен вопрос root о надписи «Сохранённые состояния 0 → 3». `docs/product-reset/SPEC_RU.md:185` прямо допускает технический номер вторичным контекстом открытого сравнения. Текущее место в `ScenarioSessionDiff` соответствует этому разрешению; оснований превращать надпись в finding нет.

Промежуточные статусы Task5/7 и старые результаты в WORK_ITEMS/UX_EVAL/EVAL_RESULT/operations inventory должны быть согласованы root с финальной evidence при handoff. Это известная незавершённая запись текущего прохода, а не утверждение reviewer о готовности ещё не записанных документов. Исторические CP7 scores не использовались как доказательство готовности UI System.

## Verification evidence

Проверены окончания доступных immutable логов:

| Проверка | Результат |
|---|---|
| Backend на `f103f99`, backend не менялся в `f1ed4cf` | 1072 passed, 4 skipped, 2209 warnings, 254.69 s |
| Frontend на `f1ed4cf` | 558 passed / 59 files, 26.48 s, без прежних unhandled errors |
| TypeScript/Vite build на `f1ed4cf` | PASS, 2.42 s |
| Все три Chromium projects на `f1ed4cf` | 147 passed, 2 BFCache skips, 49.4 s; root указал строгий actual-font flag |
| Current docs/repository/eval на `f1ed4cf` | 314 passed, 315 warnings, 157.09 s |

Логи: `output/implementation/immutable-f103f99-backend.log` и `immutable-f1ed4cf-{frontend,build,browser,docs-eval}.log`.

Дополнительно прочитан `result.json` канонической локальной репетиции `20260914T230951Z-f1ed4cf7b5b0-71501666` в immutable checkout: exact evaluated commit `f1ed4cf7b5b0d1ee4aefc3532867660a1287a635`, fresh build, migration, synthetic seed, health/smoke, checksum backup, restore в пустую БД, matched counts и post-restore smoke — PASS. Root отдельно подтвердил DOCX smoke, `compose config --quiet` и очистку трёх собственных Compose projects до нуля containers/volumes/networks. Проверка cleanup здесь опирается на сообщение root, а не на повторное управление Docker reviewer.

Task5 report и ledger фиксируют реальные PostgreSQL migration/font/delete tests (38 passed), обе блокирующие delete/restore гонки, actual-font Chromium evidence и просмотр всех шести страниц DOCX в двух основных гарнитурах. Scoped review reports не заменяли проверку интеграционного кода, но позволили не повторять уже зелёные suites.

## Оставшиеся границы проверки

- Два BFCache browser skips остаются skips, а не PASS; физический BFCache и поведение жизненного цикла конкретного браузера этим прогоном полностью не доказаны.
- Физические RU/EN клавиатуры, системный IME/отказ в праве во время IME и настоящий drag из внешнего приложения требуют ручной проверки. Synthetic browser events не объявляются такой проверкой.
- Windows и Word на Windows не запускались. Обе основные гарнитуры проверены в текущем macOS/Chromium/LibreOffice окружении; один Roboto Slab был подменён в LibreOffice при сохранённом имени в OOXML, что уже раскрыто в Task5 report. Шрифты пользователя не копировались в репозиторий.
- Live browser против реального FastAPI/PostgreSQL не следует автоматически из mock-backed UI suites плюс отдельных API/PG и rehearsal checks. Эти уровни дают совместную evidence, но не заменяют ручной рабочий platform smoke.
- Внешнее применение — push, PR, merge, deploy и обновление домашнего/рабочего сервера — требует отдельной команды пользователя. Этот технический review не выдаёт такое разрешение.

## Assessment

**Spec compliance: Approved для reviewed runtime.**

**Technical quality / ready to merge: Yes, после завершения root финальной записи evidence; новых обязательных code fixes по этому обзору нет.**

Основные межфункциональные контракты согласованы и подтверждены объединёнными проверками и канонической локальной репетицией. Техническая готовность текущей реализации отделена от ручных platform gates и отсутствующего внешнего разрешения; complete production acceptance не заявляется.
