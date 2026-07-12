import { expect, test, type Page } from "@playwright/test";

const syntheticUser = {
  id: 1,
  username: "synthetic_author",
  display_name: "Тест",
  position: "Корреспондент",
  function_codes: ["author"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-12T09:00:00Z",
};

const syntheticStory = {
  id: 101,
  title: "Синтетический выпуск",
  priority: { code: "high", label: "Высокий" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author: syntheticUser,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: "2026-07-12T09:00:00Z",
  archived_at: null,
};

async function installStoryApi(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "newscast_session",
      value: "synthetic-session",
      url: "http://127.0.0.1:5173",
    },
  ]);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/me") {
      await route.fulfill({ json: syntheticUser });
      return;
    }
    if (path === "/api/v1/stories") {
      await route.fulfill({ json: { items: [syntheticStory], total: 1 } });
      return;
    }
    if (path === "/api/v1/stories/101") {
      await route.fulfill({ json: syntheticStory });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { message: `Unexpected API path: ${path}` } } });
  });
}

test("прямой URL сценария переживает обновление и использует cookie-сессию", async ({ page }) => {
  await installStoryApi(page);

  await page.goto("/stories/101/scenario");

  await expect(page.getByRole("heading", { name: "Синтетический выпуск" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Сценарий" })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/\/stories\/101\/scenario$/);

  await page.reload();

  await expect(page.getByRole("heading", { name: "Синтетический выпуск" })).toBeVisible();
  await expect(page).toHaveURL(/\/stories\/101\/scenario$/);
});
