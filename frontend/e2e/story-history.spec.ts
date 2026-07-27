import { expect, test, type Page } from "@playwright/test";

const user = { id: 2, username: "astra", display_name: "Астра", position: "Начальник", function_codes: ["chief"], is_active: true, must_change_password: false, created_at: "2026-07-12T09:00:00Z" };
const story = { id: 101, title: "Синтетическая история", priority: { code: "standard", label: "Обычный" }, rubric: { id: 7, name: "Тестовая рубрика" }, author: user, situation: { code: "active", label: "В работе" }, assignments: [], created_at: "2026-07-12T09:00:00Z", archived_at: null };
const action = { code: "restore_scenario_session", label: "Восстановить", method: "POST", href: "/api/v1/stories/101/history/edit-sessions/7/restore", emphasis: "danger", confirmation: "Выбранное состояние станет актуальным. Последующая история сохранится.", form: null };
const first = { kind: "edit_session", id: 7, actor: user, started_at: "2026-07-12T10:00:00Z", ended_at: "2026-07-12T10:05:00Z", from_revision: 0, to_revision: 3, diff_summary: { added: 1, removed: 0, changed: 1, moved: 1, total: 2 }, diff_href: "/api/v1/stories/101/history/edit-sessions/7", available_actions: [action] };
const restored = { ...first, id: 8, started_at: "2026-07-12T11:00:00Z", ended_at: "2026-07-12T11:00:00Z", from_revision: 5, to_revision: 6, diff_href: "/api/v1/stories/101/history/edit-sessions/8", available_actions: [{ ...action, href: "/api/v1/stories/101/history/edit-sessions/8/restore" }] };
const older = { ...first, id: 4, started_at: "2026-07-11T08:00:00Z", ended_at: "2026-07-11T08:05:00Z", from_revision: 8, to_revision: 9, diff_href: "/api/v1/stories/101/history/edit-sessions/4", available_actions: [] };

async function installHistoryApi(
  page: Page,
  options: { blockAddressedUntilRetry?: boolean } = {},
): Promise<{ allowAddressed(): void }> {
  let restoredCurrent = false;
  let addressedAllowed = !options.blockAddressedUntilRetry;
  await page.context().addCookies([{ name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: user });
    if (path === "/api/v1/stories/101/history" && request.method() === "GET") return route.fulfill({ json: { story, items: restoredCurrent ? [restored, first] : [first], next_cursor: null } });
    if (path === first.diff_href && request.method() === "GET") return route.fulfill({ json: { story, session: first, changes: [{ segment_uid: "seg_1", kind: "changed", moved: true, changed_fields: ["text"], before: { order_index: 1, block_type: "zk", text: "Исходный текст" }, after: { order_index: 2, block_type: "zk", text: "Итоговая правка" } }] } });
    if (path === older.diff_href && request.method() === "GET") {
      if (!addressedAllowed) {
        return route.fulfill({ status: 503, json: { error: { message: "Сравнение временно недоступно" } } });
      }
      return route.fulfill({ json: { story, session: older, changes: [{ segment_uid: "seg_older", kind: "changed", moved: false, changed_fields: ["text"], before: { order_index: 1, block_type: "zk", text: "Старая адресная редакция" }, after: { order_index: 1, block_type: "zk", text: "Нужная адресная редакция" } }] } });
    }
    if (path === action.href && request.method() === "POST") { restoredCurrent = true; return route.fulfill({ json: { ok: true, event_id: null, changed_at: "2026-07-12T11:00:00Z", resource: { type: "scenario", id: 3 } } }); }
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected API path: ${path}` } } });
  });
  return { allowAddressed: () => { addressedAllowed = true; } };
}

test("history keeps an addressable grouped diff and restore is append-only", async ({ page }) => {
  await installHistoryApi(page);
  await page.goto("/stories/101/history");

  await expect(page.getByRole("heading", { name: story.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "История" })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/\/stories\/101\/history$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: story.title })).toBeVisible();

  await page.getByRole("button", { name: "Показать изменения" }).click();
  await expect(page.getByText("Итоговая правка")).toBeVisible();
  await page.getByRole("button", { name: "Восстановить" }).click();
  const dialog = page.getByRole("dialog", { name: "Восстановить состояние сценария" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/редакци/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Восстановить состояние" }).click();

  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByText(/Редакции\s+\d+\s+→\s+\d+/i)).toHaveCount(0);
});

test("direct history session URL expands an older diff and survives reload", async ({ page }) => {
  const addressedApi = await installHistoryApi(page, { blockAddressedUntilRetry: true });
  await page.goto("/stories/101/history?session=4");

  await expect(page).toHaveURL(/\/stories\/101\/history\?session=4$/);
  await expect(page.getByText(/Редакции\s+\d+\s+→\s+\d+/i)).toHaveCount(0);
  const addressedError = page.getByRole("alert");
  await expect(addressedError).toContainText("Не удалось открыть выбранные изменения");
  await expect(addressedError).toContainText("Сравнение временно недоступно");
  await expect(addressedError).toContainText("Обычная история остаётся доступна");
  addressedApi.allowAddressed();
  await page.getByRole("button", { name: "Повторить открытие изменений" }).click();
  await expect(page.getByText("Нужная адресная редакция")).toBeVisible();
  await expect(page.getByText(/Редакции\s+\d+\s+→\s+\d+/i)).toHaveCount(0);

  await page.reload();

  await expect(page).toHaveURL(/\/stories\/101\/history\?session=4$/);
  await expect(page.getByText("Нужная адресная редакция")).toBeVisible();
  await expect(page.getByText(/Редакции\s+\d+\s+→\s+\d+/i)).toHaveCount(0);
});
