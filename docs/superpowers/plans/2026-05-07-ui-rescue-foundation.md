# UI Rescue Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the mixed UI-redesign layer safely, restore a stable frontend baseline, and prepare a controlled path for a new UI that replaces old screens instead of layering on top of them.

**Architecture:** Keep backend, database, security hardening, workflow contracts, editor-core, comments, text-state, exports, and Story Exchange behavior intact. First revert only the frontend UI-redesign delta from `c9f0f2b..7710b6c`, then verify the app returns to the stable MAIN -> EDITOR flow. Future UI work must replace one screen boundary at a time.

**Tech Stack:** React, TypeScript, Vite, FastAPI API contract, existing CSS.

---

### Task 1: Restore Frontend Baseline

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/MainPage.tsx`
- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/components/ProjectsTable.tsx`
- Modify: `frontend/src/styles.css`
- Remove: frontend files added only by the mixed UI redesign.

- [ ] **Step 1: Confirm clean branch state**

Run:

```bash
git status --short --branch
git diff --stat
git diff --name-only
```

Expected: branch `refactor/ui-rescue-foundation`, no uncommitted changes except this plan if it has already been created.

- [ ] **Step 2: Apply frontend-only reverse patch**

Run:

```bash
git diff c9f0f2b..7710b6c -- frontend | git apply --reverse
```

Expected: reverse patch applies without conflicts.

- [ ] **Step 3: Confirm only frontend and plan files changed**

Run:

```bash
git diff --name-status
```

Expected: frontend UI files changed or deleted, this plan file added, no backend/deploy/security files reverted.

### Task 2: Preserve Useful Non-UI Changes

**Files:**
- Keep unchanged: `backend/app/api/routes/users.py`
- Keep unchanged: `backend/tests/test_api_smoke.py`
- Keep unchanged: deploy and runtime hardening files from PR #12-#14.

- [ ] **Step 1: Verify backend user workflow change is still present**

Run:

```bash
rg -n "def list_users|get_current_user|require_roles" backend/app/api/routes/users.py
```

Expected: `list_users` depends on `get_current_user`, not admin-only `require_roles(["admin"])`.

- [ ] **Step 2: Verify production hardening files are not part of the UI rollback**

Run:

```bash
git diff --name-only -- backend deploy .env.example docs/DEPLOYMENT_UBUNTU_RU.md
```

Expected: no output from the frontend rollback.

### Task 3: Validate Stable Frontend Flow

**Files:**
- Validate: `frontend/src/App.tsx`
- Validate: `frontend/src/pages/MainPage.tsx`
- Validate: `frontend/src/pages/EditorPage.tsx`

- [ ] **Step 1: Build frontend**

Run:

```bash
cd frontend && npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 2: Inspect route composition**

Run:

```bash
rg -n "ProjectCardPage|embedded|renderProjectSection|AppShell|ProjectList" frontend/src
```

Expected after rollback: no `ProjectCardPage`, no embedded editor wrapper, no new shell/list components from the failed mixed redesign.

- [ ] **Step 3: Verify editor remains direct MAIN -> EDITOR**

Run:

```bash
rg -n "view === \"editor\"|<EditorPage|onOpenEditor|Назад в MAIN" frontend/src/App.tsx frontend/src/pages/MainPage.tsx frontend/src/pages/EditorPage.tsx
```

Expected: `App.tsx` renders `EditorPage` directly for editor view; `MainPage` opens the selected project directly; `EditorPage` owns its own header/back control.

### Task 4: Stop Before New UI Work

**Files:**
- No new implementation files in this task.

- [ ] **Step 1: Summarize rollback diff**

Run:

```bash
git diff --stat
git diff --name-status
```

Expected: concise rollback diff with no backend/deploy regressions.

- [ ] **Step 2: Report and wait for approval**

Report:

```text
Changed:
- frontend-only mixed redesign removed
- stable MAIN -> EDITOR flow restored
- backend/security changes preserved

Verify:
- cd frontend && npm run build
- optional browser smoke: login -> list -> open editor -> edit text -> wait autosave -> back

Next:
- design new UI replacement in separate small steps
```

No commit, PR, deploy, or new UI implementation until explicit approval.
