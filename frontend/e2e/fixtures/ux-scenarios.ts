import type { Page } from "@playwright/test";

export type UxScenario = "attention" | "quiet" | "production";

const actor = {
  id: 1,
  username: "astra",
  display_name: "Астра",
  position: "Начальник-корреспондент",
  function_codes: ["author", "chief"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-24T08:00:00Z",
};

const rubric = { id: 7, name: "Новости" };

const action = (
  code: string,
  label: string,
  href: string,
  emphasis: "primary" | "normal" | "danger" = "primary",
) => ({
  code,
  label,
  method: "POST",
  href,
  emphasis,
  confirmation: null,
  form: null,
});

export const uxStories = Array.from({ length: 30 }, (_, index) => ({
  id: 101 + index,
  title: `Синтетический сюжет ${index + 1}`,
  priority: index % 5 === 0
    ? { code: "high", label: "Высокий" }
    : { code: "standard", label: "Стандарт" },
  rubric: index % 3 === 0 ? rubric : { id: 8, name: "Город" },
  author: actor,
  situation: index % 4 === 0
    ? { code: "video_in_progress", label: "Монтаж в работе" }
    : { code: "active", label: "В работе" },
  assignments: index % 3 === 0
    ? [{
      kind: "video_editor",
      user: {
        id: 20 + index,
        username: `editor_${index}`,
        display_name: `Монтажёр ${index + 1}`,
        position: "Монтажёр",
        function_codes: ["video_editor"],
      },
    }]
    : [],
  created_at: `2026-07-24T${String(8 + (index % 8)).padStart(2, "0")}:00:00Z`,
  aired_at: null,
  archived_at: null,
  lifecycle_actions: [],
}));

const productionPrimary = action(
  "video_start",
  "Начать монтаж",
  "/api/v1/stories/101/production/video/start",
);

const productionModel = {
  story: {
    ...uxStories[0],
    title: "Синтетический сюжет: UX hard gate",
    primary_action: productionPrimary,
    additional_actions: [],
  },
  scenario_revision: 7,
  assignments: [],
  assignee_options: [actor],
  can_manage_assignments: true,
  materials: [],
  corrections: {
    href: "/api/v1/stories/101/correction-packages",
    total_count: 0,
    open_count: 0,
    awaiting_leadership_review_count: 0,
  },
  voiceover: { ready: true, ready_by: actor, ready_at: "2026-07-24T09:00:00Z" },
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
  aired: null,
  stages: [
    { code: "voiceover", state: "ready", label: "Озвучка", summary: "Готова" },
    { code: "video", state: "available", label: "Монтаж", summary: "Можно начинать" },
    { code: "titles", state: "accepted", label: "Титры", summary: "Приняты" },
  ],
  primary_action: productionPrimary,
  additional_actions: [],
};

const personalActions = Array.from({ length: 3 }, (_, index) => ({
  id: `action-${index + 1}`,
  story: {
    id: uxStories[index].id,
    title: uxStories[index].title,
    priority: uxStories[index].priority,
  },
  summary: index === 0
    ? "Подтвердить редакционную готовность"
    : "Открыть актуальный сценарий и продолжить работу",
  target_href: `/stories/${uxStories[index].id}/scenario`,
  action: {
    code: "open_story",
    label: "Открыть",
    method: "GET",
    href: `/stories/${uxStories[index].id}/scenario`,
    emphasis: "normal",
    confirmation: null,
    form: null,
  },
}));

export interface UxFixture {
  waitForActionsSettled: () => Promise<void>;
}

export async function installUxScenario(page: Page, scenario: UxScenario): Promise<UxFixture> {
  let resolveActionsResponse: (() => void) | null = null;
  const actionsResponseFulfilled = new Promise<void>((resolve) => {
    resolveActionsResponse = resolve;
  });

  await page.context().addCookies([
    { name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" },
  ]);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/auth/me") return route.fulfill({ json: actor });
    if (path === "/api/v1/notifications" && method === "GET") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/me/actions" && method === "GET") {
      const items = scenario === "attention" ? personalActions : [];
      await route.fulfill({ json: { items, total: items.length } });
      resolveActionsResponse?.();
      resolveActionsResponse = null;
      return;
    }
    if (path === "/api/v1/stories/create-options" && method === "GET") {
      return route.fulfill({
        json: {
          rubrics: [rubric],
          authors: [actor],
          create_action: {
            ...action("story_create", "Создать сюжет", "/api/v1/stories"),
            form: "story_create",
          },
        },
      });
    }
    if (path === "/api/v1/stories" && method === "GET") {
      return route.fulfill({ json: { items: uxStories, total: uxStories.length } });
    }
    if (path === "/api/v1/stories/101/production" && method === "GET") {
      return route.fulfill({ json: productionModel });
    }
    if (path === "/api/v1/stories/101/correction-packages" && method === "GET") {
      return route.fulfill({
        json: { story_id: 101, items: [], assignee_options: [actor], create_action: null },
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

  const expectedState = scenario === "attention" ? "ready" : "empty";
  return {
    waitForActionsSettled: async () => {
      await actionsResponseFulfilled;
      await page.locator(`[data-attention-state="${expectedState}"]`).waitFor({
        state: "attached",
      });
    },
  };
}
