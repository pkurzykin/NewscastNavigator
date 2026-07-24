import AxeBuilder from "@axe-core/playwright";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { installUxScenario } from "./fixtures/ux-scenarios";

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
const story = {
  id: 101,
  title: "Синтетический доступный сюжет",
  priority: { code: "high", label: "Высокий" },
  rubric,
  author: user,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: "2026-07-24T08:00:00Z",
  aired_at: null,
  archived_at: null,
  lifecycle_actions: [],
};
const notification = {
  id: 77,
  kind: "story_action",
  story: { id: story.id, title: story.title, priority: story.priority },
  actor: user,
  title: "Нужно проверить сюжет",
  summary: "Откройте актуальный сценарий",
  target_href: "/stories/101/scenario",
  diff: null,
  created_at: "2026-07-24T08:00:00Z",
  updated_at: "2026-07-24T08:00:00Z",
  read_at: null,
};

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
      return route.fulfill({ json: { items: [notification], total: 1, unread_count: 1 } });
    }
    if (url.pathname === "/api/v1/stories/create-options") {
      return route.fulfill({
        json: {
          rubrics: [rubric],
          authors: [user],
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
      return route.fulfill({ json: { items: [story], total: 1 } });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "UNEXPECTED_TEST_REQUEST", message: `${request.method()} ${url.pathname}` } },
    });
  });
}

async function expectNoSeriousAccessibilityViolations(
  page: Page,
  artifactPath: string,
): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    `${JSON.stringify({
      testEngine: result.testEngine,
      testEnvironment: result.testEnvironment,
      url: result.url,
      viewport: page.viewportSize(),
      violations: result.violations,
    }, null, 2)}\n`,
    "utf8",
  );
  expect(result.violations.filter((violation) => (
    violation.impact === "critical" || violation.impact === "serious"
  ))).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await installFixture(page);
  await page.goto("/stories");
  await expect(page.getByRole("heading", { name: "Сюжеты" })).toBeVisible();
});

function axeArtifactPath(testInfo: TestInfo, surface: string): string {
  return `../artifacts/product-reset/CP7/ux/axe/axe-${surface}-${testInfo.project.name}.json`;
}

test("main screen, notification tray and story form have no serious axe violations", async ({ page }, testInfo) => {
  await expectNoSeriousAccessibilityViolations(page, axeArtifactPath(testInfo, "stories"));
  await expect(access(axeArtifactPath(testInfo, "stories"))).resolves.toBeUndefined();

  await page.getByRole("button", { name: "Уведомления, непрочитанных: 1" }).click();
  await expect(page.getByRole("region", { name: "Уведомления" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, axeArtifactPath(testInfo, "notifications"));

  await page.getByRole("button", { name: "Создать сюжет" }).click();
  const dialog = page.getByRole("dialog", { name: "Новый сюжет" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Название")).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page, axeArtifactPath(testInfo, "dialog"));
});

test("story production surface has no serious axe violations", async ({ page }, testInfo) => {
  await page.unroute("**/api/v1/**");
  await installUxScenario(page, "production");
  await page.goto("/stories/101/production");
  await expect(page.getByRole("heading", { name: "Синтетический сюжет: UX hard gate" })).toBeVisible();

  await expectNoSeriousAccessibilityViolations(page, axeArtifactPath(testInfo, "production"));
});

test("keyboard focus is prominent and create dialog traps then restores it", async ({ page }) => {
  const storiesLink = page.getByRole("link", { name: "Сюжеты" });
  await storiesLink.focus();
  const focusStyle = await storiesLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: Number.parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      offset: Number.parseFloat(style.outlineOffset),
    };
  });
  expect(focusStyle.style).not.toBe("none");
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);
  expect(focusStyle.offset).toBeGreaterThanOrEqual(2);

  const trigger = page.getByRole("button", { name: "Создать сюжет" });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Новый сюжет" });
  const cancel = dialog.getByRole("button", { name: "Отмена" });
  await cancel.focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Закрыть" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
