import { expect, test, type Page } from "@playwright/test";

const user = {
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

async function installFixture(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" },
  ]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/auth/me") return route.fulfill({ json: user });
    if (url.pathname === "/api/v1/me/actions") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (url.pathname === "/api/v1/notifications") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (url.pathname === "/api/v1/stories/create-options") {
      return route.fulfill({
        json: {
          rubrics: [rubric],
          authors: [user],
          priority_options: [
            { code: "standard", label: "Стандарт" },
            { code: "high", label: "Высокий" },
          ],
          create_action: {
            code: "story_create",
            label: "Создать сюжет",
            method: "POST",
            href: "/api/v1/stories",
            emphasis: "primary",
            confirmation: null,
            form: "story_create",
          },
        },
      });
    }
    if (url.pathname === "/api/v1/stories" && request.method() === "GET") {
      return route.fulfill({
        json: {
          items: [{
            id: 101,
            title: "Синтетический широкий сюжет",
            priority: { code: "standard", label: "Стандарт" },
            rubric,
            author: user,
            situation: { code: "active", label: "В работе" },
            assignments: [],
            created_at: "2026-07-24T08:00:00Z",
            aired_at: null,
            archived_at: null,
            lifecycle_actions: [],
          }],
          total: 1,
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "UNEXPECTED_TEST_REQUEST", message: `${request.method()} ${url.pathname}` } },
    });
  });
}

test("wide layout keeps header inner edge aligned with content", async ({ page }) => {
  await installFixture(page);
  await page.goto("/stories");
  await expect(page.getByRole("heading", { name: "Сюжеты" })).toBeVisible();

  const header = page.locator(".app-shell-header-inner");
  const content = page.locator(".app-shell-content");
  const headerBox = await header.boundingBox();
  const contentBox = await content.boundingBox();

  expect(headerBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(headerBox!.width).toBeLessThanOrEqual(1440);
  expect(Math.abs(headerBox!.x - contentBox!.x)).toBeLessThanOrEqual(1);
});
