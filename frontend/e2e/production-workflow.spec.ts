import { expect, test, type Page } from "@playwright/test";


const user = {
  id: 1,
  username: "astra",
  display_name: "Астра",
  position: "Начальник производства",
  function_codes: ["chief", "video_editor", "designer"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-20T08:00:00Z",
};

const author = {
  id: 2,
  username: "lira",
  display_name: "Лира",
  position: "Корреспондент",
  function_codes: ["author"],
};
const secondEditor = {
  id: 3,
  username: "vega",
  display_name: "Вега",
  position: "Монтажёр",
  function_codes: ["video_editor"],
};

const action = (
  code: string,
  label: string,
  href: string,
  form: null | "correction_package" = null,
) => ({ code, label, href, method: "POST", emphasis: "normal", confirmation: null, form });

const actions = {
  voiceoverReady: action("voiceover_ready", "Озвучка готова", "/api/v1/stories/101/production/voiceover/ready"),
  voiceoverNotReady: action("voiceover_not_ready", "Вернуть озвучку в работу", "/api/v1/stories/101/production/voiceover/not-ready", "correction_package"),
  videoStart: action("video_start", "Начать монтаж", "/api/v1/stories/101/production/video/start"),
  videoReady: action("video_ready", "Ролик готов", "/api/v1/stories/101/production/video/ready"),
  videoApprove: action("video_approve_for_titles", "Ролик готов к титрам", "/api/v1/stories/101/production/video/approve-for-titles"),
  titlesStart: action("titles_start", "Начать титры", "/api/v1/stories/101/production/titles/start"),
  titlesReady: action("titles_ready", "Титры готовы", "/api/v1/stories/101/production/titles/ready"),
  titlesAccept: action("titles_accept", "Принять титры", "/api/v1/stories/101/production/titles/accept"),
};

const workflowActions = {
  confirmEditorial: action(
    "confirm_editorial",
    "Подтвердить редакционную готовность",
    "/api/v1/stories/101/workflow/confirm-editorial",
  ),
  markProofread: action(
    "mark_proofread",
    "Вычитано",
    "/api/v1/stories/101/workflow/mark-proofread",
  ),
};

interface FixtureState {
  voiceoverReady: boolean;
  video: 0 | 1 | 2 | 3;
  titles: 0 | 1 | 2 | 3;
  materials: Array<{ id: number; title: string; location: string; added_by: typeof author; added_at: string }>;
  reviewRequestedRevision?: number;
  editorialRevision?: number;
  proofreadRevision?: number;
  assignedEditorId?: number;
  archived?: boolean;
  videoUnseen?: boolean;
  titlesUnseen?: boolean;
  openVideoCorrection?: boolean;
  failRefreshAfterMaterial?: boolean;
  failNextProductionGet?: boolean;
  materialPosts?: number;
  openedContexts?: string[];
}

function productionSituation(state: FixtureState) {
  if (state.archived) return { code: "archive", label: "В архиве" };
  if (state.titles === 3) return { code: "titles_accepted", label: "Титры приняты" };
  if (state.titles === 2) return { code: "titles_ready", label: "Титры готовы · ожидают приёмки" };
  if (state.titles === 1) return { code: "titles_in_progress", label: "Титры в работе" };
  if (state.video === 3) return { code: "video_approved", label: "Ролик готов к титрам" };
  if (state.video === 2) return { code: "video_ready", label: "Ролик готов · ожидает просмотра" };
  if (state.video === 1) return { code: "video_in_progress", label: "Монтаж в работе" };
  if (state.voiceoverReady) return { code: "voiceover_ready", label: "Озвучка готова" };
  return { code: "production_pending", label: "Производство не начато" };
}

function productionModel(state: FixtureState) {
  const available = [];
  const editorialGatesSatisfied = (
    state.editorialRevision !== undefined
    && state.proofreadRevision !== undefined
  );
  const titlesInitialGateSatisfied = editorialGatesSatisfied && state.video >= 3;
  if (!state.archived) {
    available.push(state.voiceoverReady ? actions.voiceoverNotReady : actions.voiceoverReady);
    if (state.video === 0) available.push(actions.videoStart);
    if (state.video === 1 && !state.openVideoCorrection) available.push(actions.videoReady);
    if (state.video === 2 && editorialGatesSatisfied) available.push(actions.videoApprove);
    if (state.video === 3 && state.titles === 0 && editorialGatesSatisfied) available.push(actions.titlesStart);
    if (state.titles === 1) available.push(actions.titlesReady);
    if (state.titles === 2) available.push(actions.titlesAccept);
  }
  const [first, ...rest] = available;
  const primary = first ? { ...first, emphasis: "primary" } : null;
  const assignedEditor = state.assignedEditorId === secondEditor.id ? secondEditor : user;
  const story = {
    id: 101,
    title: "Синтетический сюжет: производство",
    priority: { code: "high", label: "Высокий" },
    rubric: { id: 7, name: "Тестовая рубрика" },
    author,
    situation: productionSituation(state),
    assignments: [
      { kind: "video_editor", user: assignedEditor },
      { kind: "designer", user },
    ],
    created_at: "2026-07-20T08:30:00Z",
    aired_at: null,
    archived_at: state.archived ? "2026-07-20T12:00:00Z" : null,
    primary_action: primary,
    additional_actions: rest,
  };
  return {
    story,
    scenario_revision: 7,
    assignments: story.assignments,
    assignee_options: state.archived ? [] : [user, secondEditor, author],
    can_manage_assignments: !state.archived,
    materials: state.materials,
    voiceover: {
      ready: state.voiceoverReady,
      ready_by: state.voiceoverReady ? user : null,
      ready_at: state.voiceoverReady ? "2026-07-20T10:00:00Z" : null,
    },
    video: {
      started_by: state.video >= 1 ? user : null,
      started_at: state.video >= 1 ? "2026-07-20T10:10:00Z" : null,
      ready_by: state.video >= 2 ? user : null,
      ready_at: state.video >= 2 ? "2026-07-20T10:20:00Z" : null,
      approved_for_titles_by: state.video >= 3 ? user : null,
      approved_for_titles_at: state.video >= 3 ? "2026-07-20T10:30:00Z" : null,
      last_opened_revision: null,
      has_unseen_scenario_changes: Boolean(state.videoUnseen),
    },
    titles: {
      initial_gate_satisfied: titlesInitialGateSatisfied,
      started_by: state.titles >= 1 ? user : null,
      started_at: state.titles >= 1 ? "2026-07-20T10:40:00Z" : null,
      ready_by: state.titles >= 2 ? user : null,
      ready_at: state.titles >= 2 ? "2026-07-20T10:50:00Z" : null,
      accepted_by: state.titles >= 3 ? user : null,
      accepted_at: state.titles >= 3 ? "2026-07-20T11:00:00Z" : null,
      last_opened_revision: null,
      has_unseen_scenario_changes: Boolean(state.titlesUnseen),
    },
    aired: null,
    stages: [
      { code: "voiceover", state: state.voiceoverReady ? "ready" : "pending", label: "Озвучка", summary: state.voiceoverReady ? "Готова · Астра" : "Не готова" },
      { code: "video", state: state.video === 0 ? "pending" : state.video === 1 ? "in_progress" : state.video === 2 ? "ready" : "approved", label: "Монтаж", summary: state.video === 0 ? "Монтаж не начат" : state.video === 1 ? "Монтаж в работе" : state.video === 2 ? "Ролик готов · ожидает просмотра" : "Ролик готов к титрам" },
      { code: "titles", state: state.titles === 0 ? (titlesInitialGateSatisfied ? "available" : "pending") : state.titles === 1 ? "in_progress" : state.titles === 2 ? "ready" : "accepted", label: "Титры", summary: state.titles === 0 ? (titlesInitialGateSatisfied ? "Можно начинать титры" : "Ожидают редакционную готовность, корректуру и допуск ролика") : state.titles === 1 ? "Титры в работе" : state.titles === 2 ? "Титры готовы · ожидают приёмки" : "Титры приняты" },
    ],
    primary_action: primary,
    additional_actions: rest,
  };
}

function workflowModel(state: FixtureState) {
  const available = [];
  if (state.editorialRevision === undefined && state.reviewRequestedRevision !== undefined) {
    available.push(workflowActions.confirmEditorial);
  }
  if (state.proofreadRevision === undefined) available.push(workflowActions.markProofread);
  const [first, ...rest] = available;
  const mark = (revision: number, actor: typeof user | typeof author, at: string) => ({ revision, actor, at });
  return {
    story_id: 101,
    review_request: state.reviewRequestedRevision === undefined
      ? null
      : mark(state.reviewRequestedRevision, author, "2026-07-20T09:30:00Z"),
    editorial_check: state.editorialRevision === undefined
      ? null
      : mark(state.editorialRevision, user, "2026-07-20T10:25:00Z"),
    proofread: state.proofreadRevision === undefined
      ? null
      : mark(state.proofreadRevision, user, "2026-07-20T10:27:00Z"),
    changed_after_proofread: false,
    reproofread_request: null,
    primary_action: first ? { ...first, emphasis: "primary" } : null,
    additional_actions: rest,
  };
}

async function installProductionApi(page: Page, state: FixtureState): Promise<void> {
  await page.context().addCookies([
    { name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" },
  ]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: user });
    if (path === "/api/v1/stories/101/production" && request.method() === "GET") {
      if (state.failNextProductionGet) {
        state.failNextProductionGet = false;
        return route.fulfill({ status: 503, json: { error: { code: "REFRESH_FAILED", message: "Временная ошибка обновления", details: {} } } });
      }
      return route.fulfill({ json: productionModel(state) });
    }
    if (path === "/api/v1/stories/101" && request.method() === "GET") {
      return route.fulfill({ json: productionModel(state).story });
    }
    if (path === "/api/v1/stories/101/scenario" && request.method() === "GET") {
      return route.fulfill({ json: {
        story: { id: 101, title: "Синтетический сюжет: производство" },
        scenario: { revision: 7, rows: [] },
        edit: { state: "available" },
        captionpanels: null,
      } });
    }
    if (path === "/api/v1/stories/101/workflow" && request.method() === "GET") {
      return route.fulfill({ json: workflowModel(state) });
    }
    if (path === "/api/v1/stories/101/scenario/opened" && request.method() === "POST") {
      const payload = request.postDataJSON() as { revision: number; context: string };
      expect(payload.revision).toBe(7);
      state.openedContexts = [...(state.openedContexts ?? []), payload.context];
      if (payload.context === "video") state.videoUnseen = false;
      if (payload.context === "titles") state.titlesUnseen = false;
      return route.fulfill({ json: { ok: true, event_id: null, changed_at: "2026-07-20T10:00:00Z", resource: { type: "scenario", id: 1 } } });
    }
    if (path === actions.voiceoverReady.href && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({});
      state.voiceoverReady = true;
      return route.fulfill({ json: { ok: true, event_id: "1", changed_at: "2026-07-20T10:00:00Z", resource: null } });
    }
    if (path === actions.voiceoverNotReady.href && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ description: "Перезаписать финал", assignee_user_id: 1 });
      state.voiceoverReady = false;
      return route.fulfill({ json: { ok: true, event_id: "2", changed_at: "2026-07-20T10:05:00Z", resource: null } });
    }
    if (path === "/api/v1/stories/101/materials" && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ title: "Карта", location: "https://example.invalid/map" });
      state.materials.push({ id: 9, title: "Карта", location: "https://example.invalid/map", added_by: author, added_at: "2026-07-20T10:06:00Z" });
      state.materialPosts = (state.materialPosts ?? 0) + 1;
      if (state.failRefreshAfterMaterial) state.failNextProductionGet = true;
      return route.fulfill({ json: { ok: true, event_id: "3", changed_at: "2026-07-20T10:06:00Z", resource: { type: "story_material", id: 9 } } });
    }
    if (path === actions.videoStart.href && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ revision: 7 });
      state.video = 1;
      return route.fulfill({ json: { ok: true, event_id: "4", changed_at: "2026-07-20T10:10:00Z", resource: null } });
    }
    if (path === actions.videoReady.href && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({});
      state.video = 2;
      return route.fulfill({ json: { ok: true, event_id: "5", changed_at: "2026-07-20T10:20:00Z", resource: null } });
    }
    if (path === workflowActions.confirmEditorial.href && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ revision: 7 });
      state.editorialRevision = 7;
      return route.fulfill({ json: { ok: true, event_id: "workflow-1", changed_at: "2026-07-20T10:25:00Z", resource: { type: "story_workflow", id: 101 } } });
    }
    if (path === workflowActions.markProofread.href && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ revision: 7 });
      state.proofreadRevision = 7;
      return route.fulfill({ json: { ok: true, event_id: "workflow-2", changed_at: "2026-07-20T10:27:00Z", resource: { type: "story_workflow", id: 101 } } });
    }
    if (path === actions.videoApprove.href && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({});
      state.video = 3;
      return route.fulfill({ json: { ok: true, event_id: "6", changed_at: "2026-07-20T10:30:00Z", resource: null } });
    }
    if (path === actions.titlesStart.href && request.method() === "POST") {
      expect(request.postDataJSON()).toEqual({ revision: 7 });
      state.titles = 1;
      return route.fulfill({ json: { ok: true, event_id: "7", changed_at: "2026-07-20T10:40:00Z", resource: null } });
    }
    if (path === actions.titlesReady.href && request.method() === "POST") {
      state.titles = 2;
      return route.fulfill({ json: { ok: true, event_id: "8", changed_at: "2026-07-20T10:50:00Z", resource: null } });
    }
    if (path === actions.titlesAccept.href && request.method() === "POST") {
      state.titles = 3;
      return route.fulfill({ json: { ok: true, event_id: "9", changed_at: "2026-07-20T11:00:00Z", resource: null } });
    }
    if (path === "/api/v1/stories/101/assignments/video_editor" && request.method() === "PUT") {
      state.assignedEditorId = (request.postDataJSON() as { user_id: number }).user_id;
      return route.fulfill({ json: { ok: true, event_id: "10", changed_at: "2026-07-20T11:00:00Z", resource: null } });
    }
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected API path: ${request.method()} ${path}` } } });
  });
}

test("production direct URL renders server gates and advances the complete CP4.2 workflow", async ({ page }) => {
  test.setTimeout(60_000);
  const state: FixtureState = {
    voiceoverReady: false,
    video: 0,
    titles: 0,
    reviewRequestedRevision: 7,
    materials: [{ id: 8, title: "Исходная съёмка", location: "smb://news/source.mov", added_by: author, added_at: "2026-07-20T09:00:00Z" }],
  };
  const unexpectedErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") unexpectedErrors.push(message.text()); });
  page.on("pageerror", (error) => unexpectedErrors.push(error.message));
  await installProductionApi(page, state);

  await page.goto("/stories/101/production");

  await expect(page.getByRole("heading", { name: "Синтетический сюжет: производство" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Разделы сюжета" }).getByRole("link")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Производство" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Начать монтаж" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ролик готов" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Начать титры" })).toHaveCount(0);
  await expect(page.locator(".production-actions button.primary")).toHaveCount(1);
  await page.screenshot({ path: "../artifacts/product-reset/cp42-production-initial-1366.png", fullPage: true });

  await page.getByRole("button", { name: "Озвучка готова" }).click();
  await expect(page.getByText("Готова", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Вернуть озвучку в работу" }).click();
  await page.getByLabel("Что исправить в озвучке").fill("Перезаписать финал");
  await page.getByLabel("Ответственный за правку").selectOption("1");
  await page.getByRole("button", { name: "Создать правку и вернуть" }).click();
  await expect(page.getByRole("region", { name: "Озвучка" }).getByText("Не готова", { exact: true })).toBeVisible();

  await page.getByLabel("Название материала").fill("Карта");
  await page.getByLabel("Путь или ссылка").fill("https://example.invalid/map");
  await page.getByRole("button", { name: "Добавить материал" }).click();
  await expect(page.getByText("Карта", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Начать монтаж" }).click();
  await expect(page.getByRole("region", { name: "Этапы производства" }).getByText("Монтаж в работе", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ролик готов" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ролик готов" })).not.toBeFocused();
  await page.getByRole("button", { name: "Ролик готов" }).click();
  await expect(page.getByText("Автор: Лира · Ролик готов · ожидает просмотра", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ролик готов к титрам" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Начать титры" })).toHaveCount(0);

  await page.getByRole("link", { name: "Сценарий" }).click();
  await expect(page.getByRole("button", { name: "Подтвердить редакционную готовность" })).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить редакционную готовность" }).click();
  await expect(page.getByRole("button", { name: "Подтвердить редакционную готовность" })).toHaveCount(0);
  await page.getByRole("button", { name: "Вычитано" }).click();
  await expect(page.getByRole("region", { name: "Редакционная проверка и корректура" }).getByText(/Астра, редакция 7/)).toHaveCount(2);

  await page.getByRole("link", { name: "Производство" }).click();
  await expect(page.getByRole("button", { name: "Ролик готов к титрам" })).toBeVisible();
  await page.getByRole("button", { name: "Ролик готов к титрам" }).click();
  await expect(page.getByRole("button", { name: "Начать титры" })).toBeVisible();
  await page.getByRole("button", { name: "Начать титры" }).click();
  await page.getByRole("button", { name: "Титры готовы" }).click();
  await page.getByRole("button", { name: "Принять титры" }).click();
  await expect(page.getByText("Автор: Лира · Титры приняты", { exact: true })).toBeVisible();
  await expect(page.getByText("Завершено: 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Принять титры" })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/\/stories\/101\/production$/);
  await expect(page.getByText("Автор: Лира · Титры приняты", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Разделы сюжета" }).getByRole("link")).toHaveCount(3);
  await expect(page.locator(".production-actions button.primary")).toHaveCount(1);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
  expect(unexpectedErrors).toEqual([]);
  await page.screenshot({ path: "../artifacts/product-reset/cp42-production-final-1366.png", fullPage: true });
});

test("assignment mutation persists and archived production exposes no management", async ({ page }) => {
  const state: FixtureState = { voiceoverReady: false, video: 0, titles: 0, materials: [] };
  await installProductionApi(page, state);
  await page.goto("/stories/101/production");

  const editorSelect = page.getByRole("combobox", { name: "Ответственный: Монтажёр" });
  await editorSelect.selectOption(String(secondEditor.id));
  await editorSelect.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' production-assignment ')][1]").getByRole("button", { name: "Сохранить" }).click();
  await expect(editorSelect).toHaveValue(String(secondEditor.id));
  expect(state.assignedEditorId).toBe(secondEditor.id);

  state.archived = true;
  await page.reload();
  await expect(page.getByText("В архиве")).toBeVisible();
  await expect(page.getByRole("region", { name: "Действия производства" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Ответственный: Монтажёр" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Добавить материал" })).toHaveCount(0);
});

test("opening Scenario marks every unseen production track and returning shows them seen", async ({ page }) => {
  const state: FixtureState = {
    voiceoverReady: false,
    video: 1,
    titles: 1,
    materials: [],
    videoUnseen: true,
    titlesUnseen: true,
    openedContexts: [],
  };
  await installProductionApi(page, state);
  await page.goto("/stories/101/production");

  await expect(page.getByLabel("Изменения сценария")).toBeVisible();
  expect(state.openedContexts).toEqual([]);
  await page.getByRole("link", { name: "Сценарий" }).click();
  await expect(page).toHaveURL(/production_context=video&production_context=titles/);
  await expect(page.getByRole("button", { name: "Добавить блок" })).toBeVisible();
  await expect.poll(() => state.openedContexts).toEqual(["video", "titles"]);

  await page.getByRole("link", { name: "Производство" }).click();
  await expect(page.getByLabel("Изменения сценария")).toHaveCount(0);
});

test("open correction hides ready action and acknowledged material retries refresh without duplicate", async ({ page }) => {
  const state: FixtureState = {
    voiceoverReady: false,
    video: 1,
    titles: 0,
    materials: [],
    openVideoCorrection: true,
    failRefreshAfterMaterial: true,
  };
  await installProductionApi(page, state);
  await page.goto("/stories/101/production");

  await expect(page.getByRole("button", { name: "Ролик готов" })).toHaveCount(0);
  await page.getByLabel("Название материала").fill("Карта");
  await page.getByLabel("Путь или ссылка").fill("https://example.invalid/map");
  await page.getByRole("button", { name: "Добавить материал" }).click();
  await expect(page.getByRole("alert")).toContainText("Действие выполнено, но данные не обновились");
  expect(state.materialPosts).toBe(1);

  await page.getByRole("button", { name: "Повторить обновление" }).click();
  await expect(page.getByText("Карта", { exact: true })).toBeVisible();
  expect(state.materialPosts).toBe(1);
});
