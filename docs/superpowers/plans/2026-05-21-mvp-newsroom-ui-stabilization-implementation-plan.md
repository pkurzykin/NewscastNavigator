# MVP Newsroom UI Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перестроить текущий web UI из набора компонентов в понятный newsroom-сервис: общий реестр, карточка сюжета с видимой редактируемой таблицей текста, production gates, ручное внешнее согласование и короткое создание карточки.

**Architecture:** Внедрение идет маленькими PR поверх существующего React + FastAPI web-only контура. Сначала устраняются конкурирующие entry points и UI-иерархия, затем точечно расширяется создание карточки, затем перестраивается карточка сюжета без переписывания editor-core. Старый UI не оставляется рядом как альтернативная структура: каждый PR должен явно заменить или удалить устаревший слой.

**Tech Stack:** React 18, TypeScript, Vite, FastAPI, SQLAlchemy, Alembic, PostgreSQL target, текущие backend tests через pytest, frontend verification через `npm run build` и browser/Playwright smoke.

---

## 0. Source Of Truth

Перед реализацией каждый агент читает:

- `AGENTS.md`
- `docs/GIT_WORKFLOW_RU.md`
- `docs/ENGINEERING_PLAN_RU.md`
- `docs/PROJECT_WORKFLOW_ARCHITECTURE_RU.md`
- `docs/superpowers/specs/2026-05-20-mvp-newsroom-service-design.md`
- `docs/superpowers/specs/2026-05-20-mvp-newsroom-ui-design.md`
- `docs/superpowers/specs/2026-05-20-mvp-newsroom-design-handoff.md`

Visual companion `.superpowers/brainstorm/*` не является source of truth и не коммитится.

## 1. Execution Model

Не выполнять этот roadmap одним большим PR.

Порядок веток после merge документационной ветки:

```text
main
→ feat/newsroom-registry-foundation
→ feat/newsroom-create-card-flow
→ feat/newsroom-story-card-text-first
→ feat/newsroom-production-gates
→ feat/newsroom-role-decluttering
→ chore/newsroom-production-smoke
```

Каждый PR:

- создается от актуального `main`;
- меняет одну логическую зону;
- удаляет или заменяет старый конкурирующий UI, а не накладывает новый слой;
- содержит build/test/smoke отчет;
- не трогает `frontend/src/features/editor-core/*`, кроме случаев отдельного editor bugfix PR.

## 2. Current Code Map

Основные frontend зоны:

- `frontend/src/pages/MainPage.tsx` — текущий главный список, фильтры, actions создания/клонирования/архива.
- `frontend/src/components/ProjectWorkQueue.tsx` — текущая таблица списка сюжетов.
- `frontend/src/pages/EditorPage.tsx` — большая карточка сюжета, editor table, workflow, comments, materials, production.
- `frontend/src/components/story-workspace/*` — панели карточки сюжета.
- `frontend/src/features/projects/projectPresentation.ts` — вычисление сигналов/лейблов проекта.
- `frontend/src/features/projects/projectPriority.ts` — сортировка.
- `frontend/src/shared/api.ts` — API client.
- `frontend/src/shared/types.ts` — TypeScript contracts.
- `frontend/src/shared/labels.ts` — статусы и русские labels.
- `frontend/src/styles.css` — текущая общая visual system.

Основные backend зоны:

- `backend/app/api/routes/projects.py` — CRUD проекта, статусы tracks, архив.
- `backend/app/api/routes/workspace.py` — workspace, material links, files.
- `backend/app/schemas/project.py` — project list/create/update contracts.
- `backend/app/schemas/workspace.py` — workspace/material contracts.
- `backend/app/db/models.py` — `Project`, tracks, material links.
- `backend/app/services/project_queries.py` — list item projection.
- `backend/tests/test_api_smoke.py` — существующий API smoke style.

## 3. Non-Negotiable Guardrails

- Главный список = общий newsroom-реестр, не персональная очередь.
- `Моя работа`, `Назначено мне`, `Ждет моего действия` = представления/фильтры внутри общего реестра.
- Карточка сюжета = рабочее место одного сюжета, не dashboard из равных блоков.
- Текстовая таблица видна и редактируема сразу в карточке, если роль имеет право.
- Autosave workspace не создает workflow text state.
- Text state создается явным действием.
- Production UI строится вокруг gates.
- `Зафиксировать правки` — один вход в правки текущего gate.
- Внешнее согласование = ручная отметка и результат, не approval-сервис.
- Архив и админка не смешиваются с daily newsroom flow.
- Editor-core не переписывать в рамках UI stabilization.

## 4. PR 1 — Registry Foundation

**Branch:** `feat/newsroom-registry-foundation`

**Goal:** Сделать главный экран единым newsroom-реестром с сохраненными представлениями, правым preview и понятным entry point.

**Files:**

- Modify: `frontend/src/pages/MainPage.tsx`
- Modify: `frontend/src/components/ProjectWorkQueue.tsx`
- Modify: `frontend/src/features/projects/projectPresentation.ts`
- Modify: `frontend/src/features/projects/projectPriority.ts`
- Modify: `frontend/src/shared/labels.ts`
- Modify: `frontend/src/styles.css`
- Do not modify: `backend/*`
- Do not modify: `frontend/src/pages/EditorPage.tsx`

**Agent:** frontend registry agent.

**Input docs:** UI spec sections 5, 6, 14, 17, 18, 19.

### Task 1.1 — Rename The Mental Model

- [ ] Replace visible text `Список сюжетов` / `Активные сюжеты` as main concept with `Реестр сюжетов` / `Все активные`.
- [ ] Keep archive as separate view, not a quick filter.
- [ ] Keep `Мои сюжеты`, `Назначено мне`, `Ждет моего действия`, `В работе`, `Срочные` as quick views inside registry.
- [ ] Remove any copy that suggests the main screen is only a personal queue.
- [ ] Run `cd frontend && npm run build`.
- [ ] Browser smoke: open main screen, verify first visible page reads as common registry.
- [ ] Commit: `git commit -m "feat: clarify newsroom registry entry point"`.

### Task 1.2 — Split Registry View Model From Page Rendering

- [ ] Create `frontend/src/features/projects/newsroomRegistry.ts`.
- [ ] Move pure functions from `MainPage.tsx` into it:
  - `collectMyWorkItems`
  - `buildMyWorkState`
  - `assignedRoleReasons`
  - `isAssignedToUser`
  - `isProjectInProgress`
  - `urgentSignalReasons`
  - `quickFilterMatches`
  - `quickFilterReasons`
- [ ] Export explicit types:
  - `NewsroomRegistryViewKey`
  - `NewsroomRegistryViewOption`
  - `NewsroomWorkItem`
  - `NewsroomWorkState`
- [ ] Keep no React imports in this file.
- [ ] Update `MainPage.tsx` imports.
- [ ] Run `cd frontend && npm run build`.
- [ ] Commit: `git commit -m "refactor: extract newsroom registry view model"`.

### Task 1.3 — Build Desktop Registry + Preview Layout

- [ ] Modify `ProjectWorkQueue.tsx` so table columns match UI spec:
  - `Сюжет`
  - `Стадия`
  - `Главный блокер`
  - `Ответственные`
  - `Треки`
  - `Выпуск / дата`
  - `Действие`
- [ ] Add selected-project preview in `MainPage.tsx` beside the table on desktop.
- [ ] Preview must show:
  - title;
  - stage/status;
  - main blocker;
  - team;
  - track summary;
  - last activity;
  - one primary action: `Открыть карточку`.
- [ ] On narrow viewport, hide preview and keep direct row opening.
- [ ] Remove duplicate selected-project action strip if it competes with row/preview action.
- [ ] Run `cd frontend && npm run build`.
- [ ] Browser smoke desktop: registry + preview visible.
- [ ] Browser smoke narrow: preview hidden, table/list usable.
- [ ] Commit: `git commit -m "feat: add newsroom registry preview layout"`.

### Task 1.4 — Registry PR Review Checklist

- [ ] Confirm no new backend fields were invented.
- [ ] Confirm `Моя работа` is not a separate screen.
- [ ] Confirm archive is visually separate from active registry.
- [ ] Confirm there is no card board by stage.
- [ ] Confirm screenshots are attached or referenced in PR body.

## 5. PR 2 — Create Card Flow

**Branch:** `feat/newsroom-create-card-flow`

**Goal:** Replace instant `Создать сюжет` with one `Создать карточку` flow: `Исходники / материал` or `Сюжет в работу`.

**Files:**

- Create: `backend/migrations/versions/20260521_0023_project_source_stage_and_story_date.py`
- Modify: `backend/app/db/models.py`
- Modify: `backend/app/schemas/project.py`
- Modify: `backend/app/api/routes/projects.py`
- Modify: `backend/app/services/project_access.py`
- Modify: `backend/app/services/project_queries.py`
- Modify: `backend/app/api/routes/workspace.py` only if creation needs to seed a material link.
- Modify: `backend/tests/test_api_smoke.py`
- Modify: `frontend/src/shared/types.ts`
- Modify: `frontend/src/shared/api.ts`
- Modify: `frontend/src/pages/MainPage.tsx`
- Create: `frontend/src/components/CreateProjectDialog.tsx`
- Modify: `frontend/src/styles.css`

**Agent:** full-stack create-card agent.

**Input docs:** service spec sections 5.1, 5.2, 5.3, 5.4; UI spec section 7.

### Task 2.1 — Backend Data Shape For Source Stage

- [ ] Add nullable `story_date` field to `Project`.
- [ ] Add Alembic migration for `projects.story_date`.
- [ ] Add `source` to `PROJECT_STATUS_VALUES`.
- [ ] Ensure `ACTIVE_PROJECT_STATUSES` includes `source`.
- [ ] Add `story_date` and status `source` to `ProjectListItem`.
- [ ] Update `project_to_item` projection so list/editor/workspace payloads expose `story_date`.
- [ ] Add frontend `ProjectStatusValue` option `source`.
- [ ] Add Russian status label `Исходники`.
- [ ] Run backend migration tests through `pytest`.
- [ ] Commit: `git commit -m "feat: add source stage metadata"`.

### Task 2.2 — Backend Contract For Creation Mode

- [ ] Extend `ProjectCreateRequest` with:
  - `creation_mode: Literal["source", "story"] | None`
  - `source_path: str | None`
  - `story_date: date | None`
  - `author_user_id: int | None`
  - `proofreader_user_id: int | None`
  - `edit_assignee_user_id: int | None`
  - `titles_assignee_user_id: int | None`
- [ ] Normalize default `creation_mode` to `story` for backward compatibility.
- [ ] For `source`:
  - require title;
  - allow empty rubric;
  - set status `source`;
  - store `story_date`;
  - store `source_path` in `project_file_root` and `project_file_roots_json`;
  - do not require role slots.
- [ ] For `story`:
  - require title and rubric;
  - set status `draft`;
  - store `story_date` if provided;
  - allow empty role slots;
  - validate role ids through existing assignee helpers.
- [ ] Do not add a heavy media archive model.

### Task 2.3 — Backend Tests

- [ ] Add test `test_create_source_card_requires_minimal_fields`.
- [ ] Add test `test_create_story_card_requires_rubric`.
- [ ] Add test `test_create_story_card_accepts_empty_role_slots`.
- [ ] Add test `test_create_story_card_sets_assignee_slots`.
- [ ] Add assertion that source cards appear in main list with status `source`.
- [ ] Add assertion that story/source date is returned in list payload.
- [ ] Run:

```bash
cd backend
./.venv/bin/python -m pytest -q backend/tests/test_api_smoke.py
```

- [ ] If local venv path differs, use the repo's documented backend test command and report it in PR.
- [ ] Commit: `git commit -m "feat: support newsroom card creation modes"`.

### Task 2.4 — Frontend Create Dialog

- [ ] Replace `Создать сюжет` button in `MainPage.tsx` with `Создать карточку`.
- [ ] Create `CreateProjectDialog.tsx`.
- [ ] Dialog first choice:
  - `Исходники / материал`
  - `Сюжет в работу`
- [ ] `Исходники / материал` fields:
  - date;
  - title;
  - source/archive path.
- [ ] `Сюжет в работу` fields:
  - date/release;
  - title;
  - rubric;
  - source/archive path;
  - author;
  - proofreader;
  - edit assignee;
  - titles assignee.
- [ ] Empty role slots must be visible as `можно назначить позже`.
- [ ] Remove `Из последнего` and `Из выбранного` from primary action row if they compete with `Создать карточку`; move them to secondary menu/details if still needed.
- [ ] Run `cd frontend && npm run build`.
- [ ] Browser smoke source card and story card creation.
- [ ] Commit: `git commit -m "feat: add newsroom create card dialog"`.

## 6. PR 3 — Story Card Text-First Layout

**Branch:** `feat/newsroom-story-card-text-first`

**Goal:** Make the card open as a story workspace with visible editable text table, not as a set of equal panels.

**Files:**

- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/components/story-workspace/StoryWorkspaceHeader.tsx`
- Modify: `frontend/src/components/story-workspace/StoryWorkspaceNav.tsx`
- Modify: `frontend/src/components/story-workspace/StoryWorkspaceStatusStrip.tsx`
- Modify: `frontend/src/components/story-workspace/StoryOverviewPanel.tsx`
- Modify: `frontend/src/components/story-workspace/StoryTextStatePanel.tsx`
- Modify: `frontend/src/styles.css`
- Do not modify: `frontend/src/features/editor-core/EditorField.tsx`
- Do not modify: `frontend/src/features/editor-core/extensions.ts`
- Do not modify: `frontend/src/features/editor-core/serializers.ts`

**Agent:** story-card frontend agent.

**Input docs:** UI spec sections 8, 9, 19, 20.

### Task 3.1 — Reorder Card Hierarchy

- [ ] Keep `StoryWorkspaceHeader` as command header.
- [ ] Reduce top-level nav to:
  - `Обзор`
  - `Текст`
  - `Производство`
  - `Согласование`
  - `История`
- [ ] Keep materials/comments as sections inside relevant contexts, not equal first-level tabs.
- [ ] Ensure `#story-text` appears immediately after header/status context, before secondary panels.
- [ ] Run `cd frontend && npm run build`.
- [ ] Commit: `git commit -m "feat: make story card text first"`.

### Task 3.2 — Make Text Table Visible And Editable Immediately

- [ ] Move the existing editor table markup in `EditorPage.tsx` into the main visible work area.
- [ ] Keep autosave behavior unchanged.
- [ ] Keep `rowsEditable` permission checks unchanged.
- [ ] Keep `EditorCoreField` unchanged.
- [ ] Change visible actions:
  - primary author action: `Отправить на проверку`;
  - secondary action: `Сохранить черновик`, if a manual save action remains visible;
  - no primary `Открыть редактор` gate.
- [ ] Ensure text state panel explains that autosave is draft, not production state.
- [ ] Run `cd frontend && npm run build`.
- [ ] Browser smoke: open card and verify rows are visible without clicking `Текст`.
- [ ] Commit: `git commit -m "feat: show editable text table in story card"`.

### Task 3.3 — Preserve Editor Safety

- [ ] Verify adding/editing/deleting/reordering rows still works.
- [ ] Verify rich text editor fields still type.
- [ ] Verify autosave still triggers only existing save path.
- [ ] Verify current text/check/proofread actions still work.
- [ ] Run browser smoke from `docs/WEB_SMOKE_CHECKLIST_RU.md` for editor-critical flows.
- [ ] Commit only if fixes are required; otherwise include verification in PR body.

## 7. PR 4 — Production Gates

**Branch:** `feat/newsroom-production-gates`

**Goal:** Replace production card grid with compact track strip and gate sequence.

**Files:**

- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/components/story-workspace/StoryProductionPanel.tsx`
- Create: `frontend/src/features/projects/productionGates.ts`
- Modify: `frontend/src/shared/labels.ts`
- Modify: `frontend/src/styles.css`
- Backend changes only if a missing transition cannot be represented by existing status endpoints.

**Agent:** production workflow frontend agent.

**Input docs:** service spec sections 9, 10, 11, 12, 13; UI spec sections 10, 11, 12, 13.

### Task 4.1 — Extract Gate View Model

- [ ] Create `productionGates.ts`.
- [ ] Export:
  - `ProductionGateKey`
  - `ProductionGateStatus`
  - `buildProductionGates(project: ProjectListItem): ProductionGate[]`
  - `getCurrentProductionGate(project: ProjectListItem): ProductionGate`
- [ ] Gate order:
  - text ready;
  - voiceover ready;
  - edit review;
  - titles;
  - titles review;
  - external approval.
- [ ] Do not encode external approval as user assignment.
- [ ] Run `cd frontend && npm run build`.
- [ ] Commit: `git commit -m "refactor: add production gate view model"`.

### Task 4.2 — Replace Equal Production Cards

- [ ] Update `StoryProductionPanel.tsx` to show:
  - compact track strip;
  - gate list;
  - current gate action panel.
- [ ] For edit review current gate:
  - show `Монтаж OK`;
  - show `Зафиксировать правки`;
  - show role/path details as secondary information.
- [ ] Move utility actions like open/copy path into track details, not header CTA.
- [ ] Remove three-way duplication of правки actions.
- [ ] Run `cd frontend && npm run build`.
- [ ] Browser smoke: production screen shows one current gate.
- [ ] Commit: `git commit -m "feat: show production gates in story card"`.

### Task 4.3 — Draft Titles And Final Titles Rules

- [ ] Add UI copy/state for `Разрешить черновые титры`.
- [ ] Show warning `Монтаж еще не принят. Титры черновые.` when applicable.
- [ ] Show final titles blocked until edit is OK.
- [ ] Show no override for changed text after titles: перетитровка required.
- [ ] If backend cannot store draft-titles permission yet, keep this as disabled/info state and create a follow-up backend plan rather than faking persisted state in frontend.
- [ ] Run `cd frontend && npm run build`.
- [ ] Commit: `git commit -m "feat: clarify draft and final title gates"`.

## 8. PR 5 — External Approval And Corrections UX

**Branch:** `feat/newsroom-external-approval-ux`

**Goal:** Make final approval a manual status cycle and make правки a contextual form, not duplicate buttons.

**Files:**

- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/components/story-workspace/StoryCommentsPanel.tsx`
- Modify: `frontend/src/components/story-workspace/StoryProductionPanel.tsx`
- Modify: `frontend/src/shared/labels.ts`
- Modify: `frontend/src/styles.css`
- Backend only if existing `final_review_status` and comments cannot represent the UX.

**Agent:** approval/corrections frontend agent.

**Input docs:** UI spec sections 11, 12, 13.

### Task 5.1 — Manual External Approval Panel

- [ ] Show external approval only after title review is OK.
- [ ] Actions:
  - `Отметить отправку на согласование`;
  - `Зафиксировать результат`.
- [ ] Result `OK` maps to final approved state and visible `Сдано`.
- [ ] Do not ask for send method, external approver accounts, upload package, or approval link.
- [ ] Run `cd frontend && npm run build`.
- [ ] Commit: `git commit -m "feat: simplify external approval workflow"`.

### Task 5.2 — Contextual Corrections Form

- [ ] Replace permanent `Замечание к ролику` block with contextual form opened by `Зафиксировать правки`.
- [ ] Defaults:
  - edit gate: visible zone `видео-монтаж`;
  - titles gate: visible zone `титры`;
  - external approval: zone chosen manually.
- [ ] Consequences options:
  - change source text;
  - retitle;
  - new voiceover;
  - re-edit.
- [ ] If `change source text` is selected, show text state warning.
- [ ] Use existing action comment API if possible; otherwise add a small backend follow-up before frontend merge.
- [ ] Run `cd frontend && npm run build`.
- [ ] Browser smoke: no duplicate правки entry points.
- [ ] Commit: `git commit -m "feat: make corrections contextual to current gate"`.

## 9. PR 6 — Role-Based Decluttering

**Branch:** `feat/newsroom-role-decluttering`

**Goal:** Keep one product but reduce visible noise by role.

**Files:**

- Modify: `frontend/src/features/projects/newsroomRegistry.ts`
- Modify: `frontend/src/pages/MainPage.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/components/story-workspace/*`
- Modify: `frontend/src/shared/labels.ts`
- Modify: `frontend/src/styles.css`
- Do not modify backend permissions unless a security gap is found.

**Agent:** role UX agent.

**Input docs:** UI spec section 14.

### Task 6.1 — Role-Aware Primary Actions

- [ ] For author/editor: primary card action is text work.
- [ ] For chief/editor role: primary actions are review/assign/check gates.
- [ ] For proofreader: primary action is proofread current text.
- [ ] For montager: primary action is current edit task.
- [ ] For designer: primary action is titles state and changed-text warning.
- [ ] For admin: admin UI remains separate; do not place user management in story card.
- [ ] Run `cd frontend && npm run build`.
- [ ] Commit: `git commit -m "feat: prioritize story actions by role"`.

### Task 6.2 — Hide Secondary Noise Without Replacing Permissions

- [ ] Hide non-primary management actions behind secondary menu/section per role.
- [ ] Do not rely on hiding for security; backend permission checks remain required.
- [ ] Keep enough read-only context for each role to understand where the story is.
- [ ] Run browser role walkthrough with at least admin, editor, author, proofreader, montager, designer demo users if available.
- [ ] Commit: `git commit -m "feat: reduce newsroom role noise"`.

## 10. PR 7 — Production Smoke, Security, And Cleanup

**Branch:** `chore/newsroom-production-smoke`

**Goal:** Verify the redesigned service feels like one coherent workflow and does not leave old UI paths beside new ones.

**Files:**

- Modify docs only if smoke checklist or runbook changes:
  - `docs/WEB_SMOKE_CHECKLIST_RU.md`
  - `docs/STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md`
- No product code unless smoke finds a bug.

**Agent:** QA/security smoke agent.

**Input docs:** all specs, `docs/WEB_SMOKE_CHECKLIST_RU.md`, `docs/ENGINEERING_PLAN_RU.md`.

### Task 7.1 — Full Browser Smoke

- [ ] Start backend/frontend using documented local workflow.
- [ ] Open app in browser.
- [ ] Verify:
  - login;
  - registry views;
  - create source card;
  - create story card;
  - open card;
  - edit text row;
  - autosave stays draft;
  - send/check/proofread text state;
  - production gates;
  - corrections form;
  - archive/restore;
  - admin user page separate.
- [ ] Capture desktop screenshot.
- [ ] Capture narrow viewport screenshot.
- [ ] Run `cd frontend && npm run build`.
- [ ] Run backend tests relevant to touched backend:

```bash
cd backend
./.venv/bin/python -m pytest -q
```

### Task 7.2 — Security Review Pass

- [ ] Use Codex Security plugin for a focused scan of changed auth/permissions/API surfaces.
- [ ] Verify no demo credentials or weak access assumptions were added.
- [ ] Verify no hardcoded paths, URLs, secrets, or server-specific config.
- [ ] Verify file/storage behavior still follows env config.
- [ ] Fix findings in separate `fix/*` branch if they are not directly caused by the current PR.

### Task 7.3 — Old UI Cleanup Audit

- [ ] Search for obsolete visible terms:

```bash
rg -n "Моя работа|Очередь|Открыть редактор|Добавить правки|Нужны правки|Список сюжетов|Создать сюжет" frontend/src
```

- [ ] For every match, decide:
  - keep because it is correct in context;
  - rename;
  - remove because it is old competing UI.
- [ ] Add notes to PR body.

## 11. Suggested Subagent Split

Recommended subagents/chats:

1. **Registry agent**
   - Scope: PR 1.
   - Files: `MainPage.tsx`, `ProjectWorkQueue.tsx`, `projectPresentation.ts`, `projectPriority.ts`, `styles.css`.
   - Return: registry PR with screenshots and build result.

2. **Create-card full-stack agent**
   - Scope: PR 2.
   - Files: `backend/app/schemas/project.py`, `backend/app/api/routes/projects.py`, `backend/tests/test_api_smoke.py`, `frontend/src/shared/*`, `MainPage.tsx`, `CreateProjectDialog.tsx`.
   - Return: tested create-card flow and backend contract.

3. **Story-card text agent**
   - Scope: PR 3.
   - Files: `EditorPage.tsx`, `story-workspace/*`, `styles.css`.
   - Return: card opens with visible editable table, editor smoke evidence.

4. **Production gates agent**
   - Scope: PR 4 and optionally PR 5 if PR 4 is merged.
   - Files: `EditorPage.tsx`, `StoryProductionPanel.tsx`, `productionGates.ts`, `StoryCommentsPanel.tsx`, `styles.css`.
   - Return: gates UI and no duplicate правки entry points.

5. **Role/QA/security agent**
   - Scope: PR 6 and PR 7.
   - Files: role view helpers, docs, smoke notes.
   - Return: role walkthrough, build/test results, security notes.

## 12. Parallelization Rules

Can run in parallel only after PR 1 is merged:

- Backend-only part of PR 2 can run while frontend registry polish continues, if it does not touch `MainPage.tsx`.
- QA/security preparation can draft checklists while PRs are in progress.

Do not run in parallel:

- PR 1 and frontend part of PR 2: both touch `MainPage.tsx` and create action placement.
- PR 3 and PR 4: both touch `EditorPage.tsx`, story workspace layout, and CSS.
- PR 4 and PR 5: both touch production/corrections UI and can easily duplicate actions.
- PR 6 before PR 3/4/5: role decluttering depends on final visible actions.

## 13. PR Order

Use this order:

1. Merge docs/spec/plan branch.
2. PR 1 registry foundation.
3. PR 2 create card flow.
4. PR 3 story card text-first.
5. PR 4 production gates.
6. PR 5 external approval and corrections UX.
7. PR 6 role-based decluttering.
8. PR 7 smoke/security/cleanup.

If a PR reveals missing backend data model:

- stop that PR at the smallest reproducible boundary;
- add a backend contract/migration PR before continuing frontend polish;
- do not fake persisted workflow state in frontend.

## 14. Verification Before Every PR

Minimum checks:

```bash
git status --short --branch
git diff --stat
git diff --name-only
git diff --check
cd frontend && npm run build
```

Backend checks if backend changed:

```bash
cd backend
./.venv/bin/python -m pytest -q
```

Browser checks if UI changed:

- desktop viewport;
- narrow viewport;
- screenshot;
- no text overlap;
- one primary CTA per current context;
- text editor/table still usable;
- no old competing UI left visible beside new UI.

## 15. Definition Of Done

MVP newsroom UI stabilization is done when:

- user starts in common registry and understands all active stories;
- personal work is a view/filter, not competing structure;
- creating source material or story card is one clear flow;
- card opens with visible editable text table;
- current text/proofread/production state is explicit;
- production gates explain the next step;
- corrections have one contextual entry point;
- external approval is manual and simple;
- roles see their main action first;
- admin remains separate;
- frontend build passes;
- backend tests pass for changed API;
- browser smoke passes on desktop and narrow viewport;
- PR history shows small reviewable changes, not one redesign bundle.
