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
const managementAction = {
  code: "story_management_update",
  label: "Изменить автора или приоритет",
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
    management: {
      action: managementAction,
      author_options: [user],
      priority_options: [
        { code: "standard", label: "Стандарт" },
        { code: "high", label: "Высокий" },
      ],
    },
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
          rubric_management: null,
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
    if (path === managementAction.href && method === "PATCH") {
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
  await dialog.getByLabel("Приоритет").click();
  await page.getByRole("option", { name: "Высокий" }).click();
  await dialog.getByRole("button", { name: "Создать" }).click();
  await expect.poll(() => capturedCreatePayload?.priority).toBe("high");

  await page.goto("/stories");
  const prioritySelect = page.getByRole("combobox", {
    name: "Приоритет сюжета Синтетический приоритет",
  });
  await prioritySelect.click();
  await page.getByRole("option", { name: "Стандарт" }).click();
  await expect.poll(() => capturedPatchPayload).toEqual({ priority: "standard" });
  await expect(prioritySelect).toContainText("Стандарт");
  expect(await prioritySelect.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const filterControls = page.locator(".story-filters .MuiInputBase-root");
  await expect(filterControls).toHaveCount(3);
  const filterControlHeights = await filterControls.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height));
  expect(filterControlHeights.every((height) => height >= 34 && height <= 36)).toBe(true);

  const filterLabelOffsets = await page.locator(".story-filters .MuiInputLabel-root").evaluateAll((labels) =>
    labels.map((label) => {
      const control = label.closest(".MuiFormControl-root")?.querySelector(".MuiInputBase-root");
      if (!control) return Number.POSITIVE_INFINITY;
      const labelRect = label.getBoundingClientRect();
      const controlRect = control.getBoundingClientRect();
      return Math.abs(
        labelRect.top + labelRect.height / 2 - (controlRect.top + controlRect.height / 2),
      );
    }));
  expect(filterLabelOffsets.every((offset) => offset <= 1.5)).toBe(true);

  const priorityGeometry = await prioritySelect.evaluate((element) => {
    const root = element.closest(".MuiInputBase-root");
    const icon = root?.querySelector(".MuiSelect-icon");
    if (!root || !icon || !element.firstChild) return null;
    const rootRect = root.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element.firstChild);
    const textRect = range.getBoundingClientRect();
    return {
      width: rootRect.width,
      height: rootRect.height,
      textCenterOffset: Math.abs(
        textRect.top + textRect.height / 2 - (rootRect.top + rootRect.height / 2),
      ),
      iconCenterOffset: Math.abs(
        iconRect.top + iconRect.height / 2 - (rootRect.top + rootRect.height / 2),
      ),
    };
  });
  expect(priorityGeometry).not.toBeNull();
  expect(priorityGeometry!.width).toBeLessThanOrEqual(104);
  expect(priorityGeometry!.height).toBeLessThanOrEqual(28);
  expect(priorityGeometry!.textCenterOffset).toBeLessThanOrEqual(1.5);
  expect(priorityGeometry!.iconCenterOffset).toBeLessThanOrEqual(1.5);

  const priorityColumnWidth = await page.locator(".stories-table tbody td").first()
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(priorityColumnWidth).toBeLessThanOrEqual(148);

  await page.setViewportSize({ width: 900, height: 768 });
  const wrappedActions = page.locator(".stories-toolbar .stories-page-actions");
  await expect(wrappedActions).toBeVisible();
  expect(await wrappedActions.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe("0px");
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
