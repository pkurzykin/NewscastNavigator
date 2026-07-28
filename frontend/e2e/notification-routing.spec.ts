import { expect, test, type Page } from "@playwright/test";


const user = {
  id: 3,
  username: "vega",
  display_name: "Вега",
  position: "Монтажёр",
  function_codes: ["video_editor"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-22T07:00:00Z",
};

const author = {
  id: 2,
  username: "lira",
  display_name: "Лира",
  position: "Корреспондент",
  function_codes: ["author"],
};

const story = {
  id: 101,
  title: "Синтетический сюжет: уведомления",
  priority: { code: "high", label: "Высокий" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author,
  situation: { code: "video_in_progress", label: "Монтаж в работе" },
  assignments: [{ kind: "video_editor", user }],
  created_at: "2026-07-22T07:30:00Z",
  aired_at: null,
  archived_at: null,
  primary_action: null,
  additional_actions: [],
};

const personalAction = {
  id: "story:101:action:video_ready",
  story: { id: story.id, title: story.title, priority: story.priority },
  summary: "Монтаж начат — сообщите о готовности ролика",
  target_href: "/stories/101/production",
  action: {
    code: "video_ready",
    label: "Ролик готов",
    method: "POST",
    href: "/api/v1/stories/101/production/video/ready",
    emphasis: "normal",
    confirmation: null,
    form: null,
  },
};

const manyPersonalActions = Array.from({ length: 21 }, (_, index) => ({
  ...personalAction,
  id: `story:101:attention:${index + 1}`,
  summary: `Синтетическое действие ${index + 1}`,
  action: {
    ...personalAction.action,
    label: `Ролик готов ${index + 1}`,
  },
}));

const lateNotification = {
  id: 77,
  kind: "scenario_changed_video",
  story: { id: story.id, title: story.title, priority: story.priority },
  actor: author,
  title: "Сценарий изменён после начала монтажа",
  summary: "Откройте актуальный сценарий и сохранённый diff",
  target_href: "/stories/101/scenario?production_context=video",
  diff: {
    from_revision: 4,
    to_revision: 7,
    summary: { added: 1, removed: 0, changed: 1, moved: 0, total: 2 },
    changes: [{
      segment_uid: "seg_1",
      kind: "changed",
      moved: false,
      changed_fields: ["text"],
      before: { text: "Прежняя синтетическая строка" },
      after: { text: "Новая синтетическая строка" },
    }],
    href: "/stories/101/history?notification=77",
  },
  created_at: "2026-07-22T08:00:00Z",
  updated_at: "2026-07-22T08:05:00Z",
  read_at: null,
};

const notificationSession = {
  kind: "edit_session",
  id: 19,
  actor: author,
  started_at: "2026-07-22T07:50:00Z",
  ended_at: "2026-07-22T08:05:00Z",
  from_revision: 4,
  to_revision: 7,
  diff_summary: lateNotification.diff.summary,
  diff_href: "/api/v1/stories/101/history/notifications/77",
  available_actions: [],
};

const ordinarySession = {
  ...notificationSession,
  from_revision: 2,
  diff_summary: { added: 9, removed: 8, changed: 7, moved: 6, total: 30 },
  diff_href: "/api/v1/stories/101/history/edit-sessions/19",
};

interface FixtureState {
  actions: typeof personalAction[];
  notificationUnread: boolean;
  opened: Array<{ revision: number; context: string }>;
}

function workflowModel() {
  return {
    story_id: 101,
    review_request: null,
    editorial_check: null,
    proofread: null,
    changed_after_proofread: false,
    reproofread_request: null,
    primary_action: null,
    additional_actions: [],
  };
}

async function installApi(page: Page, state: FixtureState): Promise<void> {
  await page.context().addCookies([
    { name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" },
  ]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: user });
    if (path === "/api/v1/me/actions" && request.method() === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "20");
      return route.fulfill({ json: { items: state.actions.slice(0, limit), total: state.actions.length } });
    }
    if (path === "/api/v1/notifications" && request.method() === "GET") {
      const items = state.notificationUnread ? [lateNotification] : [];
      return route.fulfill({ json: { items, total: items.length, unread_count: items.length } });
    }
    if (path === "/api/v1/notifications/77/read" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({});
      state.notificationUnread = false;
      return route.fulfill({ json: {
        ok: true,
        event_id: null,
        changed_at: "2026-07-22T08:06:00Z",
        resource: { type: "notification", id: 77 },
      } });
    }
    if (path === "/api/v1/stories/create-options" && request.method() === "GET") {
      return route.fulfill({ json: {
        rubrics: [],
        authors: [],
        create_action: null,
      } });
    }
    if (path === "/api/v1/stories" && request.method() === "GET") {
      return route.fulfill({ json: { items: [story], total: 1 } });
    }
    if (path === "/api/v1/stories/101" && request.method() === "GET") {
      return route.fulfill({ json: story });
    }
    if (path === "/api/v1/stories/101/history" && request.method() === "GET") {
      return route.fulfill({ json: {
        story,
        items: [ordinarySession],
        next_cursor: null,
      } });
    }
    if (
      path === "/api/v1/stories/101/history/notifications/77"
      && request.method() === "GET"
    ) {
      return route.fulfill({ json: {
        story,
        session: notificationSession,
        changes: lateNotification.diff.changes,
      } });
    }
    if (path === ordinarySession.diff_href && request.method() === "GET") {
      return route.fulfill({ json: {
        story,
        session: ordinarySession,
        changes: [{
          ...lateNotification.diff.changes[0],
          before: { text: "Начало сеанса, не baseline уведомления" },
        }],
      } });
    }
    if (path === "/api/v1/stories/101/production" && request.method() === "GET") {
      return route.fulfill({ json: {
        story,
        scenario_revision: 7,
        assignments: story.assignments,
        assignee_options: [user],
        can_manage_assignments: false,
        materials: [],
        corrections: {
          href: "/api/v1/stories/101/correction-packages",
          total_count: 0,
          open_count: 0,
          awaiting_leadership_review_count: 0,
        },
        voiceover: { ready: false, ready_by: null, ready_at: null },
        video: {
          started_by: user,
          started_at: "2026-07-22T07:45:00Z",
          ready_by: null,
          ready_at: null,
          approved_for_titles_by: null,
          approved_for_titles_at: null,
          last_opened_revision: 4,
          has_unseen_scenario_changes: true,
        },
        titles: {
          initial_gate_satisfied: false,
          started_by: null,
          started_at: null,
          ready_by: null,
          ready_at: null,
          accepted_by: null,
          accepted_at: null,
          last_opened_revision: null,
          has_unseen_scenario_changes: false,
        },
        aired: null,
        stages: [
          { code: "voiceover", state: "pending", label: "Озвучка", summary: "Не готова" },
          { code: "video", state: "in_progress", label: "Монтаж", summary: "Монтаж в работе" },
          { code: "titles", state: "pending", label: "Титры", summary: "Ожидают ролик" },
        ],
        primary_action: null,
        additional_actions: [],
      } });
    }
    if (path === "/api/v1/stories/101/correction-packages" && request.method() === "GET") {
      return route.fulfill({ json: {
        story_id: 101,
        items: [],
        assignee_options: [user],
        create_action: null,
      } });
    }
    if (path === "/api/v1/stories/101/scenario" && request.method() === "GET") {
      return route.fulfill({ json: {
        story: { id: story.id, title: story.title },
        scenario: { revision: 7, rows: [] },
        edit: { state: "available" },
        captionpanels: null,
      } });
    }
    if (path === "/api/v1/stories/101/workflow" && request.method() === "GET") {
      return route.fulfill({ json: workflowModel() });
    }
    if (path === "/api/v1/stories/101/scenario/opened" && request.method() === "POST") {
      const payload = request.postDataJSON() as { revision: number; context: string };
      state.opened.push(payload);
      state.notificationUnread = false;
      return route.fulfill({ json: {
        ok: true,
        event_id: null,
        changed_at: "2026-07-22T08:07:00Z",
        resource: { type: "scenario", id: 101 },
      } });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "UNEXPECTED_TEST_REQUEST", message: `${request.method()} ${path}` } },
    });
  });
}

function watchErrors(page: Page): string[] {
  const unexpectedErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") unexpectedErrors.push(message.text()); });
  page.on("pageerror", (error) => unexpectedErrors.push(error.message));
  return unexpectedErrors;
}

async function expectCleanViewport(page: Page, unexpectedErrors: string[]): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(unexpectedErrors).toEqual([]);
}

test("attention queue stays compact, has no empty footprint, and follows the exact story tab", async ({ page }, testInfo) => {
  const state: FixtureState = { actions: manyPersonalActions, notificationUnread: false, opened: [] };
  const unexpectedErrors = watchErrors(page);
  await installApi(page, state);

  await page.goto("/stories");

  const queue = page.getByRole("region", { name: "Требует внимания" });
  const table = page.getByRole("table");
  await expect(queue).toBeVisible();
  await expect(table).toBeVisible();
  await expect(queue.getByRole("link")).toHaveCount(3);
  await expect(queue.getByRole("button", { name: "Показать все действия" })).toBeVisible();
  const queueBox = await queue.boundingBox();
  const tableBox = await table.boundingBox();
  expect(queueBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(queueBox!.height).toBeLessThan(160);
  expect(queueBox!.y + queueBox!.height).toBeLessThanOrEqual(tableBox!.y);
  expect(tableBox!.y).toBeLessThan(768);
  await page.screenshot({ path: testInfo.outputPath("attention-queue-1366.png"), fullPage: true });

  await queue.getByRole("button", { name: "Показать все действия" }).click();
  await expect(queue.getByRole("link")).toHaveCount(21);
  await queue.getByRole("button", { name: "Свернуть список действий" }).click();
  await expect(queue.getByRole("link")).toHaveCount(3);
  const collapsedQueueBox = await queue.boundingBox();
  const collapsedTableBox = await table.boundingBox();
  expect(collapsedQueueBox).not.toBeNull();
  expect(collapsedTableBox).not.toBeNull();
  expect(collapsedQueueBox!.height).toBeLessThan(160);
  expect(collapsedQueueBox!.y + collapsedQueueBox!.height).toBeLessThanOrEqual(collapsedTableBox!.y);
  expect(collapsedTableBox!.y).toBeLessThan(768);
  await page.getByRole("link", { name: "Ролик готов 1" }).click();
  await expect(page).toHaveURL(/\/stories\/101\/production$/);

  state.actions = [];
  await page.goto("/stories");
  await expect(page.getByRole("region", { name: "Требует внимания" })).toHaveCount(0);
  await expect(page.getByRole("table")).toBeVisible();
  await expectCleanViewport(page, unexpectedErrors);
});

test("late notification keeps persisted diff, exact deep link, opened context, refresh, and read state", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const state: FixtureState = { actions: [], notificationUnread: true, opened: [] };
  const unexpectedErrors = watchErrors(page);
  await installApi(page, state);

  await page.goto("/stories");
  await page.getByRole("button", { name: "Уведомления, непрочитанных: 1" }).click();
  const tray = page.getByRole("region", { name: "Уведомления" });
  await expect(tray.getByText("Сценарий изменён после начала монтажа")).toBeVisible();
  await tray.getByText("Показать изменения").click();
  await expect(tray.getByText("Изменений: 2")).toBeVisible();
  await expect(tray.getByText(/Редакции 4 → 7/i)).toHaveCount(0);
  await expect(tray.getByText("Прежняя синтетическая строка")).toBeVisible();
  await expect(tray.getByText("Новая синтетическая строка")).toBeVisible();
  const historyLink = tray.getByRole("link", { name: "Открыть diff в истории" });
  await expect(historyLink).toHaveAttribute(
    "href",
    "/stories/101/history?notification=77",
  );
  await page.screenshot({ path: testInfo.outputPath("notification-diff-1366.png"), fullPage: true });

  await historyLink.click();
  await expect(page).toHaveURL(/\/stories\/101\/history\?notification=77$/);
  const persistedComparison = page.getByRole("region", { name: "Изменения сценария" });
  await expect(persistedComparison.getByText("Прежняя синтетическая строка")).toBeVisible();
  await expect(persistedComparison.getByText("Новая синтетическая строка")).toBeVisible();
  await expect(persistedComparison.getByText("Сохранённые состояния 4 → 7")).toBeVisible();
  await expect(persistedComparison.getByText("Начало сеанса, не baseline уведомления")).toHaveCount(0);
  const persistedSession = persistedComparison.locator("xpath=ancestor::article");
  await expect(persistedSession.getByText("Добавлено: 1")).toBeVisible();
  await expect(persistedSession.getByText("Удалено: 0")).toBeVisible();
  await expect(persistedSession.getByText("Изменено: 1")).toBeVisible();
  await expect(persistedSession.getByText("Перемещено: 0")).toBeVisible();
  await expect(persistedSession.getByText("Добавлено: 9")).toHaveCount(0);

  await page.goto("/stories");
  await page.getByRole("button", { name: "Уведомления, непрочитанных: 1" }).click();
  const refreshedTray = page.getByRole("region", { name: "Уведомления" });
  await refreshedTray.getByRole("link", { name: "Открыть сюжет" }).click();
  await expect(page).toHaveURL(/\/stories\/101\/scenario\?production_context=video$/);
  await expect.poll(() => state.opened).toContainEqual({ revision: 7, context: "video" });
  await expect(page.getByRole("button", { name: "Уведомления, непрочитанных: 0" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/stories\/101\/scenario\?production_context=video$/);
  await expect(page.getByRole("region", { name: "Редактор сценария" }).getByRole("heading", { name: story.title })).toBeVisible();

  state.notificationUnread = true;
  await page.goto("/stories");
  await page.getByRole("button", { name: "Уведомления, непрочитанных: 1" }).click();
  await page.getByRole("button", { name: "Отметить прочитанным" }).click();
  await expect(page.getByText("Сценарий изменён после начала монтажа")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Уведомления, непрочитанных: 0" })).toBeVisible();
  expect(state.notificationUnread).toBe(false);
  await expectCleanViewport(page, unexpectedErrors);
});
