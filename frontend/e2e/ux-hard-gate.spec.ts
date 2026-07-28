import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { installUxScenario } from "./fixtures/ux-scenarios";

const expectedColumns = [
  "Приоритет",
  "Название",
  "Рубрика",
  "Автор",
  "Что происходит",
  "Исполнители",
  "Изменён",
  "Создан",
];

function evidencePath(testInfo: TestInfo, surface: "stories" | "production"): string {
  return `../artifacts/product-reset/CP7/ux/after/${surface}-${testInfo.project.name}.png`;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectSixRowsInsideViewport(rows: Locator, page: Page): Promise<void> {
  await expect(rows).toHaveCount(30);
  const viewport = page.viewportSize();
  const sixth = await rows.nth(5).boundingBox();
  expect(viewport).not.toBeNull();
  expect(sixth).not.toBeNull();
  expect(sixth!.y + sixth!.height).toBeLessThanOrEqual(viewport!.height);
}

test("desktop keeps the common list primary with compact attention", async ({ page }, testInfo) => {
  const fixture = await installUxScenario(page, "attention");
  await page.goto("/stories");
  await fixture.waitForActionsSettled();

  const table = page.getByRole("table", { name: "Общий список сюжетов" });
  await expect(table).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const tableBox = await table.boundingBox();
  expect(tableBox).not.toBeNull();
  expect(tableBox!.y).toBeLessThan(430);

  const rows = table.locator("tbody tr");
  await expectSixRowsInsideViewport(rows, page);

  const attention = page.getByRole("region", { name: "Требует внимания" });
  await expect(attention).toBeVisible();
  await expect(attention.getByRole("listitem")).toHaveCount(3);
  const attentionBox = await attention.boundingBox();
  expect(attentionBox).not.toBeNull();
  expect(attentionBox!.height).toBeLessThanOrEqual(122);

  await expectNoHorizontalOverflow(page);
  await expect(table.getByRole("columnheader")).toHaveText(expectedColumns);
  await expect(page.locator('.app-shell-content [data-primary-action="true"]:visible')).toHaveCount(1);

  await page.screenshot({ path: evidencePath(testInfo, "stories"), fullPage: true });
});

test("empty attention response leaves no block or reserved height", async ({ page }) => {
  const fixture = await installUxScenario(page, "quiet");
  await page.goto("/stories");
  await fixture.waitForActionsSettled();

  const emptyState = page.locator('[data-attention-state="empty"]');
  await expect(emptyState).toBeAttached();
  expect(await emptyState.evaluate((node) => node.getBoundingClientRect().height)).toBe(0);
  await expect(page.getByRole("region", { name: "Требует внимания" })).toHaveCount(0);
  const table = page.getByRole("table", { name: "Общий список сюжетов" });
  const tableBox = await table.boundingBox();
  expect(tableBox).not.toBeNull();
  expect(tableBox!.y).toBeLessThan(320);
  await expectSixRowsInsideViewport(
    table.locator("tbody tr"),
    page,
  );
});

test("story card preserves the URL, one primary action and collapsed completed stages", async ({ page }, testInfo) => {
  await installUxScenario(page, "production");
  await page.goto("/stories/101/production");

  const tabs = page.getByRole("navigation", { name: "Разделы сюжета" }).getByRole("link");
  await expect(tabs).toHaveCount(3);
  await expect(tabs).toHaveText(["Сценарий", "Производство", "История"]);
  await expect(page.getByRole("link", { name: "Производство" })).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(page).toHaveURL(/\/stories\/101\/production$/);
  await expect(page.getByRole("link", { name: "Производство" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('.app-shell-content [data-primary-action="true"]:visible')).toHaveCount(1);

  const completed = page.locator("details.production-completed-stages");
  await expect(completed).toHaveCount(1);
  await expect(completed).not.toHaveAttribute("open", "");
  await expect(completed.getByText("Озвучка", { exact: true })).not.toBeVisible();
  await expect(completed.getByText("Титры", { exact: true })).not.toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.screenshot({ path: evidencePath(testInfo, "production"), fullPage: true });
});
