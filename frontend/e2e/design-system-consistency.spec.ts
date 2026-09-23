import { expect, test } from "@playwright/test";

import { installUxScenario } from "./fixtures/ux-scenarios";

test("the shared design system owns ordinary controls and overlays", async ({ page }, testInfo) => {
  await installUxScenario(page, "quiet");
  await page.goto("/stories");
  await expect(page.getByRole("table", { name: "Общий список сюжетов" })).toBeVisible();

  const visibleControlViolations = await page.locator("button, input, select, textarea").evaluateAll((controls) => (
    controls
      .filter((control) => {
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      })
      .filter((control) => {
        if (control instanceof HTMLButtonElement) return !control.classList.contains("MuiButtonBase-root");
        if (control.classList.contains("MuiSelect-nativeInput") && control.getAttribute("aria-hidden") === "true") {
          return false;
        }
        return !control.classList.contains("MuiInputBase-input")
          && !control.classList.contains("PrivateSwitchBase-input");
      })
      .map((control) => `${control.tagName.toLowerCase()}.${control.className}`)
  ));
  expect(visibleControlViolations).toEqual([]);

  const createTrigger = page.getByRole("button", { name: "Создать сюжет" });
  await createTrigger.click();
  const createDialog = page.getByRole("dialog", { name: "Новый сюжет" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog).toHaveClass(/MuiDialog-paper/);
  await expect(createDialog.locator("select:visible")).toHaveCount(0);
  await expect(createDialog.getByRole("combobox")).toHaveCount(3);
  await expect(createDialog.locator(".MuiTextField-root")).toHaveCount(1);
  for (const control of await createDialog.getByRole("combobox").all()) {
    await expect(control.locator("xpath=ancestor::*[contains(@class, 'MuiInputBase-root')][1]")).toHaveCount(1);
  }

  await createDialog.getByRole("button", { name: "Отмена" }).click();
  await expect(createDialog).toHaveCount(0);
  await expect(createTrigger).toBeFocused();

  const notificationsTrigger = page.getByRole("button", { name: /Уведомления, непрочитанных/ });
  await notificationsTrigger.click();
  const tray = page.getByRole("region", { name: "Уведомления" });
  await expect(tray).toBeVisible();
  await expect(tray).toHaveClass(/MuiPopover-paper/);
  await page.keyboard.press("Escape");
  await expect(tray).toHaveCount(0);
  await expect(notificationsTrigger).toBeFocused();

  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ));
  expect(overflow).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath(`design-system-stories-${testInfo.project.name}.png`),
    fullPage: false,
  });
});
