import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("unauthenticated layout keeps one accessible footer at the viewport bottom", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/auth/me") {
      return route.fulfill({
        status: 401,
        json: {
          error: {
            code: "AUTH_REQUIRED",
            message: "Требуется вход",
            details: {},
          },
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "UNEXPECTED_TEST_REQUEST",
          message: `${route.request().method()} ${url.pathname}`,
          details: {},
        },
      },
    });
  });

  await page.goto("/stories");

  const main = page.getByRole("main");
  const footer = page.getByRole("contentinfo");
  await expect(page.getByRole("heading", { name: "Вход в Newscast Navigator Web" })).toBeVisible();
  await expect(main).toHaveCount(1);
  await expect(footer).toHaveCount(1);
  await expect(footer).toBeVisible();
  await expect(main.getByRole("contentinfo")).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const mainElement = document.querySelector("main");
    const footerElement = document.querySelector("footer");
    if (!(mainElement instanceof HTMLElement) || !(footerElement instanceof HTMLElement)) {
      throw new Error("Auth main and footer must exist");
    }
    const mainBox = mainElement.getBoundingClientRect();
    const footerBox = footerElement.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      mainBottom: mainBox.bottom,
      mainCenter: mainBox.top + mainBox.height / 2,
      footerTop: footerBox.top,
      footerBottom: footerBox.bottom,
    };
  });

  expect(geometry.footerBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 1);
  expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.mainBottom).toBeLessThanOrEqual(geometry.footerTop);
  expect(Math.abs(geometry.mainCenter - geometry.footerTop / 2)).toBeLessThanOrEqual(
    geometry.viewportHeight * 0.1,
  );

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.filter((violation) => (
    violation.impact === "critical" || violation.impact === "serious"
  ))).toEqual([]);
});
