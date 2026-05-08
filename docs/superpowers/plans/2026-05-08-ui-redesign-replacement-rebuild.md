# UI Redesign Replacement Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заново выполнить UI-редизайн Newscast Navigator через замену старых UI-участков, а не через наложение новых оболочек поверх старых экранов.

**Architecture:** `MAIN` остается единой newsroom-очередью, а экран сюжета перестраивается как `Story workspace`: карточка одного сюжета с секциями `Обзор`, `Текст`, `Правки`, `Материалы`, `Производство`, `История`. `EditorPage` на первом этапе остается владельцем данных, autosave, handlers и editor-core; новые компоненты получают уже вычисленные props и не меняют save/data-flow. Запрещено возвращать `ProjectCardPage`, который условно монтирует/размонтирует `EditorPage`.

**Tech Stack:** React 18, TypeScript, Vite, текущий CSS без нового UI-framework, FastAPI API без изменений, existing editor-core/Tiptap без изменений.

---

## 0. Why This Plan Exists

Старый implementation plan от `2026-04-29` был правильным по продуктовой цели, но опасным по способу внедрения:

- новый UI был добавлен поверх старого;
- появились конкурирующие экраны выбора сюжета;
- карточка сюжета оборачивала редактор вместо замены структуры;
- вкладки могли размонтировать редактор и рисковали autosave/local editor state;
- технические labels начали просачиваться в пользовательский UI.

Этот план сохраняет цель старого редизайна, но меняет способ реализации:

- один replacement-блок за раз;
- старый UI-участок удаляется или перестает рендериться в том же коммите;
- editor-core/table/autosave считаются protected core;
- после каждого блока выполняется build + browser smoke.

## 1. Non-Negotiable Guardrails

Запрещено:

- создавать `ProjectCardPage`, который рендерит `EditorPage` внутри вкладки;
- делать conditional render, который размонтирует editor-core при переключении секций;
- добавлять второй список сюжетов рядом с `ProjectWorkQueue`;
- возвращать `AppShell`, `ProjectList`, `ProjectsTable` из неудачного overlay-редизайна без пересмотра;
- менять `frontend/src/features/editor-core/EditorField.tsx`;
- менять row model editor-table без отдельного autosave/rich-text плана;
- менять backend/API без отдельного решения.

Protected core в `frontend/src/pages/EditorPage.tsx`:

- `EditorCoreField` props contract;
- `buildNextRowWithRichFieldValue`;
- `applyRichFieldValue`;
- `getRichTextTarget`;
- `updateRichTextTarget`;
- `normalizeRichTextForBlockChange`;
- `createTableSignature`;
- `createWorkflowSignature`;
- `createWorkspaceSignature`;
- `persistTable`;
- `persistWorkflow`;
- `persistWorkspace`;
- table autosave effects and request-id guards;
- `tiptapEditorRefs`, `pendingEditorFocusRef`, selection/focus handling.

## 2. Target UX

### MAIN

`MAIN` должен быть одним рабочим экраном:

- верхний application shell с брендом, пользователем и действиями;
- быстрые разделы очереди;
- список сюжетов как newsroom queue;
- приоритет и причина;
- следующий шаг;
- handoff текста;
- production tracks;
- команда;
- действие `Открыть карточку`.

### Story Workspace

Экран сюжета должен выглядеть как карточка одного workflow-объекта:

- header карточки: название, статус, рубрика, команда, save state;
- status strip: рабочий текст, текущий текст, проверено, вычитано;
- section navigation: `Обзор`, `Текст`, `Правки`, `Материалы`, `Производство`, `История`;
- `Текст` содержит protected editor table/editor-core и не размонтируется при навигации;
- `Обзор` показывает next action, открытые задачи и production readiness;
- `Правки` показывает action comments и diff-сигналы;
- `Материалы` показывает folders/files/workspace notes;
- `Производство` показывает монтаж/титры/озвучку/сдачу;
- `История` показывает history/revisions/diff without global overlay as primary navigation.

## 3. File Strategy

Create:

- `frontend/src/shared/labels.ts`  
  Единые русские labels для ролей, статусов проекта, production tracks, material types, comment targets.

- `frontend/src/shared/date.ts`  
  Единый `formatDateTime`, `formatDate`, `formatTextSeq`.

- `frontend/src/features/projects/projectPriority.ts`  
  Чистый расчет приоритета и sort weight.

- `frontend/src/features/projects/projectPresentation.ts`  
  Чистые presentation helpers для очереди и карточки.

- `frontend/src/components/app-shell/AppShell.tsx`
- `frontend/src/components/app-shell/UserProfileMenu.tsx`
- `frontend/src/components/ui/StatusBadge.tsx`
- `frontend/src/components/ui/PriorityBadge.tsx`
- `frontend/src/components/story-workspace/StoryWorkspaceHeader.tsx`
- `frontend/src/components/story-workspace/StoryWorkspaceStatusStrip.tsx`
- `frontend/src/components/story-workspace/StoryWorkspaceNav.tsx`
- `frontend/src/components/story-workspace/StoryOverviewPanel.tsx`
- `frontend/src/components/story-workspace/StoryTextStatePanel.tsx`
- `frontend/src/components/story-workspace/StoryProductionPanel.tsx`

Modify:

- `frontend/src/App.tsx`
- `frontend/src/pages/MainPage.tsx`
- `frontend/src/components/ProjectWorkQueue.tsx`
- `frontend/src/pages/EditorPage.tsx`
- `frontend/src/styles.css`
- `docs/WEB_SMOKE_CHECKLIST_RU.md`

Do not modify in this plan:

- `frontend/src/features/editor-core/EditorField.tsx`
- `backend/`
- `deploy/`
- database migrations

## 4. Execution Tasks

### Task 1: Shared Presentation Foundation

**Purpose:** убрать локальные дубли словарей и расчетов из страниц, чтобы следующий replacement не копировал бизнес-логику между компонентами.

**Files:**

- Create: `frontend/src/shared/labels.ts`
- Create: `frontend/src/shared/date.ts`
- Create: `frontend/src/features/projects/projectPriority.ts`
- Create: `frontend/src/features/projects/projectPresentation.ts`
- Modify: `frontend/src/pages/MainPage.tsx`
- Modify: `frontend/src/components/ProjectWorkQueue.tsx`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Create labels/date helpers**

Implement Russian labels currently duplicated in `MainPage.tsx`, `ProjectWorkQueue.tsx`, and `EditorPage.tsx`. Use existing type names from `frontend/src/shared/types.ts`.

- [ ] **Step 2: Move queue priority calculation**

Move `projectQueuePriority`, date sorting helpers, and visible priority state from page/component-local functions into `features/projects`.

- [ ] **Step 3: Rewire MAIN without changing behavior**

`MainPage.tsx` keeps filtering, API actions, user admin, create/clone/archive/restore. Only imports shared helpers.

- [ ] **Step 4: Verify**

Run:

```bash
cd frontend && npm run build
git diff --check
```

Expected:

- build passes;
- no backend changes;
- `ProjectWorkQueue` still opens projects.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/labels.ts frontend/src/shared/date.ts frontend/src/features/projects frontend/src/pages/MainPage.tsx frontend/src/components/ProjectWorkQueue.tsx docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: extract project presentation helpers"
```

### Task 2: Application Shell Replacement

**Purpose:** вернуть цель старого shell-редизайна без overlay: единый shell заменяет старый global header для authenticated app.

**Files:**

- Create: `frontend/src/components/app-shell/AppShell.tsx`
- Create: `frontend/src/components/app-shell/UserProfileMenu.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/MainPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Add shell components**

`AppShell` receives:

```ts
interface AppShellProps {
  user: UserPublic;
  activeSection: "queue" | "story" | "admin";
  onOpenQueue: () => void;
  onOpenChangePassword: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}
```

- [ ] **Step 2: Replace authenticated header**

`App.tsx` keeps login/change-password outside shell. Authenticated `main/story` views render inside `AppShell`. Do not add a second brand header in `MainPage`.

- [ ] **Step 3: Preserve auth lifecycle**

Keep:

- localStorage token handling;
- `must_change_password`;
- `ChangePasswordForm`;
- logout behavior.

- [ ] **Step 4: Verify**

Run:

```bash
cd frontend && npm run build
```

Browser smoke:

- open `http://127.0.0.1:5173`;
- login as local smoke user;
- verify shell visible;
- logout works;
- change password screen still reachable.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/app-shell frontend/src/App.tsx frontend/src/pages/MainPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: replace authenticated app shell"
```

### Task 3: MAIN Queue Replacement Completion

**Purpose:** завершить `MAIN` как новый queue-screen, а не косметически улучшенную старую страницу.

**Files:**

- Modify: `frontend/src/pages/MainPage.tsx`
- Modify: `frontend/src/components/ProjectWorkQueue.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Split MAIN into clear regions**

Keep one list only:

- queue summary;
- quick focus;
- selected project actions;
- advanced filters;
- `ProjectWorkQueue`.

Do not add `ProjectList` or `ProjectsTable`.

- [ ] **Step 2: Rename UI text away from technical labels**

Replace visible technical labels where touched:

- `MAIN` -> `Рабочая очередь`;
- `workspace/current/proofread` only if paired with Russian explanation: `Рабочий текст`, `Текущий текст`, `Вычитано`.

- [ ] **Step 3: Preserve all project actions**

Verify `createEmptyProject`, `cloneLastProject`, `cloneSelectedProject`, `archiveProject`, `restoreProject`, user admin remain callable from `MainPage`.

- [ ] **Step 4: Verify**

Run:

```bash
cd frontend && npm run build
git diff --check
```

Browser smoke:

- login;
- filter queue;
- select a project;
- open story workspace.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MainPage.tsx frontend/src/components/ProjectWorkQueue.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: complete main queue replacement"
```

### Task 4: Story Workspace Shell Replacement

**Purpose:** заменить старый editor shell на карточку сюжета внутри текущего `EditorPage`, не создавая wrapper page around editor.

**Files:**

- Create: `frontend/src/components/story-workspace/StoryWorkspaceHeader.tsx`
- Create: `frontend/src/components/story-workspace/StoryWorkspaceStatusStrip.tsx`
- Create: `frontend/src/components/story-workspace/StoryWorkspaceNav.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Add presentational header/status/nav components**

Components receive data and callbacks only. They do not fetch, save, or own editor state.

- [ ] **Step 2: Replace current editor hero/context/mode block**

Remove old `editor-hero`, `editor-context-strip`, `editor-mode-panel` render path from `EditorPage.tsx` in the same commit where new workspace shell appears.

- [ ] **Step 3: Keep editor table mounted**

Do not conditionally render the editor table based on active section. `StoryWorkspaceNav` may scroll/focus sections, but must not unmount editor-core.

- [ ] **Step 4: Verify**

Run:

```bash
cd frontend && npm run build
git diff --check
```

Browser smoke:

- login;
- open story;
- confirm story shell visible;
- switch/activate nav items;
- confirm editor fields still exist in DOM.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/story-workspace frontend/src/pages/EditorPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: replace editor shell with story workspace"
```

### Task 5: Overview Panel Replacement

**Purpose:** реализовать `Обзор` как настоящий entry point карточки сюжета, а не как еще одну карточку рядом с редактором.

**Files:**

- Create: `frontend/src/components/story-workspace/StoryOverviewPanel.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Build overview from existing computed values**

Use existing `project`, `openActionComments`, text-state booleans, production booleans. Do not add new API calls.

- [ ] **Step 2: Show next action**

Overview must show:

- current text risk;
- open action count;
- production resync warnings;
- responsible people;
- one primary next action.

- [ ] **Step 3: Avoid duplicate text-state cards**

If Overview shows summary, it must not duplicate the full `Состояние текста` panel. Summary only.

- [ ] **Step 4: Verify and commit**

```bash
cd frontend && npm run build
git diff --check
git add frontend/src/components/story-workspace/StoryOverviewPanel.tsx frontend/src/pages/EditorPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: add story overview panel"
```

### Task 6: Text Section Replacement Around Protected Editor Core

**Purpose:** сделать секцию `Текст` полноценной частью карточки, сохранив editor-core/table без изменений.

**Files:**

- Create: `frontend/src/components/story-workspace/StoryTextStatePanel.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Extract text-state UI**

Move only presentation markup and button wiring for text state into `StoryTextStatePanel`. Keep handlers in `EditorPage`.

- [ ] **Step 2: Keep protected editor table untouched**

No changes to:

- editor row rendering;
- `EditorCoreField`;
- rich text handlers;
- autosave effects.

- [ ] **Step 3: Verify text-state actions**

Browser smoke:

- open story;
- check `Сделать текущим`, `Проверено`, `Вычитано` disabled states;
- open diff button when available;
- do not edit text during this task unless explicitly testing autosave in a throwaway row.

- [ ] **Step 4: Commit**

```bash
cd frontend && npm run build
git diff --check
git add frontend/src/components/story-workspace/StoryTextStatePanel.tsx frontend/src/pages/EditorPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: replace story text state section"
```

### Task 7: Production Section Replacement

**Purpose:** заменить разрозненные cards `Озвучка`, `Монтаж`, `Титры`, `Внешняя сдача` на единый production section.

**Files:**

- Create: `frontend/src/components/story-workspace/StoryProductionPanel.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Extract presentation only**

Move existing render markup and props for production tracks. Keep existing handlers in `EditorPage`:

- `handleProjectVoiceoverAction`;
- `handleProjectEditAction`;
- `handleProjectTitlesAction`;
- `handleProjectFinalReviewStatusAction`;
- existing disabled conditions.

- [ ] **Step 2: Preserve resync warnings**

Every track must still show source seq and resync status.

- [ ] **Step 3: Verify and commit**

```bash
cd frontend && npm run build
git diff --check
git add frontend/src/components/story-workspace/StoryProductionPanel.tsx frontend/src/pages/EditorPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: replace story production section"
```

### Task 8: Comments and Action Tasks Replacement

**Purpose:** заменить comments area как секцию `Правки`, сохранив workflow lifecycle.

**Files:**

- Create: `frontend/src/components/story-workspace/StoryCommentsPanel.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Extract comments presentation**

Keep in `EditorPage`:

- `handleCreateComment`;
- `handleUpdateCommentWorkflow`;
- `handleResolveComment`;
- `handleReopenComment`;
- comment action state.

- [ ] **Step 2: Preserve lifecycle controls**

Smoke must still cover:

- assign;
- take in work;
- release;
- resolve;
- reopen;
- diff action.

- [ ] **Step 3: Verify and commit**

```bash
cd frontend && npm run build
git diff --check
git add frontend/src/components/story-workspace/StoryCommentsPanel.tsx frontend/src/pages/EditorPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: replace story comments section"
```

### Task 9: Materials and Workspace Replacement

**Purpose:** заменить materials/files/workspace note UI как секцию `Материалы`, без превращения приложения в media archive.

**Files:**

- Create: `frontend/src/components/story-workspace/StoryMaterialsPanel.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Extract materials/workspace presentation**

Keep in `EditorPage`:

- workspace autosave state;
- `handleAddMaterialLink`;
- `handleUpdateMaterialLink`;
- `handleDeleteMaterialLink`;
- upload/download handlers.

- [ ] **Step 2: Preserve data safety**

No file deletion behavior changes. No path hardcode. No storage/backend changes.

- [ ] **Step 3: Verify and commit**

```bash
cd frontend && npm run build
git diff --check
git add frontend/src/components/story-workspace/StoryMaterialsPanel.tsx frontend/src/pages/EditorPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: replace story materials section"
```

### Task 10: History and Revisions Replacement

**Purpose:** заменить history/revisions as section, not global overlay-first navigation.

**Files:**

- Create: `frontend/src/components/story-workspace/StoryHistoryPanel.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Extract history/revisions presentation**

Keep existing revision handlers in `EditorPage`:

- open revision;
- create revision;
- branch;
- submit;
- approve/reject;
- merge;
- restore to workspace;
- mark current.

- [ ] **Step 2: Preserve diff behavior**

Existing diff cards may remain, but section navigation must make history discoverable without relying on a global overlay.

- [ ] **Step 3: Verify and commit**

```bash
cd frontend && npm run build
git diff --check
git add frontend/src/components/story-workspace/StoryHistoryPanel.tsx frontend/src/pages/EditorPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: replace story history section"
```

### Task 11: Cleanup Old Overlay and Technical UI Terms

**Purpose:** удалить хвосты неудачного overlay-подхода и косметических временных блоков.

**Files:**

- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/pages/MainPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`

- [ ] **Step 1: Search forbidden terms/components**

Run:

```bash
rg -n "ProjectCardPage|AppShell|ProjectsTable|ProjectList|Workspace text|Current handoff|Proofread|MAIN|EDITOR" frontend/src docs/WEB_SMOKE_CHECKLIST_RU.md
```

Expected:

- no forbidden overlay components;
- technical English labels only in code identifiers or docs explaining internal terms, not user-facing strings.

- [ ] **Step 2: Remove dead CSS**

Remove CSS classes no longer referenced by `frontend/src`.

- [ ] **Step 3: Final smoke**

Run:

```bash
cd frontend && npm run build
git diff --check
```

Browser smoke:

- login;
- queue;
- open story;
- navigate sections;
- verify editor table still mounted;
- create/open diff if available;
- return to queue.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx frontend/src/pages/MainPage.tsx frontend/src/styles.css docs/WEB_SMOKE_CHECKLIST_RU.md
git commit -m "refactor: remove ui overlay remnants"
```

## 5. Verification Policy

For every task:

```bash
git status --short --branch
git diff --stat
git diff --name-only
cd frontend && npm run build
git diff --check
```

For frontend visual tasks:

- keep or start local backend on `127.0.0.1:8100`;
- start frontend with `VITE_PROXY_TARGET=http://127.0.0.1:8100 npm run dev -- --host 127.0.0.1 --port 5173`;
- use Playwright smoke for login, queue, story workspace, and editor presence.

Known non-blocker:

- `favicon.ico 404` in local dev console is not a UI-redesign blocker.

## 6. Progress Tracking

- [ ] Task 1: Shared Presentation Foundation
- [ ] Task 2: Application Shell Replacement
- [ ] Task 3: MAIN Queue Replacement Completion
- [ ] Task 4: Story Workspace Shell Replacement
- [ ] Task 5: Overview Panel Replacement
- [ ] Task 6: Text Section Replacement Around Protected Editor Core
- [ ] Task 7: Production Section Replacement
- [ ] Task 8: Comments and Action Tasks Replacement
- [ ] Task 9: Materials and Workspace Replacement
- [ ] Task 10: History and Revisions Replacement
- [ ] Task 11: Cleanup Old Overlay and Technical UI Terms

## 7. Self-Review

Spec coverage:

- role-aware main screen: Tasks 2-3;
- queue priority: Tasks 1 and 3;
- card/story workspace: Tasks 4-10;
- text/current/checked/proofread source of truth: Tasks 4 and 6;
- comments/actions: Task 8;
- materials: Task 9;
- production tracks: Task 7;
- history/revisions: Task 10;
- smoke docs: every task touches `docs/WEB_SMOKE_CHECKLIST_RU.md`;
- editor-core safety: Guardrails and Tasks 4, 6, 11.

Placeholder scan:

- no `TBD`;
- no `TODO`;
- no open-ended "add appropriate";
- all tasks define files, verification, and commit scope.

Type consistency:

- `ProjectListItem`, `UserPublic`, status value types come from `frontend/src/shared/types.ts`;
- new story workspace components are presentational;
- `EditorPage` remains state/data owner until a separate split plan exists.
