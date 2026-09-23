import { expect, test } from "@playwright/test";
import { installUxScenario } from "./fixtures/ux-scenarios";

test("compact shared header aligns with the working area and keeps navigation usable", async ({ page }, testInfo) => {
  await installUxScenario(page, "quiet");
  await page.goto("/stories");
  await expect(page.getByRole("table", { name: "Общий список сюжетов" })).toBeVisible();
  const header = page.locator(".app-shell-header");
  const content = page.locator(".app-shell-content");
  const [headBox, contentBox] = await Promise.all([header.boundingBox(), content.boundingBox()]);
  expect(headBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  await page.screenshot({ path: testInfo.outputPath("shared-shell.png"), fullPage: false });
  expect(Math.abs(headBox!.height - 56)).toBeLessThanOrEqual(1);
  const workingBounds = await content.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
  });
  expect(Math.abs(headBox!.x - workingBounds.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(headBox!.x + headBox!.width - workingBounds.right)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("navigation", { name: "Основные разделы" }).getByRole("link", { name: "Сюжеты" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: /Астра/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
