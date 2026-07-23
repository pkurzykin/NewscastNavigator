import { expect, test, type Page, type TestInfo } from "@playwright/test";


const actor = {
  id: 1,
  username: "astra",
  display_name: "Астра",
  position: "Начальник-корреспондент",
  function_codes: ["author", "chief"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-23T08:00:00Z",
};
const otherAuthor = {
  id: 2,
  username: "lira",
  display_name: "Лира",
  position: "Корреспондент",
  function_codes: ["author"],
};
const rubric = { id: 7, name: "Новости" };
const createdAt = "2026-07-23T09:00:00Z";
const lifecycleAction = (
  code: string,
  label: string,
  href: string,
  emphasis: "primary" | "danger" = "primary",
  confirmation: string | null = null,
) => ({
  code,
  label,
  method: "POST",
  href,
  emphasis,
  confirmation,
  form: null,
});
const emptyCorrectionModel = {
  story_id: 901,
  items: [],
  assignee_options: [],
  create_action: null,
};


interface FixtureState {
  created: boolean;
  revision: number;
  rows: Array<Record<string, unknown>>;
  leaseActive: boolean;
  external: "none" | "pending" | "approved";
  aired: boolean;
  archived: boolean;
  createPosts: number;
  savePosts: number;
  mutationPaths: string[];
}


function situation(state: FixtureState) {
  if (state.archived) return { code: "archive", label: "В архиве" };
  if (state.aired) return { code: "aired", label: "Вышел в эфир" };
  if (state.external === "approved") {
    return { code: "ready_for_air", label: "Согласовано · готово к эфиру" };
  }
  if (state.external === "pending") {
    return { code: "external_pending", label: "На внешнем согласовании" };
  }
  return { code: "active", label: "В работе" };
}


function storyModel(state: FixtureState) {
  const lifecycle = state.archived
    ? [lifecycleAction("story_restore", "Вернуть в работу", "/api/v1/stories/901/restore")]
    : state.aired
      ? [lifecycleAction(
        "story_archive",
        "В архив",
        "/api/v1/stories/901/archive",
        "danger",
        "Архивировать сюжет?",
      )]
      : state.external === "approved"
        ? [lifecycleAction(
          "story_mark_aired",
          "Сдано / вышло в эфир",
          "/api/v1/stories/901/production/mark-aired",
        )]
        : [];
  return {
    id: 901,
    title: "Синтетический полный путь",
    priority: { code: "standard", label: "Стандарт" },
    rubric,
    author: actor,
    situation: situation(state),
    assignments: [],
    created_at: createdAt,
    aired_at: state.aired ? "2026-07-23T10:30:00Z" : null,
    archived_at: state.archived ? "2026-07-23T10:40:00Z" : null,
    lifecycle_actions: lifecycle,
  };
}


function productionModel(state: FixtureState) {
  const lifecycle = storyModel(state).lifecycle_actions;
  const primary = lifecycle[0] ?? null;
  return {
    story: {
      ...storyModel(state),
      primary_action: primary,
      additional_actions: [],
    },
    scenario_revision: state.revision,
    assignments: [],
    assignee_options: state.archived ? [] : [actor, otherAuthor],
    can_manage_assignments: !state.archived,
    materials: [],
    corrections: {
      href: "/api/v1/stories/901/correction-packages",
      total_count: 0,
      open_count: 0,
      awaiting_leadership_review_count: 0,
    },
    external_approval: {
      href: "/api/v1/stories/901/external-approval/cycles",
      total_count: state.external === "none" ? 0 : 1,
      pending_cycle_no: state.external === "pending" ? 1 : null,
      last_result: state.external === "none" ? null : state.external,
    },
    voiceover: { ready: false, ready_by: null, ready_at: null },
    video: {
      started_by: null,
      started_at: null,
      ready_by: null,
      ready_at: null,
      approved_for_titles_by: null,
      approved_for_titles_at: null,
      last_opened_revision: null,
      has_unseen_scenario_changes: false,
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
    aired: state.aired ? { by: actor, at: "2026-07-23T10:30:00Z" } : null,
    stages: [
      { code: "voiceover", state: "pending", label: "Озвучка", summary: "Не готова" },
      { code: "video", state: "pending", label: "Монтаж", summary: "Монтаж не начат" },
      {
        code: "titles",
        state: "pending",
        label: "Титры",
        summary: "Ожидают редакционную готовность, корректуру и допуск ролика",
      },
    ],
    primary_action: primary,
    additional_actions: [],
  };
}


function externalModel(state: FixtureState) {
  const resultAction = lifecycleAction(
    "external_approval_approved",
    "Согласовано",
    "/api/v1/stories/901/external-approval/cycles/71/approved",
  );
  return {
    story_id: 901,
    items: state.external === "none" ? [] : [{
      id: 71,
      cycle_no: 1,
      sent_by: actor,
      sent_at: "2026-07-23T10:00:00Z",
      result: state.external,
      decided_by: state.external === "approved" ? actor : null,
      decided_at: state.external === "approved" ? "2026-07-23T10:10:00Z" : null,
      correction_package_id: null,
      primary_action: state.external === "pending" ? resultAction : null,
      additional_actions: [],
    }],
    assignee_options: state.archived ? [] : [actor, otherAuthor],
    send_action: state.external === "none" && !state.archived
      ? lifecycleAction(
        "external_approval_send",
        "Отправить на внешнее согласование",
        "/api/v1/stories/901/external-approval/cycles/send",
      )
      : null,
  };
}


async function installFixture(page: Page, state: FixtureState) {
  await page.context().addCookies([
    { name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" },
  ]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/v1/auth/me") return route.fulfill({ json: actor });
    if (path === "/api/v1/me/actions" && method === "GET") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/v1/notifications" && method === "GET") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/stories/create-options" && method === "GET") {
      return route.fulfill({ json: {
        rubrics: [rubric],
        authors: [actor, otherAuthor],
        create_action: lifecycleAction("story_create", "Создать сюжет", "/api/v1/stories"),
      } });
    }
    if (path === "/api/v1/stories" && method === "GET") {
      const scope = url.searchParams.get("scope");
      const visible = state.created && (
        (scope === "archive" && state.archived)
        || (scope !== "archive" && !state.archived)
      );
      return route.fulfill({
        json: { items: visible ? [storyModel(state)] : [], total: visible ? 1 : 0 },
      });
    }
    if (path === "/api/v1/stories" && method === "POST") {
      expect(request.postDataJSON()).toEqual({
        title: "Синтетический полный путь",
        rubric_id: 7,
        author_user_id: 1,
      });
      state.created = true;
      state.createPosts += 1;
      state.mutationPaths.push(path);
      return route.fulfill({ json: {
        ok: true,
        event_id: "1",
        changed_at: createdAt,
        resource: { type: "story", id: 901 },
      } });
    }
    if (path === "/api/v1/stories/901" && method === "GET") {
      return route.fulfill({ json: storyModel(state) });
    }
    if (path === "/api/v1/stories/901/scenario" && method === "GET") {
      return route.fulfill({ json: {
        story: storyModel(state),
        scenario: { revision: state.revision, rows: state.rows },
        edit: {
          state: state.archived ? "archived" : state.leaseActive ? "mine" : "available",
          edit_session_id: state.leaseActive ? 44 : null,
          holder: state.leaseActive ? actor : null,
          expires_at: state.leaseActive ? "2026-07-23T11:00:00Z" : null,
        },
        captionpanels: {
          eligible: !state.archived,
          last_opened_revision: null,
          changed_since_last_open: false,
          diff_session_id: null,
        },
        available_actions: [],
      } });
    }
    if (path === "/api/v1/stories/901/scenario/lease" && method === "POST") {
      expect(state.archived).toBe(false);
      state.leaseActive = true;
      state.mutationPaths.push(path);
      return route.fulfill({ json: {
        edit_session_id: 44,
        lease_token: "synthetic-lease",
        expires_at: "2026-07-23T11:00:00Z",
        revision: state.revision,
      } });
    }
    if (path === "/api/v1/stories/901/scenario/lease" && method === "DELETE") {
      state.leaseActive = false;
      state.mutationPaths.push(`${method} ${path}`);
      return route.fulfill({ json: {
        ok: true,
        event_id: null,
        changed_at: "2026-07-23T10:00:00Z",
        resource: { type: "scenario", id: 1 },
      } });
    }
    if (path === "/api/v1/stories/901/scenario" && method === "PUT") {
      const body = request.postDataJSON() as {
        base_revision: number;
        client_save_id: string;
        edit_session_id: number;
        lease_token: string;
        rows: Array<{
          segment_uid: string;
          order_index: number;
          block_type: string;
          text: string;
        }>;
      };
      expect(body).toEqual(expect.objectContaining({
        base_revision: state.revision,
        client_save_id: expect.any(String),
        edit_session_id: 44,
        lease_token: "synthetic-lease",
        rows: [
          expect.objectContaining({
            segment_uid: expect.stringMatching(/^seg_[0-9a-f-]{36}$/),
            order_index: 1,
            block_type: "zk",
            text: "Синтетический текст полного пути",
          }),
        ],
      }));
      const responseClientSaveId = body.client_save_id;
      state.rows = body.rows;
      state.revision += 1;
      state.savePosts += 1;
      state.mutationPaths.push(`${method} ${path}`);
      return route.fulfill({ json: {
        ok: true,
        client_save_id: responseClientSaveId,
        revision: state.revision,
        saved_at: "2026-07-23T10:00:00Z",
      } });
    }
    if (path === "/api/v1/stories/901/workflow" && method === "GET") {
      return route.fulfill({ json: {
        story_id: 901,
        review_request: null,
        editorial_check: null,
        proofread: null,
        changed_after_proofread: false,
        reproofread_request: null,
        primary_action: null,
        additional_actions: [],
      } });
    }
    if (path === "/api/v1/stories/901/production" && method === "GET") {
      return route.fulfill({ json: productionModel(state) });
    }
    if (path === "/api/v1/stories/901/correction-packages" && method === "GET") {
      return route.fulfill({ json: emptyCorrectionModel });
    }
    if (path === "/api/v1/stories/901/external-approval/cycles" && method === "GET") {
      return route.fulfill({ json: externalModel(state) });
    }
    if (
      path === "/api/v1/stories/901/external-approval/cycles/send"
      && method === "POST"
    ) {
      expect(request.postDataJSON()).toEqual({});
      state.external = "pending";
      state.mutationPaths.push(path);
      return route.fulfill({ json: {
        ok: true,
        event_id: "2",
        changed_at: "2026-07-23T10:00:00Z",
        resource: { type: "external_approval_cycle", id: 71 },
      } });
    }
    if (
      path === "/api/v1/stories/901/external-approval/cycles/71/approved"
      && method === "POST"
    ) {
      expect(request.postDataJSON()).toEqual({});
      state.external = "approved";
      state.mutationPaths.push(path);
      return route.fulfill({ json: {
        ok: true,
        event_id: "3",
        changed_at: "2026-07-23T10:10:00Z",
        resource: { type: "external_approval_cycle", id: 71 },
      } });
    }
    if (path === "/api/v1/stories/901/production/mark-aired" && method === "POST") {
      expect(request.postDataJSON()).toEqual({});
      state.aired = true;
      state.mutationPaths.push(path);
      return route.fulfill({ json: {
        ok: true,
        event_id: "4",
        changed_at: "2026-07-23T10:30:00Z",
        resource: { type: "story", id: 901 },
      } });
    }
    if (path === "/api/v1/stories/901/archive" && method === "POST") {
      expect(request.postDataJSON()).toEqual({});
      state.archived = true;
      state.leaseActive = false;
      state.mutationPaths.push(path);
      return route.fulfill({ json: {
        ok: true,
        event_id: "5",
        changed_at: "2026-07-23T10:40:00Z",
        resource: { type: "story", id: 901 },
      } });
    }
    if (path === "/api/v1/stories/901/restore" && method === "POST") {
      expect(request.postDataJSON()).toEqual({});
      state.archived = false;
      state.mutationPaths.push(path);
      return route.fulfill({ json: {
        ok: true,
        event_id: "6",
        changed_at: "2026-07-23T10:50:00Z",
        resource: { type: "story", id: 901 },
      } });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "UNEXPECTED_PATH", message: `${method} ${path}` } },
    });
  });
}


test("rendered create to archive and restore flow remains current and read-only only in archive", async ({
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(90_000);
  const state: FixtureState = {
    created: false,
    revision: 0,
    rows: [],
    leaseActive: false,
    external: "none",
    aired: false,
    archived: false,
    createPosts: 0,
    savePosts: 0,
    mutationPaths: [],
  };
  const runtimeErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  await installFixture(page, state);

  await page.goto("/stories");
  await page.getByRole("button", { name: "Создать сюжет" }).click();
  const dialog = page.getByRole("dialog", { name: "Новый сюжет" });
  await expect(dialog.getByLabel("Название")).toBeFocused();
  await dialog.getByLabel("Название").fill("Синтетический полный путь");
  await dialog.getByLabel("Рубрика").selectOption("7");
  await dialog.getByLabel("Автор").selectOption("1");
  await dialog.getByRole("button", { name: "Создать" }).click();

  await expect(page).toHaveURL(/\/stories\/901\/scenario$/);
  await page.getByRole("button", { name: "Добавить блок" }).click();
  await page.getByRole("textbox", { name: "Текст блока 1" }).fill("Синтетический текст полного пути");
  await expect.poll(() => state.savePosts).toBe(1);
  await expect(page.getByText("Сохранено")).toHaveCount(0);

  await page.getByRole("link", { name: "Производство" }).click();
  await page.getByRole("button", { name: "Отправить на внешнее согласование" }).click();
  await expect(page.getByText("Ожидается результат")).toBeVisible();
  await page.getByRole("button", { name: "Согласовано" }).click();
  await expect(page.getByText("Согласовано", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Сдано / вышло в эфир" }).click();
  await expect(page.getByText("Вышел в эфир")).toBeVisible();

  await page.getByRole("link", { name: "Сценарий" }).click();
  await expect(page.getByRole("button", { name: "Добавить блок" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Текст блока 1" })).toHaveAttribute(
    "contenteditable",
    "true",
  );

  await page.getByRole("link", { name: "Производство" }).click();
  const archiveDialog = page.waitForEvent("dialog");
  const archiveClick = page.getByRole("button", { name: "В архив" }).click();
  const confirmation = await archiveDialog;
  expect(confirmation.message()).toBe("Архивировать сюжет?");
  await confirmation.accept();
  await archiveClick;
  await page.getByRole("link", { name: "Сюжеты" }).click();
  await expect(page.getByText("Синтетический полный путь")).toHaveCount(0);

  await page.getByRole("link", { name: "Архив" }).click();
  await expect(page.getByText("Синтетический полный путь")).toBeVisible();
  await page.getByRole("link", {
    name: "Открыть сценарий сюжета Синтетический полный путь",
  }).click();
  await expect(page.getByText("Архивный сценарий доступен только для чтения.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Добавить блок" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Текст блока 1" })).toHaveAttribute(
    "contenteditable",
    "false",
  );
  const mutationsBeforeArchivedRead = state.mutationPaths.length;
  await page.waitForTimeout(250);
  expect(state.mutationPaths).toHaveLength(mutationsBeforeArchivedRead);

  await page.getByRole("link", { name: "Архив" }).click();
  await page.getByRole("button", {
    name: "Вернуть в работу: Синтетический полный путь",
  }).click();
  await expect(page.getByText("Синтетический полный путь")).toHaveCount(0);
  await page.getByRole("link", { name: "Сюжеты" }).click();
  await expect(page.getByText("Синтетический полный путь")).toBeVisible();

  expect(state.createPosts).toBe(1);
  expect(state.savePosts).toBe(1);
  expect(runtimeErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("cp62-full-story-flow-success-1366.png"),
    fullPage: true,
  });
});
