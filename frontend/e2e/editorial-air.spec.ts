import { expect, test, type Page, type TestInfo } from "@playwright/test";

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
const createAction = {
  code: "story_create",
  label: "Создать сюжет",
  method: "POST",
  href: "/api/v1/stories",
  emphasis: "primary",
  confirmation: null,
  form: "story_create",
};
const stories = Array.from({ length: 6 }, (_, index) => ({
  id: 101 + index,
  title: `Синтетический сюжет ${index + 1}`,
  priority: index === 0
    ? { code: "high", label: "Высокий" }
    : { code: "standard", label: "Стандарт" },
  rubric,
  author: user,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: `2026-07-24T0${8 - Math.min(index, 7)}:00:00Z`,
  aired_at: null,
  archived_at: null,
  lifecycle_actions: [],
}));

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
      return route.fulfill({ json: { rubrics: [rubric], authors: [user], create_action: createAction } });
    }
    if (url.pathname === "/api/v1/stories" && request.method() === "GET") {
      return route.fulfill({ json: { items: stories, total: stories.length } });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "UNEXPECTED_TEST_REQUEST", message: `${request.method()} ${url.pathname}` } },
    });
  });
}

test("Editorial Air replaces corporate identity with local Onest and semantic visual tokens", async ({ page }, testInfo: TestInfo) => {
  await installFixture(page);
  await page.goto("/stories");
  await expect(page.getByRole("heading", { level: 1, name: "Newscast Navigator" })).toBeVisible();

  const shellHeader = page.locator(".app-shell-header");
  await expect(shellHeader.getByRole("img")).toHaveCount(0);
  await expect(shellHeader).not.toContainText(new RegExp(["транс", "нефт"].join(""), "i"));
  await expect(shellHeader).toContainText("Редакционный эфир");

  const visualSystem = await page.evaluate(async () => {
    await document.fonts.ready;
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const button = getComputedStyle(document.querySelector("button")!);
    const loadedOnest = Array.from(document.fonts).some(
      (face) => face.family.replace(/"/g, "") === "Onest" && face.status === "loaded",
    );
    const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
    return {
      bodyFont: body.fontFamily,
      buttonFont: button.fontFamily,
      canvas: root.getPropertyValue("--color-canvas").trim(),
      paper: root.getPropertyValue("--color-paper").trim(),
      ink: root.getPropertyValue("--color-ink").trim(),
      action: root.getPropertyValue("--color-action").trim(),
      coral: root.getPropertyValue("--color-coral").trim(),
      loadedOnest,
      fontRequested: resources.some((name) => name.includes("/fonts/onest/Onest-VariableFont.woff2")),
    };
  });

  expect(visualSystem.bodyFont).toContain("Onest");
  expect(visualSystem.buttonFont).toContain("Onest");
  expect(visualSystem.loadedOnest).toBe(true);
  expect(visualSystem.fontRequested).toBe(true);
  expect(visualSystem.canvas).not.toBe("");
  expect(visualSystem.paper).not.toBe("");
  expect(visualSystem.ink).not.toBe("");
  expect(visualSystem.action).not.toBe("");
  expect(visualSystem.coral).not.toBe("");

  await expect(page.locator(".stories-page .primary:visible")).toHaveCount(1);
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.screenshot({
    path: testInfo.outputPath(`editorial-air-stories-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
