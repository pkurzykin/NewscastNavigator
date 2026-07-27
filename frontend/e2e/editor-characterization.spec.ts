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
const preparedRubrics = [
  { id: 1, name: "Новости" },
  { id: 2, name: "Специальный репортаж" },
  { id: 3, name: "Транснефть помогает" },
  { id: 4, name: "Волонтеры Транснефти" },
  { id: 5, name: "Люди компании" },
  { id: 6, name: "Новость дня" },
  { id: 7, name: "Оптимум" },
  { id: 8, name: "Спорт" },
];
const syntheticWorkflow = {
  story_id: syntheticStory.id,
  review_request: null,
  editorial_check: null,
  proofread: null,
  changed_after_proofread: false,
  reproofread_request: null,
  primary_action: null,
  additional_actions: [],
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
    if (path === "/api/v1/me/actions") return route.fulfill({ json: { items: [], total: 0 } });
    if (path === "/api/v1/notifications") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/stories/101") return route.fulfill({ json: syntheticStory });
    if (path === "/api/v1/stories/101/workflow") return route.fulfill({ json: syntheticWorkflow });
    if (path === "/api/v1/stories/101/scenario" && request.method() === "GET") return route.fulfill({
      json: {
        story: syntheticStory,
        scenario: { revision: 0, rows: syntheticRows },
        edit: { state: "available" },
        metadata: { editable: true, rubrics: preparedRubrics },
        captionpanels: {
          eligible: true,
          last_opened_revision: null,
          changed_since_last_open: false,
          diff_session_id: null,
        },
      },
    });
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "POST") return route.fulfill({ json: { edit_session_id: 5, lease_token: "lease", expires_at: "2099-07-15T00:01:30Z", revision: 0 } });
    if (path === "/api/v1/stories/101/scenario" && request.method() === "PUT") {
      const payload = request.postDataJSON();
      return route.fulfill({ json: { ok: true, client_save_id: payload.client_save_id, revision: 1, saved_at: "2026-07-12T00:00:00Z" } });
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
  expect(await currentEditor.scenarioTable.locator('select[aria-label^="Тип блока "]').evaluateAll(
    (items) => items.map((item) => (item as HTMLSelectElement).value),
  )).toEqual(["podvodka", "zk", "zk_geo", "life", "snh"]);
  await expect(currentEditor.row(0).locator("strong")).toContainText("Ведущий");
  await expect(currentEditor.row(2)).toContainText("Тестоград");
  await expect(currentEditor.row(4)).toContainText("Тестов Тест");
  await expect(currentEditor.row(4)).toContainText("Эксперт лаборатории");
  await expect(currentEditor.row(1).locator('input[value="synthetic-browser.mov"]')).toBeVisible();
  await expect(currentEditor.row(1).locator('input[value="00:01"]')).toBeVisible();
  await expect(currentEditor.row(1).locator('input[value="00:08"]')).toBeVisible();
});

test("keeps the blue table header and formatting tools under the sticky app header", async ({
  page,
  currentEditor,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSyntheticEditor(page);

  const metadata = page.getByRole("group", { name: "Шапка таблицы сценария" });
  await expect(metadata).toHaveCSS("background-color", "rgb(190, 220, 230)");
  await expect(metadata.getByRole("combobox", { name: "Рубрика" }).locator("option"))
    .toHaveText(preparedRubrics.map((rubric) => rubric.name));
  await expect(page.getByRole("toolbar", { name: "Форматирование" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CaptionPanels" })).toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, 700));
  const appHeaderBox = await page.locator(".app-shell-header").boundingBox();
  const editorToolbarBox = await page.locator(".editor-toolbar-sticky").boundingBox();
  expect(appHeaderBox).not.toBeNull();
  expect(editorToolbarBox).not.toBeNull();
  expect(editorToolbarBox!.y).toBeGreaterThanOrEqual(appHeaderBox!.y + appHeaderBox!.height + 8);
  await expect(currentEditor.scenarioTable).toBeVisible();
});

test("characterizes duplicate, reorder and delete controls", async ({ page, currentEditor }) => {
  await openSyntheticEditor(page);
  await currentEditor.row(0).getByRole("button", { name: "Дублировать блок" }).click();
  await expect(currentEditor.scenarioTable.locator("tbody tr")).toHaveCount(6);
  await expect(currentEditor.scenarioTable.getByText("Ведущий открывает browser-выпуск")).toHaveCount(2);
  const duplicateEditor = currentEditor.textEditor(1);
  await expect(duplicateEditor).toBeFocused();
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

test("characterizes the established toolbar, selection, resize and file bundle contract", async ({
  page,
  currentEditor,
}) => {
  await openSyntheticEditor(page);
  await expect(currentEditor.scenarioTable).toBeVisible();
  await expect(currentEditor.scenarioTable.getByRole("columnheader")).toHaveText([
    "№",
    "Блок",
    "Текст",
    "Имя файла / TC",
    "В кадре",
  ]);

  const firstEditor = currentEditor.textEditor(0);
  await firstEditor.click();
  const toolbar = page.getByRole("toolbar", { name: "Форматирование" });
  await expect(toolbar).toHaveCount(1);
  await expect(toolbar).toContainText("Строка 1: текста");

  await firstEditor.selectText();
  await toolbar.getByRole("button", { name: "Зачеркнуть для текста блока 1" }).click();
  await expect(firstEditor.locator("s")).toHaveCount(2);
  expect((await firstEditor.locator("s").allTextContents()).join("")).toBe(
    "Ведущий открывает browser-выпуск",
  );
  await firstEditor.press("ArrowRight");

  await currentEditor.row(1).locator(".editor-order-cell").click({
    modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
  });
  await expect(currentEditor.scenarioTable.locator("tr.selected-row")).toHaveCount(2);
  await toolbar.getByRole("button", { name: "Курсив для текста блока 1" }).click();
  await expect(currentEditor.row(0).locator(".editor-core-field").first()).toHaveCSS(
    "font-style",
    "italic",
  );
  await expect(currentEditor.row(1).locator(".editor-core-field").first()).toHaveCSS(
    "font-style",
    "italic",
  );

  const textResizer = page.getByRole("button", { name: "Изменить ширину столбца Текст" });
  const resizerBox = await textResizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  await page.mouse.move(resizerBox!.x + resizerBox!.width / 2, resizerBox!.y + 8);
  await page.mouse.down();
  await page.mouse.move(resizerBox!.x + resizerBox!.width / 2 + 48, resizerBox!.y + 8);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(
    localStorage.getItem("newscast-editor-column-widths-v3") || "{}",
  ).text)).toBe(588);

  const secondRow = currentEditor.row(1);
  await secondRow.getByRole("textbox", { name: "Добавить файл блока 2" }).fill("+");
  const copiedFile = secondRow.getByRole("textbox", {
    name: "Имя файла блока 2, файл 2",
  });
  await expect(copiedFile).toBeFocused();
  await expect(copiedFile).toHaveValue("+");
  const copiedTcIn = secondRow.getByRole("textbox", { name: "TC IN блока 2, файл 2" });
  await copiedTcIn.fill("1234");
  await copiedTcIn.press("Tab");
  await expect(copiedTcIn).toHaveValue("12:34");

  await secondRow.getByRole("combobox", { name: "Тип блока 2" }).selectOption("zk_geo");
  await expect(secondRow.getByRole("textbox", { name: "Гео блока 2" })).toBeFocused();
  await expect(secondRow.getByRole("textbox", { name: "Текст блока 2" })).toContainText(
    "Browser-закадр",
  );
  await expect(secondRow.locator(".structured-editor-line-emphasis")).toHaveCount(0);
  await expect(secondRow.locator(".structured-editor-line").first()).toHaveCSS(
    "padding-top",
    "3px",
  );
});
