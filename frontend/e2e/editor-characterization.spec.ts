import { test, expect } from "./fixtures/current-editor";
import type { Page } from "@playwright/test";

const syntheticUser = {
  id: 1,
  username: "synthetic_author",
  display_name: "Тест",
  position: "Корреспондент",
  function_codes: ["author"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-11T00:00:00Z",
};

const syntheticStory = {
  id: 101,
  title: "Синтетический browser-сценарий",
  priority: { code: "standard", label: "Стандарт" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author: syntheticUser,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: "2026-07-11T00:00:00Z",
  archived_at: null,
};

function row(id: number, blockType: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    segment_uid: `seg_browser_${id}`,
    order_index: id,
    block_type: blockType,
    text,
    speaker_text: "",
    file_name: "",
    tc_in: "",
    tc_out: "",
    additional_comment: "",
    structured_data: {},
    formatting: {},
    rich_text: { schema_version: 1, targets: { text: { editor: "tiptap", text, html: text } } },
    ...extra,
  };
}

const syntheticRows = [
  row(1, "podvodka", "Ведущий открывает browser-выпуск", { rich_text: { schema_version: 1, targets: { text: { editor: "tiptap", text: "Ведущий открывает browser-выпуск", html: "<strong>Ведущий</strong> открывает browser-выпуск" } } } }),
  row(2, "zk", "Browser-закадр", { file_name: "synthetic-browser.mov", tc_in: "00:01", tc_out: "00:08", structured_data: { file_bundles: [{ file_name: "synthetic-browser.mov", tc_in: "00:01", tc_out: "00:08" }] } }),
  row(3, "zk_geo", "Browser-текст после гео", { structured_data: { geo: "Тестоград", text_lines: ["Browser-текст после гео"] }, rich_text: { schema_version: 1, targets: { geo: { editor: "tiptap", text: "Тестоград", html: "<em>Тестоград</em>" }, text: { editor: "tiptap", text: "Browser-текст после гео", html: "Browser-текст после гео" } } } }),
  row(4, "life", "Browser-интершум"),
  row(5, "snh", "Browser-реплика", { speaker_text: "Тестов Тест\nЭксперт лаборатории", rich_text: { schema_version: 1, targets: { speaker_fio: { editor: "tiptap", text: "Тестов Тест", html: "Тестов Тест" }, speaker_position: { editor: "tiptap", text: "Эксперт лаборатории", html: "Эксперт лаборатории" }, text: { editor: "tiptap", text: "Browser-реплика", html: "Browser-реплика" } } } }),
];

async function installSyntheticApi(page: Page) {
  await page.context().addCookies([{ name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: syntheticUser });
    if (path === "/api/v1/stories/101") return route.fulfill({ json: syntheticStory });
    if (path === "/api/v1/stories/101/editor" && request.method() === "GET") return route.fulfill({ json: { story: syntheticStory, elements: syntheticRows } });
    if (path === "/api/v1/stories/101/editor" && request.method() === "PUT") {
      const rows = request.postDataJSON().rows;
      return route.fulfill({ json: { ok: true, message: "Таблица сценария сохранена", updated: rows.length, inserted: 0, removed: 0, total: rows.length, story: syntheticStory, elements: rows } });
    }
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected synthetic route: ${request.method()} ${path}` } } });
  });
}

async function openSyntheticEditor(page: Page) {
  await installSyntheticApi(page);
  await page.goto("/stories/101/scenario");
}

test("characterizes all five current block types and structured editor fields", async ({ page, currentEditor }) => {
  await openSyntheticEditor(page);
  await expect(currentEditor.scenarioTable).toBeVisible();
  await expect(currentEditor.scenarioTable.locator("tbody tr")).toHaveCount(5);
  expect(await currentEditor.scenarioTable.locator("select").evaluateAll((items) => items.map((item) => (item as HTMLSelectElement).value))).toEqual(["podvodka", "zk", "zk_geo", "life", "snh"]);
  await expect(currentEditor.row(0).locator("strong")).toContainText("Ведущий");
  await expect(currentEditor.row(2)).toContainText("Тестоград");
  await expect(currentEditor.row(4)).toContainText("Тестов Тест");
  await expect(currentEditor.row(4)).toContainText("Эксперт лаборатории");
  await expect(currentEditor.row(1).locator('input[value="synthetic-browser.mov"]')).toBeVisible();
  await expect(currentEditor.row(1).locator('input[value="00:01"]')).toBeVisible();
  await expect(currentEditor.row(1).locator('input[value="00:08"]')).toBeVisible();
});

test("characterizes duplicate, reorder and delete controls", async ({ page, currentEditor }) => {
  await openSyntheticEditor(page);
  await currentEditor.row(0).getByRole("button", { name: "Дублировать блок" }).click();
  await expect(currentEditor.scenarioTable.locator("tbody tr")).toHaveCount(6);
  await expect(currentEditor.scenarioTable.getByText("Ведущий открывает browser-выпуск")).toHaveCount(2);
  const duplicateEditor = currentEditor.textEditor(1);
  await duplicateEditor.click();
  await duplicateEditor.press("End");
  await duplicateEditor.type(" — копия");
  await expect(currentEditor.row(1)).toContainText("Ведущий открывает browser-выпуск — копия");
  await currentEditor.row(0).getByRole("button", { name: "Опустить блок вниз" }).click();
  await expect(currentEditor.row(0)).toContainText("Ведущий открывает browser-выпуск — копия");
  await expect(currentEditor.row(1)).toContainText("Ведущий открывает browser-выпуск");
  await expect(currentEditor.row(1)).not.toContainText("— копия");
  const lifeRow = currentEditor.scenarioTable.locator("tbody tr").filter({ hasText: "Browser-интершум" });
  await lifeRow.getByRole("button", { name: "Удалить блок" }).click();
  await expect(currentEditor.scenarioTable.getByText("Browser-интершум")).toHaveCount(0);
});
