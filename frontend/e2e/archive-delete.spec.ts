import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const technical of [false, true]) {
  test(`archive deletion ${technical ? "denied technical mix" : "confirmation and refresh retry"}`, async ({ page }, testInfo) => {
    const user = { id: 1, username: "astra", display_name: "Астра", position: "Начальник",
      function_codes: technical ? ["chief", "designer"] : ["chief"], is_active: true,
      must_change_password: false, created_at: "2026-09-01T10:00:00Z" };
    const restore = { code: "story_restore", label: "Вернуть в работу", method: "POST",
      href: "/api/v1/stories/101/restore", emphasis: "primary", confirmation: null, form: null };
    const story = { id: 101, title: "Открытие городского парка", duration_text: null,
      priority: { code: "standard", label: "Стандарт" }, rubric: { id: 1, name: "Город" },
      author: { ...user, display_name: "Лира", position: "Корреспондент" },
      situation: { code: "archive", label: "В архиве" }, management: null, assignments: [],
      created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-02T10:00:00Z",
      archived_at: "2026-09-03T10:00:00Z", lifecycle_actions: [restore],
      delete_action: technical ? null : { ...restore, code: "story_delete", label: "Удалить", method: "DELETE",
        href: "/api/v1/stories/101", emphasis: "danger",
        confirmation: "Сюжет и вся его история будут удалены без возможности восстановления." },
    };
    let deleted = false;
    let commands = 0;
    let failRefresh = true;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/v1/auth/me") return route.fulfill({ json: user });
      if (path === "/api/v1/notifications") return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
      if (path === "/api/v1/stories" && request.method() === "GET") {
        if (deleted && failRefresh) {
          failRefresh = false;
          return route.fulfill({ status: 503, json: { error: { code: "SYNTHETIC_OFFLINE", message: "Не удалось обновить архив" } } });
        }
        return route.fulfill({ json: { items: deleted ? [] : [story], total: deleted ? 0 : 1 } });
      }
      if (path === "/api/v1/stories/101" && request.method() === "DELETE") {
        commands += 1; deleted = true;
        return route.fulfill({ json: { ok: true, event_id: null, changed_at: "2026-09-15T10:00:00Z", resource: { type: "story", id: 101 } } });
      }
      throw new Error(`Unexpected archive request: ${request.method()} ${path}`);
    });
    await page.goto("/archive");
    const table = page.getByRole("table", { name: "Архив сюжетов" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["Название", "Рубрика", "Автор", "Исполнители", "В архиве с", "Действия"]);
    await expect(page.getByRole("button", { name: "Вернуть в работу: Открытие городского парка" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const trigger = page.getByRole("button", { name: "Удалить: Открытие городского парка" });
    if (technical) {
      await expect(trigger).toHaveCount(0);
      return;
    }
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Удалить сюжет?" });
    await expect(dialog.getByRole("button", { name: "Отмена" })).toBeFocused();
    await expect(dialog.getByText("Открытие городского парка", { exact: true })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: `../output/implementation/task6-archive-${testInfo.project.use.viewport?.width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(commands).toBe(0);
    await trigger.click();
    await dialog.getByRole("button", { name: "Удалить навсегда" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("Не удалось обновить архив");
    await expect(page.getByRole("heading", { name: "Архив", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Повторить обновление" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Показано 0 из 0")).toBeVisible();
    expect(commands).toBe(1);
    expect(errors).toEqual([]);
  });
}
