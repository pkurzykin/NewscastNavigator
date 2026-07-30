import { expect, test, type Page } from "@playwright/test";

const user = { id: 2, username: "astra", display_name: "Астра", position: "Начальник", function_codes: ["chief"], is_active: true, must_change_password: false, created_at: "2026-07-12T09:00:00Z" };
const story = { id: 101, title: "Синтетическая история", priority: { code: "standard", label: "Обычный" }, rubric: { id: 7, name: "Тестовая рубрика" }, author: user, situation: { code: "active", label: "В работе" }, assignments: [], created_at: "2026-07-12T09:00:00Z", archived_at: null };
const action = { code: "restore_scenario_session", label: "Восстановить", method: "POST", href: "/api/v1/stories/101/history/edit-sessions/7/restore", emphasis: "danger", confirmation: "Выбранное состояние станет актуальным. Последующая история сохранится.", form: null };
const first = { kind: "edit_session", id: 7, actor: user, started_at: "2026-07-12T10:00:00Z", ended_at: "2026-07-12T10:05:00Z", from_revision: 0, to_revision: 3, diff_summary: { added: 1, removed: 1, changed: 1, moved: 1, total: 3 }, diff_href: "/api/v1/stories/101/history/edit-sessions/7", available_actions: [action] };
const metadataEvent = {
  kind: "workflow_event",
  id: 33,
  event_code: "story_metadata_changed",
  label: "Изменены данные сюжета",
  summary: "Название: «До» → «Синтетическая история»; рубрика: «Новости» → «Тестовая рубрика»",
  actor: user,
  at: "2026-07-12T10:06:00Z",
  diff_href: null,
  available_actions: [],
  payload: { internal: "RAW_HISTORY_PAYLOAD" },
};
const restored = { ...first, id: 8, started_at: "2026-07-12T11:00:00Z", ended_at: "2026-07-12T11:00:00Z", from_revision: 5, to_revision: 6, diff_href: "/api/v1/stories/101/history/edit-sessions/8", available_actions: [{ ...action, href: "/api/v1/stories/101/history/edit-sessions/8/restore" }] };
const older = { ...first, id: 4, started_at: "2026-07-11T08:00:00Z", ended_at: "2026-07-11T08:05:00Z", from_revision: 8, to_revision: 9, diff_href: "/api/v1/stories/101/history/edit-sessions/4", available_actions: [] };
const firstChanges = [
  {
    segment_uid: "seg_changed_geo",
    kind: "changed",
    moved: true,
    changed_fields: ["text", "structured_data", "additional_comment", "rich_text"],
    before: {
      order_index: 1,
      block_type: "zk_geo",
      text: "Старый текст",
      speaker_text: "Скрытое ФИО\nСкрытая должность",
      additional_comment: "Общий план",
      structured_data: {
        geo: "Староград",
        file_bundles: [
          { file_name: "before.mov", tc_in: "00:01", tc_out: "00:05" },
          { file_name: "before-extra.mov", tc_in: "00:06", tc_out: "00:09" },
        ],
      },
      formatting: { targets: { text: { font_family: "PT Sans", fill_color: "#ffffff" } } },
      rich_text: {
        schema_version: 1,
        targets: {
          text: {
            text: "Старый текст",
            html: "<strong>RAW BEFORE</strong>",
            doc: {
              type: "doc",
              content: [{
                type: "paragraph",
                content: [{ type: "text", text: "Старый текст" }],
              }],
            },
          },
        },
      },
    },
    after: {
      order_index: 2,
      block_type: "zk_geo",
      text: "Итоговая правка",
      speaker_text: "Другое скрытое ФИО\nДругая скрытая должность",
      additional_comment: "Крупный план",
      structured_data: {
        geo: "Новоград",
        file_bundles: [
          { file_name: "after.mov", tc_in: "00:10", tc_out: "00:14" },
          { file_name: "after-extra.mov", tc_in: "00:15", tc_out: "00:19" },
        ],
      },
      formatting: { targets: { text: { font_family: "PT Sans", fill_color: "#ffffff" } } },
      rich_text: {
        schema_version: 1,
        targets: {
          text: {
            text: "Итоговая правка",
            html: "<span style='position:fixed'>RAW AFTER</span>",
            doc: {
              type: "doc",
              content: [{
                type: "paragraph",
                content: [
                  { type: "text", text: "Итоговая " },
                  {
                    type: "text",
                    text: "правка",
                    marks: [
                      { type: "bold" },
                      { type: "italic" },
                      { type: "strike" },
                      { type: "textStyle", attrs: { fontFamily: "Arial" } },
                      { type: "highlight", attrs: { color: "#ffff00" } },
                    ],
                  },
                ],
              }],
            },
          },
        },
      },
    },
  },
  {
    segment_uid: "seg_added_snh",
    kind: "added",
    moved: false,
    changed_fields: [],
    before: null,
    after: {
      order_index: 3,
      block_type: "snh",
      text: "Синхрон",
      speaker_text: "Марина\nЭксперт лаборатории",
      additional_comment: "Средний план",
      structured_data: { geo: "Скрытое гео" },
    },
  },
  {
    segment_uid: "seg_removed_life",
    kind: "removed",
    moved: false,
    changed_fields: [],
    before: {
      order_index: 4,
      block_type: "life",
      text: "Удалённый лайф",
      additional_comment: "Архивный кадр",
    },
    after: null,
  },
];

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
    if (path === "/api/v1/stories/101/history" && request.method() === "GET") return route.fulfill({ json: { story, items: restoredCurrent ? [restored, metadataEvent, first] : [metadataEvent, first], next_cursor: null } });
    if (path === first.diff_href && request.method() === "GET") {
      return route.fulfill({ json: { story, session: first, changes: firstChanges } });
    }
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
  await expect(page.getByRole("heading", { name: metadataEvent.label })).toBeVisible();
  await expect(page.getByText(metadataEvent.summary)).toBeVisible();
  await expect(page.getByText(metadataEvent.event_code)).toHaveCount(0);
  await expect(page.getByText("RAW_HISTORY_PAYLOAD")).toHaveCount(0);

  await page.getByRole("button", { name: "Показать изменения" }).click();
  await expect(page.getByText("Итоговая правка")).toBeVisible();
  await expect(page.getByText("Староград")).toBeVisible();
  await expect(page.getByText("Новоград")).toBeVisible();
  await expect(page.getByText("Марина")).toBeVisible();
  await expect(page.getByText("Эксперт лаборатории")).toBeVisible();
  await expect(page.getByText("before.mov · 00:01–00:05\nbefore-extra.mov · 00:06–00:09")).toBeVisible();
  await expect(page.getByText("after.mov · 00:10–00:14\nafter-extra.mov · 00:15–00:19")).toBeVisible();
  await expect(page.getByText("Общий план")).toBeVisible();
  await expect(page.getByText("Крупный план")).toBeVisible();
  await expect(page.getByText("Строка: 1 → 2")).toBeVisible();
  await expect(page.getByText("Добавлен блок · строка 3")).toBeVisible();
  await expect(page.getByText("Удалён блок · строка 4")).toBeVisible();
  await expect(page.getByText("Удалённый лайф")).toBeVisible();
  const formattedRun = page.getByText("правка", { exact: true });
  await expect(formattedRun).toBeVisible();
  const computedFormatting = await formattedRun.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      textDecorationLine: style.textDecorationLine,
      backgroundColor: style.backgroundColor,
    };
  });
  expect(computedFormatting.fontFamily).toContain("Arial");
  expect(Number(computedFormatting.fontWeight)).toBeGreaterThanOrEqual(700);
  expect(computedFormatting.fontStyle).toBe("italic");
  expect(computedFormatting.textDecorationLine).toContain("line-through");
  expect(computedFormatting.backgroundColor).toBe("rgb(255, 255, 0)");
  await expect(page.getByText(/Скрытое ФИО|Скрытая должность|Скрытое гео/)).toHaveCount(0);
  await expect(page.getByText(/RAW BEFORE|RAW AFTER/)).toHaveCount(0);
  await expect(page.getByText("Сохранённые состояния 0 → 3")).toBeVisible();
  await expect(page.getByText(/structured_data|schema_version|targets/i)).toHaveCount(0);
  await expect(page.getByText(/Редакции 0 → 3/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Восстановить" }).click();
  const dialog = page.getByRole("dialog", { name: "Восстановить состояние сценария" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/редакци/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Восстановить состояние" }).click();

  await expect(page.getByRole("article")).toHaveCount(3);
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
