# Управление приоритетом и даты реестра — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить безопасное управление приоритетом при создании и в реестре, а также показать канонические даты создания и последнего содержательного изменения сюжета.

**Architecture:** Backend остаётся единственным источником прав и допустимых значений: create-options возвращает варианты приоритета, а каждый story read model — leadership-only action изменения. `stories.updated_at` становится временем изменения всего агрегата; общий helper обновляет его в транзакциях domain events и отдельно при autosave сценария. Frontend не выводит собственных правил доступа: наличие server action определяет, показывать select или статическую метку.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy 2, PostgreSQL, React 18, TypeScript, Vitest, Testing Library, Playwright.

## Global Constraints

- Допустимы только `standard` (`Стандарт`) и `high` (`Высокий`).
- Значение при создании по умолчанию — `standard`.
- `high` устанавливают только начальник или шеф-редактор.
- «Изменён» учитывает содержательные изменения, включая autosave сценария.
- Чтение, edit-lease heartbeat и техническая доставка уведомлений не меняют `updated_at`.
- Колонки «Изменён» и «Создан» идут непосредственно справа от «Исполнители».
- Пользовательские даты отображаются без секунд в формате `28.07.2026, 19:15`.
- Не добавлять новый экран, новые значения приоритета, сортировку по датам или ручное редактирование дат.
- Не менять сохранённое поведение табличного редактора и CaptionPanels.
- Не push, не открывать PR, не merge и не deploy.

---

## Карта файлов

**Backend contracts и policy**

- `backend/app/schemas/stories.py` — request/read-model поля приоритета, `updated_at`, server actions и create options.
- `backend/app/services/action_policy.py` — leadership-only action изменения приоритета.
- `backend/app/services/story_queries.py` — сборка списка с `updated_at` и priority action.
- `backend/app/services/story_service.py` — создание с выбранным приоритетом и management command.
- `backend/app/api/routes/stories.py` — create-options и `PATCH /management`.

**Backend activity timestamp**

- `backend/app/services/story_activity.py` — единая операция обновления `stories.updated_at`.
- `backend/app/services/scenario_service.py` — timestamp успешного нового autosave, но не idempotent retry.
- `backend/app/services/workflow_service.py` — timestamp workflow event.
- `backend/app/services/production_service.py` — timestamp production, assignment и material events.
- `backend/app/services/correction_service.py` — timestamp correction events.
- `backend/app/services/external_approval_service.py` — timestamp внешнего согласования.

**Frontend**

- `frontend/src/shared/contracts.ts` — поля read model и create options.
- `frontend/src/features/stories/api.ts` — create payload и priority command.
- `frontend/src/features/stories/components/CreateStoryDialog.tsx` — выбор приоритета с server options.
- `frontend/src/features/stories/components/StoriesTable.tsx` — inline select, даты и восемь колонок.
- `frontend/src/pages/StoriesPage.tsx` — pending/error/refetch priority command.
- `frontend/src/styles/stories.css` — компактные даты и select без горизонтального overflow.

**Тесты и документы**

- `backend/tests/test_stories_api.py`
- `backend/tests/test_story_read_models.py`
- `backend/tests/test_scenario_autosave.py`
- `frontend/src/features/stories/StoriesTable.test.tsx`
- `frontend/src/features/stories/StoryLifecycle.test.tsx`
- `frontend/e2e/story-priority.spec.ts`
- `frontend/e2e/ux-hard-gate.spec.ts`
- `frontend/e2e/fixtures/ux-scenarios.ts`
- frontend fixtures, создающие `StoryListItem` или `StoryCreateOptions`
- `docs/product-reset/SPEC_RU.md`
- `docs/product-reset/EVAL_RUBRIC_RU.md`
- `docs/product-reset/IMPLEMENTATION_PLAN_RU.md`
- `docs/product-reset/PROGRESS.md`
- `docs/product-reset/EVAL_RESULT.json`

---

### Task 1: Backend priority contract and registry read model

**Files:**

- Modify: `backend/tests/test_stories_api.py`
- Modify: `backend/tests/test_story_read_models.py`
- Modify: `backend/app/schemas/stories.py`
- Modify: `backend/app/services/action_policy.py`
- Modify: `backend/app/services/story_queries.py`
- Modify: `backend/app/services/story_service.py`
- Modify: `backend/app/api/routes/stories.py`

**Interfaces:**

- Produces: `StoryCreateRequest.priority: Literal["standard", "high"] = "standard"`.
- Produces: `StoryManagementPatch(priority: Literal["standard", "high"])`
  для priority-команды этого среза. Переназначение автора остаётся отдельным
  контрактом утверждённой Product Reset модели и этим срезом не расширяется.
- Produces: `StoryListItem.updated_at: datetime`.
- Produces: `StoryListItem.priority_action: ActionRef | None`.
- Produces: `StoryCreateOptionsResponse.priority_options: list[CodeLabel]`.
- Produces: `PATCH /api/v1/stories/{story_id}/management`.
- Produces: `update_story_priority(db, *, story_id, actor, priority) -> CommandAck`.

- [ ] **Step 1: Add failing backend API tests**

Add focused cases to `backend/tests/test_stories_api.py`:

```python
def test_priority_defaults_to_standard_and_registry_returns_activity_dates(client) -> None:
    cookies = _cookies(client, "lira")
    options = client.get("/api/v1/stories/create-options", cookies=cookies).json()
    created = client.post(
        "/api/v1/stories",
        json={
            "title": "Синтетический стандартный приоритет",
            "rubric_id": options["rubrics"][0]["id"],
            "author_user_id": options["authors"][0]["id"],
        },
        cookies=cookies,
    )
    assert created.status_code == 200, created.text
    story = client.get(
        f"/api/v1/stories/{created.json()['resource']['id']}",
        cookies=cookies,
    ).json()
    assert story["priority"] == {"code": "standard", "label": "Стандарт"}
    assert story["updated_at"] == story["created_at"]
    assert story["priority_action"] is None


def test_leadership_creates_and_updates_high_priority_from_server_actions(client) -> None:
    cookies = _cookies(client, "astra")
    options = client.get("/api/v1/stories/create-options", cookies=cookies).json()
    assert options["priority_options"] == [
        {"code": "standard", "label": "Стандарт"},
        {"code": "high", "label": "Высокий"},
    ]
    created = client.post(
        "/api/v1/stories",
        json={
            "title": "Синтетический высокий приоритет",
            "rubric_id": options["rubrics"][0]["id"],
            "author_user_id": options["authors"][0]["id"],
            "priority": "high",
        },
        cookies=cookies,
    )
    story_id = created.json()["resource"]["id"]
    story = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()
    assert story["priority"]["code"] == "high"
    assert story["priority_action"] == {
        "code": "story_priority_update",
        "label": "Изменить приоритет",
        "method": "PATCH",
        "href": f"/api/v1/stories/{story_id}/management",
        "emphasis": "normal",
        "confirmation": None,
        "form": None,
    }
    changed = client.patch(
        story["priority_action"]["href"],
        json={"priority": "standard"},
        cookies=cookies,
    )
    assert changed.status_code == 200, changed.text
    assert client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()["priority"]["code"] == "standard"


def test_non_leadership_cannot_create_or_change_high_priority(client) -> None:
    cookies = _cookies(client, "lira")
    options = client.get("/api/v1/stories/create-options", cookies=cookies).json()
    assert options["priority_options"] == [{"code": "standard", "label": "Стандарт"}]
    rejected = client.post(
        "/api/v1/stories",
        json={
            "title": "Запрещённый высокий приоритет",
            "rubric_id": options["rubrics"][0]["id"],
            "author_user_id": options["authors"][0]["id"],
            "priority": "high",
        },
        cookies=cookies,
    )
    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "FORBIDDEN"
```

Extend `backend/tests/test_story_read_models.py` so the expected dictionary contains:

```python
"updated_at": "2026-07-12T10:05:00+00:00",
"priority_action": None,
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd backend
pytest -q tests/test_stories_api.py tests/test_story_read_models.py
```

Expected: failures for absent `priority_options`, `updated_at`, `priority_action`, create `priority`, and `/management`.

- [ ] **Step 3: Implement schemas, policy, service and route**

In `backend/app/services/action_policy.py` add:

```python
def story_priority_action(user: User, story: Story) -> ActionRef | None:
    if not user.is_active or not is_leadership(user) or story.archived_at is not None:
        return None
    return ActionRef(
        code="story_priority_update",
        label="Изменить приоритет",
        method="PATCH",
        href=f"/api/v1/stories/{story.id}/management",
    )
```

In `backend/app/schemas/stories.py` add the declared contract fields and:

```python
class StoryManagementPatch(BaseModel):
    priority: Literal["standard", "high"]
```

In `backend/app/services/story_service.py`:

- accept `priority` in `create_story`;
- reject `priority == "high"` unless `is_leadership(actor)`;
- persist the validated value;
- add `update_story_priority` which locks the story, rejects archived stories, checks `is_leadership`, writes the value, records `story_priority_changed`, commits once and returns `CommandAck`.

In `backend/app/services/story_queries.py`, pass `story.updated_at` and `story_priority_action(current_user, story)` into every list/detail read model.

In `backend/app/api/routes/stories.py`:

- return both priority options to leadership and only `standard` to other creators;
- pass `payload.priority` to `create_story`;
- add `PATCH /{story_id}/management`.

- [ ] **Step 4: Run focused backend tests and verify GREEN**

Run:

```bash
cd backend
pytest -q tests/test_stories_api.py tests/test_story_read_models.py
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit backend priority contract**

```bash
git add backend/app/schemas/stories.py \
  backend/app/services/action_policy.py \
  backend/app/services/story_queries.py \
  backend/app/services/story_service.py \
  backend/app/api/routes/stories.py \
  backend/tests/test_stories_api.py \
  backend/tests/test_story_read_models.py
git commit -m "feat(stories): add managed priority controls"
```

---

### Task 2: Canonical aggregate activity timestamp

**Files:**

- Create: `backend/app/services/story_activity.py`
- Modify: `backend/tests/test_scenario_autosave.py`
- Modify: `backend/tests/test_stories_api.py`
- Modify: `backend/app/services/story_service.py`
- Modify: `backend/app/services/scenario_service.py`
- Modify: `backend/app/services/workflow_service.py`
- Modify: `backend/app/services/production_service.py`
- Modify: `backend/app/services/correction_service.py`
- Modify: `backend/app/services/external_approval_service.py`

**Interfaces:**

- Produces: `touch_story_activity(db: Session, *, story_id: int, changed_at: datetime) -> None`.
- Consumes: every successful new scenario save and each `StoryEvent` creation.

- [ ] **Step 1: Add failing activity timestamp tests**

In `backend/tests/test_scenario_autosave.py`, capture `Story.updated_at`, save a new scenario revision, then assert it advances:

```python
def test_new_scenario_save_updates_story_activity_but_idempotent_retry_does_not(client) -> None:
    story_id = _active_story_id()
    cookies = _login(client)
    lease = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=cookies).json()
    payload = {
        "base_revision": 0,
        "client_save_id": "save_activity_0001",
        "edit_session_id": lease["edit_session_id"],
        "lease_token": lease["lease_token"],
        "rows": [{
            "segment_uid": "seg_123e4567-e89b-12d3-a456-426614174099",
            "order_index": 1,
            "block_type": "zk",
            "text": "Содержательная правка",
        }],
    }
    before = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()["updated_at"]
    first = client.put(f"/api/v1/stories/{story_id}/scenario", json=payload, cookies=cookies)
    after_first = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()["updated_at"]
    retry = client.put(f"/api/v1/stories/{story_id}/scenario", json=payload, cookies=cookies)
    after_retry = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()["updated_at"]
    assert first.status_code == 200
    assert retry.status_code == 200
    assert after_first > before
    assert after_retry == after_first
```

Add a read-only assertion to `backend/tests/test_stories_api.py`:

```python
def test_reading_story_does_not_change_activity_timestamp(client) -> None:
    cookies = _cookies(client, "astra")
    story = client.get("/api/v1/stories", cookies=cookies).json()["items"][0]
    client.get(f"/api/v1/stories/{story['id']}", cookies=cookies)
    reread = client.get(f"/api/v1/stories/{story['id']}", cookies=cookies).json()
    assert reread["updated_at"] == story["updated_at"]
```

- [ ] **Step 2: Run timestamp tests and verify RED**

Run:

```bash
cd backend
pytest -q \
  tests/test_scenario_autosave.py::test_new_scenario_save_updates_story_activity_but_idempotent_retry_does_not \
  tests/test_stories_api.py::test_reading_story_does_not_change_activity_timestamp
```

Expected: scenario autosave assertion fails because `stories.updated_at` does not advance.

- [ ] **Step 3: Implement the shared timestamp operation**

Create `backend/app/services/story_activity.py`:

```python
from datetime import datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.models import Story


def touch_story_activity(
    db: Session,
    *,
    story_id: int,
    changed_at: datetime,
) -> None:
    db.execute(
        update(Story)
        .where(
            Story.id == story_id,
            Story.updated_at < changed_at,
        )
        .values(updated_at=changed_at)
        .execution_options(synchronize_session=False)
    )
```

Условие сравнивается базой в самом `UPDATE`, поэтому запоздавшая транзакция со
старым `changed_at` не может уменьшить `updated_at`. Отдельный regression test
сначала применяет новое, затем старое время и сохраняет новое значение.

Call it:

- in `scenario_service.save_scenario` only after a new revision is accepted and before commit;
- in every `_event`/`_record_event` helper in story, workflow, production, correction and external approval services;
- in metadata update before commit.

Do not call it from `mark_scenario_opened`, lease creation/release/heartbeat or notification read/delivery code.

- [ ] **Step 4: Run activity and domain suites**

Run:

```bash
cd backend
pytest -q \
  tests/test_scenario_autosave.py \
  tests/test_stories_api.py \
  tests/test_editorial_workflow.py \
  tests/test_production_workflow.py \
  tests/test_production_read_model.py \
  tests/test_corrections.py \
  tests/test_external_approval.py
```

Expected: all selected tests pass; no read-only action changes `updated_at`.

- [ ] **Step 5: Commit aggregate timestamp**

```bash
git add backend/app/services/story_activity.py \
  backend/app/services/story_service.py \
  backend/app/services/scenario_service.py \
  backend/app/services/workflow_service.py \
  backend/app/services/production_service.py \
  backend/app/services/correction_service.py \
  backend/app/services/external_approval_service.py \
  backend/tests/test_scenario_autosave.py \
  backend/tests/test_stories_api.py
git commit -m "feat(stories): track aggregate activity time"
```

---

### Task 3: Priority controls and dates in the React registry

**Files:**

- Modify: `frontend/src/features/stories/StoriesTable.test.tsx`
- Modify: `frontend/src/features/stories/StoryLifecycle.test.tsx`
- Modify: `frontend/src/shared/contracts.ts`
- Modify: `frontend/src/features/stories/api.ts`
- Modify: `frontend/src/features/stories/components/CreateStoryDialog.tsx`
- Modify: `frontend/src/features/stories/components/StoriesTable.tsx`
- Modify: `frontend/src/pages/StoriesPage.tsx`
- Modify: `frontend/src/styles/stories.css`
- Modify: `frontend/e2e/accessibility.spec.ts`
- Modify: `frontend/e2e/editorial-air.spec.ts`
- Modify: `frontend/e2e/fixtures/ux-scenarios.ts`
- Modify: `frontend/e2e/full-story-flow.spec.ts`
- Modify: `frontend/e2e/notification-routing.spec.ts`
- Modify: `frontend/e2e/production-workflow.spec.ts`

**Interfaces:**

- Consumes: `StoryListItem.updated_at`, `StoryListItem.priority_action`, `StoryCreateOptions.priority_options`.
- Produces: `updateStoryPriority(action: ActionRef, priority: "standard" | "high")`.
- Produces: `StoriesTable.onPriorityChange(story, priority)`.

- [ ] **Step 1: Add failing component tests for eight columns and inline priority**

Extend `frontend/src/features/stories/StoriesTable.test.tsx`:

```tsx
const story: StoryListItem = {
  id: 101,
  title: "Синтетический выпуск",
  priority: { code: "high", label: "Высокий" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author: {
    id: 1,
    username: "synthetic_author",
    display_name: "Тест",
    position: "Корреспондент",
    function_codes: ["author"],
  },
  situation: { code: "active", label: "В работе" },
  assignments: [{
    kind: "video",
    user: {
      id: 2,
      username: "synthetic_editor",
      display_name: "Редактор",
      position: "Монтажёр",
      function_codes: ["video"],
    },
  }],
  created_at: "2026-07-12T09:00:00Z",
  updated_at: "2026-07-12T10:15:00Z",
  archived_at: null,
  priority_action: {
    code: "story_priority_update",
    label: "Изменить приоритет",
    method: "PATCH",
    href: "/api/v1/stories/101/management",
    emphasis: "normal",
    confirmation: null,
    form: null,
  },
};

it("показывает даты справа от исполнителей и отправляет выбранный приоритет", async () => {
  const onPriorityChange = vi.fn();
  const user = userEvent.setup();
  render(
    <StoriesTable
      items={[story]}
      onOpenScenario={vi.fn()}
      onPriorityChange={onPriorityChange}
    />,
  );
  expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
    "Приоритет",
    "Название",
    "Рубрика",
    "Автор",
    "Что происходит",
    "Исполнители",
    "Изменён",
    "Создан",
  ]);
  expect(screen.getByText("12.07.2026, 13:15")).toBeVisible();
  expect(screen.getByText("12.07.2026, 12:00")).toBeVisible();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Приоритет сюжета Синтетический выпуск" }),
    "standard",
  );
  expect(onPriorityChange).toHaveBeenCalledWith(story, "standard");
});
```

Use deterministic timezone handling in the assertion by formatting with `Intl.DateTimeFormat("ru-RU", {dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow"})`.

In `frontend/src/features/stories/StoryLifecycle.test.tsx`, extend create options with:

```ts
priority_options: [
  { code: "standard", label: "Стандарт" },
  { code: "high", label: "Высокий" },
],
```

Select `high` and assert the POST body contains `"priority":"high"`. Add a priority update mock and assert failed PATCH keeps the previous visible value, while successful retry refetches the list.

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
cd frontend
npm test -- --run \
  src/features/stories/StoriesTable.test.tsx \
  src/features/stories/StoryLifecycle.test.tsx
```

Expected: failures for absent date columns, priority select, create field and PATCH handler.

- [ ] **Step 3: Implement frontend contracts and API**

In `frontend/src/shared/contracts.ts` add:

```ts
export interface StoryListItem {
  id: number;
  title: string;
  priority: CodeLabel;
  rubric: RubricRef;
  author: UserRef;
  situation: CodeLabel;
  assignments: AssignmentRef[];
  created_at: string;
  updated_at: string;
  aired_at?: string | null;
  archived_at: string | null;
  lifecycle_actions?: ActionRef[];
  priority_action: ActionRef | null;
}

export interface StoryCreateOptions {
  rubrics: RubricRef[];
  authors: UserRef[];
  priority_options: CodeLabel[];
  create_action: ActionRef | null;
}
```

In `frontend/src/features/stories/api.ts`:

```ts
export type StoryPriority = "standard" | "high";

export function updateStoryPriority(
  action: ActionRef,
  priority: StoryPriority,
): Promise<CommandAck> {
  return apiRequest<CommandAck>(action.href, {
    method: action.method,
    body: JSON.stringify({ priority }),
  });
}
```

Extend the create payload with `priority: StoryPriority`.

- [ ] **Step 4: Implement create dialog, table and page state**

In `CreateStoryDialog`:

- initialize priority to `standard` whenever a fresh dialog opens;
- render a labelled native `<select>` from `options.priority_options`;
- disable it when the server returned one option;
- retain it on a failed submit;
- include it in the POST body.

In `StoriesTable`:

- render native select only when `story.priority_action` exists;
- render the current pill for users without an action;
- append «Изменён» and «Создан» cells;
- use a formatter with `timeZone: "Europe/Moscow"`, two-digit date parts and no seconds;
- change empty-row `colSpan` from `6` to `8`.

In `StoriesPage`:

- keep `priorityPendingStoryId`;
- call `updateStoryPriority`;
- refetch only after successful PATCH;
- surface the API error without optimistic mutation, preserving the old select value.

In `stories.css`:

- keep priority controls within a compact column;
- add `.story-registry-date { white-space: nowrap; font-variant-numeric: tabular-nums; }`;
- set a table minimum width that still fits the agreed desktop viewport and validate it through Playwright.

- [ ] **Step 5: Update typed fixtures and run frontend tests**

Add leadership priority options to the create-options mocks in:

- `frontend/e2e/accessibility.spec.ts`;
- `frontend/e2e/editorial-air.spec.ts`;
- `frontend/e2e/fixtures/ux-scenarios.ts`;
- `frontend/e2e/full-story-flow.spec.ts`;
- `frontend/e2e/notification-routing.spec.ts`;
- `frontend/e2e/production-workflow.spec.ts`;
- `frontend/src/features/stories/StoryLifecycle.test.tsx`.

Use exactly:

```ts
priority_options: [
  { code: "standard", label: "Стандарт" },
  { code: "high", label: "Высокий" },
],
```

Run:

```bash
cd frontend
npm test -- --run
npm run build
```

Expected: all component tests pass and TypeScript build completes.

- [ ] **Step 6: Commit frontend registry controls**

```bash
git add frontend/src/shared/contracts.ts \
  frontend/src/features/stories/api.ts \
  frontend/src/features/stories/components/CreateStoryDialog.tsx \
  frontend/src/features/stories/components/StoriesTable.tsx \
  frontend/src/features/stories/components/StoryHeader.tsx \
  frontend/src/features/history/HistoryTimeline.test.tsx \
  frontend/src/pages/StoriesPage.tsx \
  frontend/src/styles/stories.css \
  frontend/src/features/stories/StoriesTable.test.tsx \
  frontend/src/features/stories/StoryLifecycle.test.tsx \
  frontend/src/features/stories/types.ts \
  frontend/src/test/playwrightConfig.test.ts \
  frontend/playwright.config.ts \
  frontend/e2e/accessibility.spec.ts \
  frontend/e2e/editorial-air.spec.ts \
  frontend/e2e/fixtures/ux-scenarios.ts \
  frontend/e2e/full-story-flow.spec.ts \
  frontend/e2e/notification-routing.spec.ts \
  frontend/e2e/story-priority.spec.ts \
  frontend/e2e/ux-hard-gate.spec.ts
git commit -m "feat(stories): edit priority and show registry dates"
```

---

### Task 4: Product contract, browser hard gate and final verification

**Files:**

- Create: `frontend/e2e/story-priority.spec.ts`
- Modify: `frontend/e2e/ux-hard-gate.spec.ts`
- Modify: `frontend/e2e/fixtures/ux-scenarios.ts`
- Modify: `docs/product-reset/SPEC_RU.md`
- Modify: `docs/product-reset/EVAL_RUBRIC_RU.md`
- Modify: `docs/product-reset/IMPLEMENTATION_PLAN_RU.md`
- Modify: `docs/product-reset/PROGRESS.md`
- Modify: `docs/product-reset/EVAL_RESULT.json`

**Interfaces:**

- Consumes: complete backend/frontend priority and timestamp contract.
- Produces: browser evidence for creation, inline update, date order and no horizontal overflow.

- [ ] **Step 1: Write a failing Playwright flow**

Create `frontend/e2e/story-priority.spec.ts` with a fully synthetic route fixture:

```ts
import { expect, test, type Page } from "@playwright/test";

const user = {
  id: 1,
  username: "astra",
  display_name: "Астра",
  position: "Начальник",
  function_codes: ["author", "chief"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-28T08:00:00Z",
};
const rubric = { id: 7, name: "Новости" };
const priorityAction = {
  code: "story_priority_update",
  label: "Изменить приоритет",
  method: "PATCH",
  href: "/api/v1/stories/101/management",
  emphasis: "normal",
  confirmation: null,
  form: null,
};
const createAction = {
  code: "story_create",
  label: "Создать сюжет",
  method: "POST",
  href: "/api/v1/stories",
  emphasis: "primary",
  confirmation: null,
  form: "story_create",
};

test("leadership creates high priority and changes it inline", async ({ page }) => {
  let capturedCreatePayload: Record<string, unknown> | null = null;
  let capturedPatchPayload: Record<string, unknown> | null = null;
  let storyPriority = { code: "high", label: "Высокий" };
  const registryStory = () => ({
    id: 101,
    title: "Синтетический приоритет",
    priority: storyPriority,
    priority_action: priorityAction,
    rubric,
    author: user,
    situation: { code: "active", label: "В работе" },
    assignments: [],
    created_at: "2026-07-28T08:00:00Z",
    updated_at: storyPriority.code === "high"
      ? "2026-07-28T08:00:00Z"
      : "2026-07-28T09:00:00Z",
    aired_at: null,
    archived_at: null,
    lifecycle_actions: [],
  });

  await page.context().addCookies([{
    name: "newscast_session",
    value: "synthetic-session",
    url: "http://127.0.0.1:5173",
  }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/v1/auth/me") return route.fulfill({ json: user });
    if (path === "/api/v1/me/actions") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/v1/notifications") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/stories/create-options") {
      return route.fulfill({
        json: {
          rubrics: [rubric],
          authors: [user],
          priority_options: [
            { code: "standard", label: "Стандарт" },
            { code: "high", label: "Высокий" },
          ],
          create_action: createAction,
        },
      });
    }
    if (path === "/api/v1/stories" && method === "GET") {
      return route.fulfill({ json: { items: [registryStory()], total: 1 } });
    }
    if (path === "/api/v1/stories" && method === "POST") {
      capturedCreatePayload = request.postDataJSON();
      return route.fulfill({
        json: {
          ok: true,
          event_id: "create-101",
          changed_at: "2026-07-28T08:00:00Z",
          resource: { type: "story", id: 101 },
        },
      });
    }
    if (path === priorityAction.href && method === "PATCH") {
      capturedPatchPayload = request.postDataJSON();
      storyPriority = { code: "standard", label: "Стандарт" };
      return route.fulfill({
        json: {
          ok: true,
          event_id: "priority-101",
          changed_at: "2026-07-28T09:00:00Z",
          resource: { type: "story", id: 101 },
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "UNEXPECTED_TEST_REQUEST",
          message: `${method} ${path}`,
        },
      },
    });
  });

  await page.goto("/stories");
  await page.getByRole("button", { name: "Создать сюжет" }).click();
  await page.getByLabel("Название").fill("Синтетический приоритет");
  await page.getByLabel("Приоритет").selectOption("high");
  await page.getByRole("button", { name: "Создать" }).click();
  await expect.poll(() => capturedCreatePayload?.priority).toBe("high");

  await page.goto("/stories");
  const prioritySelect = page.getByRole("combobox", {
    name: "Приоритет сюжета Синтетический приоритет",
  });
  await prioritySelect.selectOption("standard");
  await expect.poll(() => capturedPatchPayload).toEqual({ priority: "standard" });
  await expect(prioritySelect).toHaveValue("standard");
  await expect(page.getByRole("columnheader")).toHaveText([
    "Приоритет",
    "Название",
    "Рубрика",
    "Автор",
    "Что происходит",
    "Исполнители",
    "Изменён",
    "Создан",
  ]);
});
```

- [ ] **Step 2: Run the browser test and verify RED**

Run:

```bash
cd frontend
npx playwright test e2e/story-priority.spec.ts --project=chromium
```

Expected: failure until all UI wiring and refetch behavior are present.

- [ ] **Step 3: Update the UX hard gate and product documents**

Change the expected table columns in `frontend/e2e/ux-hard-gate.spec.ts` to the agreed eight-column order and keep:

```ts
expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
```

Update:

- `SPEC_RU.md` sections 6 and 7 with priority creation control, eight columns and the semantic definition of «Изменён»;
- `EVAL_RUBRIC_RU.md` sections 3 and 8 with permissions, default priority, timestamps and eight-column acceptance;
- `IMPLEMENTATION_PLAN_RU.md` StoryHeader/list contracts and CP7 hard-gate from six to eight columns;
- `PROGRESS.md` with RED/GREEN commands, commits and browser result.

- [ ] **Step 4: Run focused and complete verification**

Run:

```bash
cd backend
pytest -q

cd ../frontend
npm test -- --run
npm run build
npx playwright test

cd ..
docker compose --env-file .env.example -f compose.yaml config
```

Then verify the live local application:

1. `/stories` opens.
2. Leadership sees inline priority select.
3. Ordinary author sees a static label.
4. Create dialog defaults to «Стандарт» and leadership can choose «Высокий».
5. «Изменён» and «Создан» are to the right of «Исполнители».
6. Autosave advances «Изменён» after returning to the registry.
7. The agreed desktop viewport has no document horizontal overflow and at least six rows remain visible.

- [ ] **Step 5: Run CodeRabbit on local commits**

Use the configured CodeRabbit local review against the implementation base:

```bash
coderabbit review --base-commit 0678d65bb48fbb20dd6268a721191975e4dcb75b
```

Classify every finding, fix valid in-scope issues test-first, rerun the relevant tests, and record the result in `PROGRESS.md`.

- [ ] **Step 6: Refresh machine-readable eval and commit documentation**

Run the repository’s canonical eval command recorded in `docs/product-reset/EVAL_COMMANDS.json`, then update `docs/product-reset/EVAL_RESULT.json` with factual results only.

```bash
git add frontend/e2e/story-priority.spec.ts \
  frontend/e2e/ux-hard-gate.spec.ts \
  frontend/e2e/fixtures/ux-scenarios.ts \
  docs/product-reset/SPEC_RU.md \
  docs/product-reset/EVAL_RUBRIC_RU.md \
  docs/product-reset/IMPLEMENTATION_PLAN_RU.md \
  docs/product-reset/PROGRESS.md \
  docs/product-reset/EVAL_RESULT.json
git commit -m "docs(product-reset): verify priority and registry dates"
```

- [ ] **Step 7: Final hygiene check**

Run:

```bash
git status --short
git log --oneline 0678d65bb48fbb20dd6268a721191975e4dcb75b..HEAD
git diff --check 0678d65bb48fbb20dd6268a721191975e4dcb75b..HEAD
```

Expected: clean worktree, only focused local commits, no whitespace errors, no push/PR/merge/deploy.
