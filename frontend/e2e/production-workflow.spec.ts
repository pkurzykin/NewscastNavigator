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

interface FixtureState {
  voiceoverReady: boolean;
  video: 0 | 1 | 2 | 3;
  titles: 0 | 1 | 2 | 3;
  materials: Array<{ id: number; title: string; location: string; added_by: typeof author; added_at: string }>;
}

function productionModel(state: FixtureState) {
  const available = [];
  if (state.video === 0) available.push(actions.videoStart);
  if (state.video === 1) available.push(actions.videoReady);
  if (state.video === 2) available.push(actions.videoApprove);
  if (state.video === 3 && state.titles === 0) available.push(actions.titlesStart);
  if (state.titles === 1) available.push(actions.titlesReady);
  if (state.titles === 2) available.push(actions.titlesAccept);
  available.push(state.voiceoverReady ? actions.voiceoverNotReady : actions.voiceoverReady);
  const [first, ...rest] = available;
  const primary = first ? { ...first, emphasis: "primary" } : null;
  const story = {
    id: 101,
    title: "Синтетический сюжет: производство",
    priority: { code: "high", label: "Высокий" },
    rubric: { id: 7, name: "Тестовая рубрика" },
    author,
    situation: { code: "active", label: "В работе" },
    assignments: [
      { kind: "video_editor", user },
      { kind: "designer", user },
    ],
    created_at: "2026-07-20T08:30:00Z",
    aired_at: null,
    archived_at: null,
    primary_action: primary,
    additional_actions: rest,
  };
  return {
    story,
    scenario_revision: 7,
    assignments: story.assignments,
    assignee_options: [user, author],
    can_manage_assignments: true,
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
      has_unseen_scenario_changes: false,
    },
    titles: {
      initial_gate_satisfied: state.video >= 3,
      started_by: state.titles >= 1 ? user : null,
      started_at: state.titles >= 1 ? "2026-07-20T10:40:00Z" : null,
      ready_by: state.titles >= 2 ? user : null,
      ready_at: state.titles >= 2 ? "2026-07-20T10:50:00Z" : null,
      accepted_by: state.titles >= 3 ? user : null,
      accepted_at: state.titles >= 3 ? "2026-07-20T11:00:00Z" : null,
      last_opened_revision: null,
      has_unseen_scenario_changes: false,
    },
    aired: null,
    stages: [
      { code: "voiceover", state: state.voiceoverReady ? "ready" : "pending", label: "Озвучка", summary: state.voiceoverReady ? "Готова · Астра" : "Не готова" },
      { code: "video", state: state.video === 0 ? "pending" : state.video === 1 ? "in_progress" : state.video === 2 ? "ready" : "approved", label: "Монтаж", summary: state.video === 0 ? "Монтаж не начат" : state.video === 1 ? "Монтаж в работе" : state.video === 2 ? "Ролик готов · ожидает просмотра" : "Ролик готов к титрам" },
      { code: "titles", state: state.titles === 0 ? (state.video >= 3 ? "available" : "pending") : state.titles === 1 ? "in_progress" : state.titles === 2 ? "ready" : "accepted", label: "Титры", summary: state.titles === 0 ? (state.video >= 3 ? "Можно начинать титры" : "Ожидают первоначальный допуск") : state.titles === 1 ? "Титры в работе" : state.titles === 2 ? "Титры готовы · ожидают приёмки" : "Титры приняты" },
    ],
    primary_action: primary,
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
      return route.fulfill({ json: productionModel(state) });
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
    if (path === actions.videoApprove.href && request.method() === "POST") {
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
    if (path.includes("/assignments/") && ["PUT", "DELETE"].includes(request.method())) {
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
  await expect(page.getByText("Монтаж в работе")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ролик готов" })).toBeFocused();
  await page.getByRole("button", { name: "Ролик готов" }).click();
  await expect(page.getByRole("button", { name: "Ролик готов к титрам" })).toBeVisible();
  await page.getByRole("button", { name: "Ролик готов к титрам" }).click();
  await expect(page.getByRole("button", { name: "Начать титры" })).toBeVisible();
  await page.getByRole("button", { name: "Начать титры" }).click();
  await page.getByRole("button", { name: "Титры готовы" }).click();
  await page.getByRole("button", { name: "Принять титры" }).click();
  await expect(page.getByText("Титры приняты")).toBeVisible();
  await expect(page.getByRole("button", { name: "Принять титры" })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/\/stories\/101\/production$/);
  await expect(page.getByText("Титры приняты")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Разделы сюжета" }).getByRole("link")).toHaveCount(3);
  await expect(page.locator(".production-actions button.primary")).toHaveCount(1);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
  expect(unexpectedErrors).toEqual([]);
  await page.screenshot({ path: "../artifacts/product-reset/cp42-production-final-1366.png", fullPage: true });
});
