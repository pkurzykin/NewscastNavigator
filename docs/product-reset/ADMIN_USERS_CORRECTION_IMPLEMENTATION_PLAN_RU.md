# Управление сотрудниками и обязательная смена временного пароля — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить заглушку `/admin` полноценным chief-only управлением сотрудниками и сделать обязательную смену временного пароля серверным инвариантом.

**Architecture:** Аутентификация разделяется на получение действующей сессии и gate готового постоянного пароля. Auth endpoints используют первый dependency, все domain/admin endpoints продолжают использовать `get_current_user`, который теперь отклоняет временный пароль. Chief-only read model возвращает пользователей и серверный справочник функций; frontend выполняет команды через существующие API и после каждого успеха refetch-ит список.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy 2, PostgreSQL, React 18, TypeScript, Vitest, Testing Library, Playwright.

## Global Constraints

- Пользователями управляет только функция `chief`.
- Должность и несколько функций сохраняются; единственная роль и переключатель роли не вводятся.
- Последний активный `chief` не может быть отключён или лишён функции начальника.
- Login, `/auth/me`, `/auth/change-password` и logout доступны при временном пароле; остальные endpoints возвращают `403 PASSWORD_CHANGE_REQUIRED`.
- Пароли и password hashes никогда не возвращаются API, не выводятся UI и не попадают в логи.
- Логин после создания не редактируется.
- Реальные фамилии, контакты и production secrets не добавляются в репозиторий или тесты.
- Существующий production-admin и его пароль сохраняются при deploy.
- Не менять табличный редактор сценария, CaptionPanels и утверждённую workflow-модель.

---

## Карта файлов

**Backend auth и read model**

- `backend/app/api/deps.py` — raw authenticated dependency и password-change gate.
- `backend/app/api/routes/auth.py` — `/me` и `/change-password` используют raw dependency.
- `backend/app/schemas/admin.py` — user item и list response.
- `backend/app/services/admin_user_queries.py` — chief users read model.
- `backend/app/api/routes/admin.py` — `GET /api/v1/admin/users`.
- `backend/app/domain/codes.py` — канонические русские labels функций.

**Backend tests**

- `backend/tests/test_auth.py` — server-enforced temporary-password gate.
- `backend/tests/test_admin.py` — list contract, chief-only access и отсутствие секретов.

**Frontend**

- `frontend/src/features/admin/types.ts` — admin read-model types.
- `frontend/src/features/admin/api.ts` — list/create/update/reset functions.
- `frontend/src/features/admin/AdminUsersManager.tsx` — table, dialogs и command state.
- `frontend/src/features/admin/AdminUsersManager.test.tsx` — component behavior.
- `frontend/src/pages/AdminUsersPage.tsx` — page composition вместо заглушки.
- `frontend/src/styles/admin.css` — compact table/dialog layout.
- `frontend/src/main.tsx` — подключение admin styles.
- `frontend/e2e/admin-users.spec.ts` — browser chief and temporary-password flows.
- `frontend/e2e/accessibility.spec.ts` — accessibility route coverage.

**Документы**

- `docs/product-reset/IMPLEMENTATION_PLAN_RU.md` — read endpoint и auth gate.
- `docs/product-reset/EVAL_RUBRIC_RU.md` — критерии управления пользователями.
- `docs/product-reset/PROGRESS.md` — RED/GREEN, commits, browser и review evidence.

---

### Task 1: Server-enforced temporary-password gate

**Files:**

- Modify: `backend/tests/test_auth.py`
- Modify: `backend/app/api/deps.py`
- Modify: `backend/app/api/routes/auth.py`

**Interfaces:**

- Produces: `get_authenticated_user(request, db) -> User`.
- Produces: `get_current_user(authenticated_user=Depends(get_authenticated_user)) -> User`.
- Produces: canonical `403` error with code `PASSWORD_CHANGE_REQUIRED`.

- [ ] **Step 1: Write the failing auth test**

Add a user with `must_change_password=True`, log in, and assert:

```python
assert client.get("/api/v1/auth/me").status_code == 200
blocked = client.get("/api/v1/stories?scope=active")
assert blocked.status_code == 403
assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
changed = client.post(
    "/api/v1/auth/change-password",
    json={
        "current_password": "Temporary-Auth-2026!",
        "new_password": "Permanent-Auth-2026!",
    },
)
assert changed.status_code == 200
assert client.get("/api/v1/stories?scope=active").status_code == 200
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd backend
pytest -q tests/test_auth.py -k temporary_password_gate
```

Expected: domain request returns `200`, proving the frontend-only gap.

- [ ] **Step 3: Implement the dependency split**

Move the current cookie/session/user lookup body into
`get_authenticated_user`. Implement `get_current_user` as:

```python
def get_current_user(
    authenticated_user: User = Depends(get_authenticated_user),
) -> User:
    if authenticated_user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PASSWORD_CHANGE_REQUIRED",
                "message": "Сначала смените временный пароль",
            },
        )
    return authenticated_user
```

Change `/auth/me` and `/auth/change-password` to depend on
`get_authenticated_user`. Login and logout remain unchanged.

- [ ] **Step 4: Run auth and permission tests**

Run:

```bash
cd backend
pytest -q tests/test_auth.py tests/test_permissions.py
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit the gate**

```bash
git add backend/app/api/deps.py backend/app/api/routes/auth.py backend/tests/test_auth.py
git commit -m "fix(auth): enforce temporary password change"
```

---

### Task 2: Chief users read model

**Files:**

- Modify: `backend/tests/test_admin.py`
- Modify: `backend/app/domain/codes.py`
- Modify: `backend/app/schemas/admin.py`
- Create: `backend/app/services/admin_user_queries.py`
- Modify: `backend/app/api/routes/admin.py`

**Interfaces:**

- Produces: `FUNCTION_LABELS: dict[str, str]`.
- Produces: `AdminUserItem`.
- Produces: `AdminUsersResponse(items, function_options)`.
- Produces: `list_admin_users(db) -> AdminUsersResponse`.
- Produces: `GET /api/v1/admin/users`.

- [ ] **Step 1: Write failing list tests**

Assert a chief receives active users first and then inactive users, with stable
secondary sorting by `display_name.casefold()` and `id`. Assert every item has
only:

```python
{
    "id",
    "username",
    "display_name",
    "position",
    "function_codes",
    "is_active",
    "must_change_password",
    "created_at",
    "updated_at",
}
```

Also assert `password_hash` and `password_changed_at` are absent, and
non-`chief` receives `403 FORBIDDEN`.

- [ ] **Step 2: Run admin list tests and verify RED**

Run:

```bash
cd backend
pytest -q tests/test_admin.py -k "list_admin_users or only_chief_can_list"
```

Expected: `GET /api/v1/admin/users` returns `405`.

- [ ] **Step 3: Implement schemas, query and route**

Define:

```python
class AdminUserItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    display_name: str
    position: str
    function_codes: list[str]
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime


class AdminUsersResponse(BaseModel):
    items: list[AdminUserItem]
    function_options: list[CodeLabel]
```

`list_admin_users` selects users with functions loaded, sorts active first and
returns every `FUNCTION_CODES` entry in the fixed order:
`chief`, `chief_editor`, `author`, `proofreader`, `video_editor`, `designer`,
`operator`.

Add:

```python
@router.get("/users", response_model=AdminUsersResponse)
def get_users(
    db: Session = Depends(get_db),
    _chief: User = Depends(require_chief),
) -> AdminUsersResponse:
    return list_admin_users(db)
```

- [ ] **Step 4: Run full admin tests**

Run:

```bash
cd backend
pytest -q tests/test_admin.py
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit the read model**

```bash
git add backend/app/domain/codes.py backend/app/schemas/admin.py \
  backend/app/services/admin_user_queries.py backend/app/api/routes/admin.py \
  backend/tests/test_admin.py
git commit -m "feat(admin): add employee read model"
```

---

### Task 3: Admin page component

**Files:**

- Create: `frontend/src/features/admin/types.ts`
- Create: `frontend/src/features/admin/api.ts`
- Create: `frontend/src/features/admin/AdminUsersManager.tsx`
- Create: `frontend/src/features/admin/AdminUsersManager.test.tsx`
- Modify: `frontend/src/pages/AdminUsersPage.tsx`
- Create: `frontend/src/styles/admin.css`
- Modify: `frontend/src/main.tsx`

**Interfaces:**

- Consumes: `GET /api/v1/admin/users` and existing admin command endpoints.
- Produces: `fetchAdminUsers() -> Promise<AdminUsersResponse>`.
- Produces: `createAdminUser`, `updateAdminUser`, `resetAdminUserPassword`.
- Produces: `<AdminUsersManager currentUserId={number} />`.

- [ ] **Step 1: Write failing component tests**

Mock the admin API module and assert:

- initial loading fetches and renders active and inactive users;
- «Добавить сотрудника» sends normalized non-password fields, checked function
  codes and the temporary password;
- successful create clears both password inputs, closes the dialog and
  refetches;
- edit sends only display name, position and function codes;
- «Отключить» requires a confirmation before `is_active:false`;
- «Активировать» sends `is_active:true`;
- password reset requires equal values, clears both values and refetches;
- a rejected command keeps the form open and renders its message with
  `role="alert"`;
- no submitted password appears in the resulting list DOM.

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
cd frontend
npx vitest run src/features/admin/AdminUsersManager.test.tsx
```

Expected: module/component imports fail because the feature does not exist.

- [ ] **Step 3: Implement types, API and manager**

Use the existing `apiRequest` client. The manager owns:

```typescript
type DialogState =
  | { kind: "create" }
  | { kind: "edit"; user: AdminUserItem }
  | { kind: "reset"; user: AdminUserItem }
  | null;
```

Use a single `refresh()` after every successful command, a single
`pendingUserId`/`submitting` guard, controlled password inputs, native
`<dialog open>` semantics with labelled headings, and checkboxes generated
only from `response.function_options`.

The list shows:

- `Имя`;
- `Логин`;
- `Должность`;
- `Функции`;
- `Учётная запись`;
- `Пароль`;
- `Действия`.

Do not place password values in component state outside the active create/reset
dialog.

- [ ] **Step 4: Run component and app-shell tests**

Run:

```bash
cd frontend
npx vitest run src/features/admin/AdminUsersManager.test.tsx \
  src/components/app-shell/AppShell.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit the admin UI**

```bash
git add frontend/src/features/admin frontend/src/pages/AdminUsersPage.tsx \
  frontend/src/styles/admin.css frontend/src/main.tsx
git commit -m "feat(admin): manage employee accounts"
```

---

### Task 4: Browser, accessibility and product documents

**Files:**

- Create: `frontend/e2e/admin-users.spec.ts`
- Modify: `frontend/e2e/accessibility.spec.ts`
- Modify: `docs/product-reset/IMPLEMENTATION_PLAN_RU.md`
- Modify: `docs/product-reset/EVAL_RUBRIC_RU.md`
- Modify: `docs/product-reset/PROGRESS.md`

**Interfaces:**

- Consumes: completed backend/frontend admin feature.
- Produces: browser evidence for chief CRUD and password gate.

- [ ] **Step 1: Add browser contract**

Route/mock the auth and admin endpoints. Verify at both configured viewports:

1. chief opens `/admin`, creates a combined-function employee, edits the
   position, disables and reactivates the account, and resets its password;
2. every command is followed by a refreshed read model;
3. a `must_change_password=true` login renders only «Смена пароля» and no
   AppShell navigation until successful change;
4. the admin table and dialogs have no document-level horizontal overflow;
5. non-chief navigation has no «Сотрудники» link.

- [ ] **Step 2: Run focused browser tests**

Run:

```bash
cd frontend
PLAYWRIGHT_PORT=5174 npx playwright test e2e/admin-users.spec.ts \
  e2e/accessibility.spec.ts --workers=1
```

Expected: all selected Chromium projects pass; BFCache capability skip remains
unrelated.

- [ ] **Step 3: Update canonical documents**

Add `GET /api/v1/admin/users` and the temporary-password server gate to the
approved API/auth sections of `IMPLEMENTATION_PLAN_RU.md`. Add explicit
read/manage/password-gate checks to `EVAL_RUBRIC_RU.md`. Record exact RED/GREEN,
full-test, browser, CodeRabbit and commit evidence in `PROGRESS.md`.

- [ ] **Step 4: Run full local gates**

Run:

```bash
cd backend && pytest -q
cd frontend && npm run test -- --run
cd frontend && npm run build -- --emptyOutDir false
cd frontend && PLAYWRIGHT_PORT=5174 npx playwright test --workers=1
docker compose -f deploy/compose.demo.yaml --env-file deploy/env/demo.env.example config
git diff --check main...HEAD
```

Expected: all supported tests and configs pass. Final evaluator remains
fail-closed until the newly merged exact SHA is deployed and fresh external
evidence is recorded.

- [ ] **Step 5: Run scoped CodeRabbit review and commit corrections**

Run authenticated reviews by directory so every request stays below the
free-plan file limit:

```bash
coderabbit review --agent --dir backend/app -c AGENTS.md
coderabbit review --agent --dir backend/tests -c AGENTS.md
coderabbit review --agent --dir frontend -c AGENTS.md
coderabbit review --agent --dir deploy -c AGENTS.md
coderabbit review --agent --dir docs -c AGENTS.md
```

Resolve actionable findings with tests, rerun affected gates, then commit:

```bash
git add frontend/e2e/admin-users.spec.ts frontend/e2e/accessibility.spec.ts \
  docs/product-reset/IMPLEMENTATION_PLAN_RU.md \
  docs/product-reset/EVAL_RUBRIC_RU.md docs/product-reset/PROGRESS.md
git commit -m "test(admin): verify employee account workflow"
```

---

## Self-review

- Spec coverage: chief control, multiple functions, active/inactive records,
  last-chief invariant, temporary-password gate and production-admin
  preservation each have an implementation and test task.
- Product exclusions: no registration, contacts, role switching, deletion,
  parallel mode or password disclosure is introduced.
- Type consistency: `AdminUserItem`, `AdminUsersResponse`, function option codes
  and the three command payloads have one matching backend/frontend shape.
- Deploy boundary: implementation completes locally first; push, PR, merge and
  deploy happen only after every local gate and review passes under the
  separate authorization already given by the owner.
