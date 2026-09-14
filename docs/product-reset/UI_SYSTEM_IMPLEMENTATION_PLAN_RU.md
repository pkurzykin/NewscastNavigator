# Дизайн-система и редактор — утверждённый план внедрения

> **For agentic workers:** применять superpowers:subagent-driven-development и TDD. Все действия выполнять в этом worktree. CodeRabbit запрещён пользователем; ревью выполняют Codex и его субагенты.

**Статус:** локальная реализация завершена 15 сентября 2026, независимые reviews и локальные автоматические gates пройдены; ручная приёмка и внешняя интеграция впереди. План и два уточнения явно утверждены Павлом 14 сентября 2026 года. Разрешены локальная реализация, зависимости, проверки, небольшие коммиты и использование подходящих моделей субагентов. Push, PR, merge и deploy не разрешены.

**База:** `d7a0300f8e68e24c7dd5aafb8a9ce02bf48df26f`, приложение 1.2.0. Ветка `codex/ui-system`. Это развитие существующего Product Reset, а не повторная пересборка или удаление действующей базы.

**Goal:** перенести принятый дизайн в работающие компоненты и реализовать R-001–R-011, сохранив существующий редактор, интеграции и актуальный текст.

**Architecture:** React/Vite и FastAPI/PostgreSQL сохраняются. MUI/Emotion оформляют стандартный UI через общую тему. Tiptap и таблица остаются существующими. Новая настройка основного шрифта проходит через единый revision-safe snapshot и autosave; отдельной системы сохранения не создаётся.

**Spec:** `SPEC_RU.md`, `EVAL_RUBRIC_RU.md`, `../../artifacts/WORK_ITEMS_RU.md`, требования в `../../artifacts/planning/` и принятые макеты, перечисленные в `../design/UI_SYSTEM_RU.md`.

## Global Constraints

- Один актуальный сценарий; локальный ввод главнее серверного ack. Нельзя перезагружать Tiptap после фонового сохранения или смены автора.
- Синяя шапка `#BEDCE6`, пять столбцов, все поля/типы/файлы/TC, CaptionPanels, DOCX, поиск/замена, undo/redo и перетаскивание сохраняются.
- UI — Onest. Шесть ручных гарнитур редактора: PT Sans, Arial, Georgia, Times New Roman, Roboto Slab, Franklin Gothic Book. Основной шрифт — PT Sans или Franklin Gothic Book; ручные overrides сохраняются.
- Настройка основного шрифта принадлежит сценарию. Отсутствующий `font_family` означает наследование. B/I не материализуют наследуемый шрифт; существующие явные значения не стираются.
- Начальный шаблон ровно один раз: Подводка → ЗК → СНХ → ЗК. Новые строки имеют стабильные ID до показа.
- Все активные пользователи могут править активный сценарий после получения своей lease. Наличие только технических функций означает чтение по умолчанию. При совмещении с author/proofreader/chief/chief_editor — редакционный вход.
- Удаление разрешено активному пользователю без video_editor/designer только для архивного сюжета. Запрещающие функции имеют приоритет, включая chief/chief_editor.
- Alt/Option+Minus и NumpadSubtract вставляют U+2013; обычный минус остаётся дефисом. Quote преобразуется в прямую кавычку только при фактическом вводе двойной кавычки, не вместо Э/апострофа.
- Из новых макетов редактора берём только ранее принятые панели доступа и шрифта. Последняя визуальная проба таблицы оценена «3 с минусом», её редизайн отложен для Paper.
- Синтетические тесты. Реальные данные/секреты не читать и не коммитить. Внешние файлы материалов не удалять.
- CodeRabbit не использовать, не отправлять ему код. Проверка Codex: task review, полный обзор ветки, тесты, браузер.

## Task 1: Дизайн-система и общая оболочка

**Files:** создать `frontend/src/shared/ui/theme.ts`, `UiProvider.tsx` и небольшие общие контролы по фактическому использованию; `docs/design/UI_SYSTEM_RU.md`. Изменить `frontend/package.json`, lock, `src/main.tsx`, `src/styles/tokens.css`, `base.css`, `layout.css`, `components/app-shell/AppShell.tsx`, `UserProfileMenu.tsx`, `features/notifications/components/NotificationTray.tsx`, соответствующие тесты, `docs/THIRD_PARTY_NOTICES.md`.

**Interfaces:** стандартные MUI Button, Dialog, Autocomplete, Switch, Alert с русскими доступными именами; цвета/плотность задаёт одна тема. Существующие CSS-переменные сохраняются как интерфейс feature CSS. Глобальный CssBaseline не применять к редактору.

- [x] Сначала исходные unit/build/backend проверки и сохранённые снимки; проверить immutable baseline manifest.
- [x] Зафиксировать сбой существующей геометрии относительно принятого компактного header браузерной проверкой; сохранить проверки клавиатуры/профиля.
- [x] Добавить MUI/Emotion и согласовать react-is с фактическим React 18 по официальной документации, зафиксировать lock. Не менять React/Vite major.
- [x] Настроить тему: Onest, тёплый фон, белые поверхности, `#245F9E`, умеренные рамки/тени. Создать единый источник токенов без ручного дублирования значений в теме и CSS.
- [x] Перенести компактную общую шапку с одинаковыми краями с контентом. На 1366 — боковые поля 36 и шапка 56; на широком экране сохранить полезную рабочую ширину.
- [x] Проверить браузер/axe, редакторские шрифты и отсутствие побочного reset. Обновить PROGRESS и сделать локальный commit.

## Task 2: Сюжеты, автор и производство

**Files:** `frontend/src/pages/StoriesPage.tsx`, `ArchivePage.tsx`, `StoryScenarioPage.tsx`, `StoryProductionPage.tsx`, `StoryHistoryPage.tsx`; `features/stories/components/StoriesTable.tsx`, `StoryHeader.tsx`, `StoryTabs.tsx`, `StoryFilters.tsx`, `ActionButton.tsx`; создать `StoryAuthorControl.tsx`, `features/production/components/AssignmentPicker.tsx`; production/corrections/external-approval компоненты и feature CSS. Тесты `StoriesTable`, `StoryManagement`, `StoryAuthorControl`, `ProductionReadModel`, `StoryScenarioPage.handoff`, `e2e/story-management.spec.ts`, `production-workflow.spec.ts`.

**Interfaces:** автор меняется через действующий `updateStoryManagement(action,{author_user_id})`, варианты и права — из read model. Назначения — существующие PUT/DELETE. Никаких новых business gates во frontend.

- [x] RED: статичный автор у всех ролей; только video_editor/designer в исполнителях; сохранение автора chief и chief_editor через карточку без сброса локального сценария.
- [x] Автор — `display_name.trim() || username`. Удалить prop/callback/select старой смены автора только одновременно с доступной заменой в карточке.
- [x] Внедрить компактный список по принятому эталону: без повторного заголовка/счётчика, счётчик снизу; priority/очередь/поиск/рубрики/создание сохраняются.
- [x] Диалог «Изменить автора»: server options, без «Без автора», явное сохранение, ошибки не сбрасывают выбор, stale guard, focus return.
- [x] RED: назначение применяется при явном выборе, поиск/клавиатурная навигация не отправляют запрос; «Без исполнителя» снимает назначение. Ошибка/повтор и stale response проверены.
- [x] Вынести Assignments из большой страницы, удалить отдельные «Сохранить»/«Снять», названия заменить на «Правки»/«Исполнители». Корректор в Производстве остаётся.
- [x] Оформить доступные действия по read model: один primary, одиночный secondary виден сразу, остальные сгруппированы в контексте этапа. Проверить полный workflow и роли, PROGRESS, commit.

## Task 3: Доступ к сценарию R-007/R-008

**Files:** `frontend/src/features/scenario/components/ScenarioEditor.tsx`, `ScenarioRow.tsx`, `EditLeaseNotice.tsx`, `AutosaveStatus.tsx`, `useEditLease.ts`, `editLeaseController.ts`, `api.ts`, `types.ts`, `draftStorage.ts`, `useScenarioAutosave.ts`; `features/editor-core/EditorField.tsx`; `pages/StoryScenarioPage.tsx`; `backend/app/api/routes/scenario.py`, `schemas/scenario.py`, `services/scenario_sessions.py`. Создать изолированный hook/coordinator доступа и тесты рядом; расширить `ScenarioEditor.autosave`, `useEditLease`, `e2e/scenario-autosave.spec.ts`, backend lease tests.

**Interfaces:** существующая token-bearing lease единственная. Отдельный read-only GET состояния доступа, без текста; опрос видимой вкладки каждые 5 секунд и при focus/pageshow. Серверная проверка при acquire/save закрывает окно опроса. `mine` без совпадения session/token не даёт редакторского права.

- [x] RED: два пользователя/две вкладки, намерение первого ввода до acquire, held после открытия, доступ после expiry, архив, чтение технических функций и подтверждённые совмещения.
- [x] Редакционный вход инициируется взаимодействием с полем/командой изменения; содержимое остаётся неизменяемым до acquire. Нельзя терять первый символ, paste, drop или IME; сохранить intent/selection в coordinator и применять только после успеха. При отказе сохранить ввод как локальный кандидат, не записывать его в канонические rows.
- [x] Для технического чтения явный Switch. После включения acquire; выключение flush → release → read. При ошибке текст остаётся и успешного выхода не показываем.
- [x] Чтение допускает выделение, копирование, поиск, DOCX; запрещает все мутации, включая тип, drag, файлы, форматирование, undo/redo/replace и metadata controls в этом режиме.
- [x] Фоновое обновление доступа не гидратирует rows. Утрата права/ошибка/черновик не вызывают автозапись чужой сессией. Истёкшее право требует повторного входа и проверки revision.
- [x] Проверить quiet-save, focus/selection/scroll, возврат страницы, долгий текст, сохранить синюю шапку. PROGRESS, commit.

## Task 4: Тире, кавычки и GEO R-002/R-003/R-005

**Files:** новые `frontend/src/features/editor-core/typographyKeyboard.ts`, `TypographyKeyboardExtension.ts` и тесты; существующие `extensions.ts`, `russianQuotes.ts`, `RussianQuotesExtension.ts`, `scenario/scenarioTableModel.ts`; `backend/app/services/scenario_docx_renderer.py`, renderer tests, `frontend/e2e/editor-typography.spec.ts`. Полный исходный подробный план — `artifacts/planning/2026-09-13-author-and-typing/IMPLEMENTATION_PLAN_RU.md`, checkpoints B/D; его прежний статус согласования заменён утверждением этого плана.

- [x] RED: NumpadSubtract/Alt+Minus U+2013, Minus/ShiftMinus штатные; Ctrl/Meta/AltGr/IME не перехватываются; Quote только при key=`"`; smart RU Shift2/paste/Э/@ сохраняются.
- [x] Реализовать одну ProseMirror-транзакцию на символ/выделение с сохранением marks и общей истории. U+2013 добавить в контекст открывающей кавычки.
- [x] RED frontend/DOCX GEO default bold+italic, explicit overrides и другие типы не меняются; затем изменить defaults.
- [x] Проверить exact Unicode в DOCX/CaptionPanels и браузерный contenteditable, не выдавать synthetic key event за проверку системной раскладки. PROGRESS, commit.

## Task 5: Основной шрифт R-009

**Files:** `backend/app/db/models/scenario.py`, новая additive migration `backend/migrations/versions/20260914_0005_scenario_default_font.py`; `schemas/scenario.py`, `services/scenario_service.py`, `scenario_history.py`, `scenario_diff.py`, `scenario_serialization.py`, `scenario_docx_snapshot.py`, `scenario_docx_renderer.py`; frontend scenario types/model/history/draft/autosave/export coordinator, editor toolbar и editor-core `RegistryFontFamily.ts`, `EditorField.tsx`; тесты всех указанных контрактов, `e2e/scenario-docx-export.spec.ts`, `editor-characterization.spec.ts`.

**Interfaces:** `default_font_family: "PT Sans" | "Franklin Gothic Book"` у текущего сценария и immutable revision snapshot. Сохраняется атомарно с rows в той же команде и защищается lease/base_revision/client_save_id. Поле входит в idempotency hash, историю/restore и DOCX snapshot. Пустой per-target font — наследование, не третий шрифт.

- [x] RED: basic font change persists with rows, idempotent retry distinguishes differing font, stale ack cannot overwrite selected font, draft/history/undo/redo/restore preserve default and explicit marks.
- [x] Добавить настройку текущего snapshot и технических снимков; прежние записи получают PT Sans. Никакого сброса/переписывания старых строк и шрифтов.
- [x] Расширить существующий coordinator на snapshot `{rows, default_font_family}`; отдельного автосохранения/истории шрифта не создавать.
- [x] Панель «Шрифт сценария»: два значения. Ручной выбор содержит шесть гарнитур и «Основной (…)»; выбор B/I не фиксирует случайный шрифт. Явный PT Sans сохраняется при переключении на Franklin.
- [x] DOCX и semantic history отражают выбор, включая изменение только гарнитуры. Текст CaptionPanels остаётся тем же; контракт внешнего JSON не расширять без нужды.
- [x] Проверить реальные доступные fonts, долгий текст и оба направления выбора в браузере. PROGRESS, commit.

## Task 6: Начальный шаблон и архив R-010/R-006

**Files:** `backend/app/services/story_service.py`, `permissions.py`, `story_queries.py`, `api/routes/stories.py`, `schemas/stories.py`; создать `services/scenario_initial_template.py` и `tests/test_archive_delete.py`; расширить `test_stories_api.py`, `test_story_read_models.py`, `test_archive.py`, `test_captionpanels_current_scenario.py`; frontend `pages/ArchivePage.tsx`, stories API/types/table, новый `ArchiveDeleteDialog.tsx`, lifecycle/component/browser tests. В модели/FK менять только доказанную недостающую связь.

- [x] RED: POST story создаёт четыре пустых rows с разными стабильными UID в порядке podvodka/zk/snh/zk, revision 0. Просмотр/новый вход/удаление последней строки не повторяет шаблон. Первый revision boundary включает созданные строки без фальшивого сеанса ввода.
- [x] Создать шаблон один раз на сервере; прежний frontend empty fallback не превращать в четыре строки.
- [x] RED: archived delete права на single/combined functions (deny precedence), inactive, active story, rollback, delete/restore race, связанные записи и сохранение общих справочников.
- [x] Конкретная команда DELETE story с серверной проверкой и блокировкой в существующем порядке. Удаляются scenario/revisions/sessions/rows/read markers/workflow/production/corrections/approval/material links/notifications/events через проверенные FK cascade. Общие users/rubrics и внешние файлы сохраняются.
- [x] Архивная таблица: название/рубрика/автор/исполнители/«В архиве с»/действия. Restore и delete имеют независимые права. Подтверждение с названием, focus на отмене, pending/ошибка/повтор; строку удалять только после ack и canonical refresh.
- [x] Удалённая карточка/CaptionPanels возвращают понятный not found. Локальные черновики не должны вновь создать удалённый сюжет. PROGRESS, commit.

## Task 7: Остальные поверхности, проверка и handoff

**Files:** history/notifications/admin/auth/release-notes компоненты и CSS по общим UI правилам без изменения business flow; соответствующие unit/browser tests. `docs/product-reset/PROGRESS.md`, `SPEC_RU.md`, `EVAL_RUBRIC_RU.md`, `UX_EVAL_RU.md`, `EVAL_RESULT.json`, `OPERATIONS_INVENTORY_RU.md`, `docs/THIRD_PARTY_NOTICES.md`, `docs/design/UI_SYSTEM_RU.md`.

- [x] Применить общий дизайн к истории/diff, уведомлениям, формам; не добавлять новые продуктовые функции и не перерабатывать отложенную таблицу.
- [x] R-012, добавлено пользователем 15 сентября: в Истории заметно выделять изменённые фрагменты цветом и дополнительным доступным обозначением. «Показать изменения» повторным нажатием сворачивает сравнение; aria-expanded/подпись соответствуют состоянию, поздний GET не раскрывает отменённый просмотр.
- [x] R-012: проверить названную пользователем кнопку «сбросить изменения» (в текущем коде найдено «Восстановить» / «Восстановить состояние»). Воспроизвести на синтетическом сценарии, сверить целевое состояние, реальную серверную команду, обновление текущего текста, pending/error/retry, права/lease и отсутствие эффекта при выборе уже текущего состояния. Исправить подтверждённые сбои, сохранить историю и основной/ручные шрифты из Task5. Не вводить отдельные пользовательские версии. Подробности: `../../artifacts/planning/2026-09-15-history-review/REQUIREMENTS_RU.md`.
- [x] После каждого функционального checkpoint — targeted tests, полный доступный backend/frontend, build и релевантный browser. Не маскировать прежние/новые failures и skips.
- [x] Финал: `backend/.venv/bin/python -m pytest -q`; frontend `npm test -- --run`, `npm run build`, `npm run test:e2e -- --project=chromium-1366`, `--project=chromium-1920`, существующий wide-layout проект.
- [x] PostgreSQL API/migration/delete concurrency, clean build/seed/health/smoke/backup/restore в отдельном локальном compose-project. Никаких действий на домашнем/рабочем сервере.
- [x] Собственные screenshots before/after, axe, keyboard, focus/scroll, все роли, сохранение/ошибки/черновики, DOCX render, CaptionPanels contract. UX score считать по evidence, не назначать заранее.
- [x] Ранний и финальный operations inventory: существующие canonical scripts KEEP; ADAPT только если изменившаяся schema/контракт требует. Не повторять историческое удаление Product Reset.
- [x] Task review и whole-branch review средствами Codex, исправить реальные findings, повторить затронутые проверки. CodeRabbit не вызывать.
- [x] Локальные commits и итог пользователю: что реализовано, проверки, оставшиеся физические/platform gates. После этого пользователь отдельно решает о внешней интеграции.

## Зависимости и порядок интеграции

1 → 2 → 3 → 4 → 5 → 6 → 7. Независимый Task 4 можно подготовить отдельно во время Task 1; применять к общему редактору до Task 5. Task 5 и Task 3 не редактируют общие coordinators одновременно. Task 6 backend-шаблон можно исследовать независимо, но UI архива зависит от общей темы. Один implementer-субагент за раз; read-only аудит/ревью может идти параллельно работе root.

Изменения, которые должны стать одним working checkpoint: удаление старого author-select и новый диалог; новый шрифт через все snapshot-пути; удаление архива вместе с server/UI правами. На каждом checkpoint удаляются заменённые контролы и стили, а не скрываются CSS.
