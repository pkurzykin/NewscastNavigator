import { expect, test } from "@playwright/test";

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
  const dialog = page.getByRole("dialog", { name: "Новый сюжет" });
  await dialog.getByLabel("Название").fill("Синтетический приоритет");
  await dialog.getByLabel("Приоритет").selectOption("high");
  await dialog.getByRole("button", { name: "Создать" }).click();
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
