import { test, expect } from "./fixtures/current-editor";
import type { Page, Route } from "@playwright/test";

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
  title: "Синтетический browser-сценарий с очень длинным названием для проверки автоматического переноса внутри синей шапки без расширения страницы и без изменения ширины таблицы сценария на разных desktop viewport",
  duration_text: "12 минут 30 секунд",
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

async function installSyntheticApi(
  page: Page,
  handleMetadata?: (route: Route) => Promise<void> | void,
) {
  await page.context().addCookies([{ name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/scenario/access")) return route.fallback();
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
    if (
      path === "/api/v1/stories/101/metadata"
      && request.method() === "PATCH"
      && handleMetadata
    ) {
      return handleMetadata(route);
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
  await openSyntheticEditor(page);

  const metadata = page.getByRole("group", { name: "Шапка таблицы сценария" });
  const title = metadata.getByRole("textbox", { name: "Название" });
  const rubric = metadata.getByRole("combobox", { name: "Рубрика" });
  const duration = metadata.getByRole("textbox", { name: "Хронометраж" });
  await expect(metadata).toHaveCSS("background-color", "rgb(190, 220, 230)");
  await expect(title).toHaveValue(syntheticStory.title);
  await expect(duration).toHaveValue("12 минут 30 секунд");
  await expect(rubric.locator("option"))
    .toHaveText(preparedRubrics.map((rubric) => rubric.name));
  const fieldBoxes = await Promise.all([
    title.locator("xpath=..").boundingBox(),
    rubric.locator("xpath=..").boundingBox(),
    duration.locator("xpath=..").boundingBox(),
  ]);
  expect(fieldBoxes.every((box) => box !== null)).toBe(true);
  const fieldBottoms = fieldBoxes.map((box) => box!.y + box!.height);
  expect(Math.max(...fieldBottoms) - Math.min(...fieldBottoms))
    .toBeLessThan(2);
  expect(fieldBoxes[0]!.x).toBeLessThan(fieldBoxes[1]!.x);
  expect(fieldBoxes[1]!.x).toBeLessThan(fieldBoxes[2]!.x);
  const titleHeights = await title.evaluate((element) => ({
    clientHeight: (element as HTMLTextAreaElement).clientHeight,
    scrollHeight: (element as HTMLTextAreaElement).scrollHeight,
    inlineHeight: Number.parseFloat((element as HTMLTextAreaElement).style.height),
  }));
  expect(titleHeights.clientHeight).toBeGreaterThan(38);
  expect(titleHeights.inlineHeight).toBe(titleHeights.scrollHeight);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
  const editorToolbar = page.locator(".editor-toolbar-sticky");
  await expect(page.getByRole("toolbar", { name: "Форматирование" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CaptionPanels" })).toHaveCount(0);
  await page.evaluate(() => {
    const runway = document.createElement("div");
    runway.setAttribute("aria-hidden", "true");
    runway.style.height = `${window.innerHeight}px`;
    document.body.appendChild(runway);
  });

  const appHeaderBox = await page.locator(".app-shell-header").boundingBox();
  const initialToolbarBox = await editorToolbar.boundingBox();
  expect(appHeaderBox).not.toBeNull();
  expect(initialToolbarBox).not.toBeNull();
  const expectedStickyY = appHeaderBox!.y + appHeaderBox!.height + 12;
  const stickyThreshold = initialToolbarBox!.y - expectedStickyY;
  expect(stickyThreshold).toBeGreaterThan(0);

  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), stickyThreshold + 80);
  await expect.poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(stickyThreshold + 40);
  const firstScrollY = await page.evaluate(() => window.scrollY);
  const firstStickyBox = await editorToolbar.boundingBox();
  expect(firstStickyBox).not.toBeNull();
  expect(Math.abs(firstStickyBox!.y - expectedStickyY)).toBeLessThan(2);

  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), firstScrollY + 80);
  await expect.poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(firstScrollY + 40);
  const secondStickyBox = await editorToolbar.boundingBox();
  expect(secondStickyBox).not.toBeNull();
  expect(Math.abs(secondStickyBox!.y - expectedStickyY)).toBeLessThan(2);
  expect(Math.abs(secondStickyBox!.y - firstStickyBox!.y)).toBeLessThan(1);
  await expect(currentEditor.scenarioTable).toBeVisible();
});

test("serializes metadata saves and commits the latest title, rubric and duration", async ({
  page,
}) => {
  const payloads: Array<{
    title?: string;
    rubric_id?: number;
    duration_text?: string | null;
  }> = [];
  const server = {
    title: syntheticStory.title,
    rubricId: syntheticStory.rubric.id,
    durationText: syntheticStory.duration_text as string | null,
  };
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let resolveFirst!: (route: Route) => void;
  const firstSeen = new Promise<Route>((resolve) => {
    resolveFirst = resolve;
  });

  await installSyntheticApi(page, async (route) => {
    const payload = route.request().postDataJSON() as {
      title?: string;
      rubric_id?: number;
      duration_text?: string | null;
    };
    payloads.push(payload);
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    if (payloads.length === 1) {
      resolveFirst(route);
      return;
    }
    if (payload.title !== undefined) server.title = payload.title;
    if (payload.rubric_id !== undefined) server.rubricId = payload.rubric_id;
    if (payload.duration_text !== undefined) server.durationText = payload.duration_text;
    activeRequests -= 1;
    await route.fulfill({
      json: {
        ok: true,
        event_id: null,
        changed_at: "2026-07-12T00:00:00Z",
        resource: { type: "story", id: syntheticStory.id },
      },
    });
  });
  await page.goto("/stories/101/scenario");

  const title = page.getByRole("textbox", { name: "Название" });
  await title.fill("Первый заголовок");
  await title.press("Tab");
  const firstRoute = await firstSeen;
  await title.fill("Последний заголовок");
  await title.press("Tab");
  await page.getByRole("combobox", { name: "Рубрика" }).selectOption("8");
  const duration = page.getByRole("textbox", { name: "Хронометраж" });
  await duration.fill(" 18 минут ");
  await duration.press("Tab");

  // The previous implementation sent both newer requests immediately, so the
  // synthetic server could commit them before the deferred older request.
  await page.waitForTimeout(100);
  expect(payloads).toEqual([{ title: "Первый заголовок" }]);
  expect(maxActiveRequests).toBe(1);

  const firstPayload = firstRoute.request().postDataJSON() as {
    title?: string;
    rubric_id?: number;
    duration_text?: string | null;
  };
  if (firstPayload.title !== undefined) server.title = firstPayload.title;
  if (firstPayload.rubric_id !== undefined) {
    server.rubricId = firstPayload.rubric_id;
  }
  if (firstPayload.duration_text !== undefined) {
    server.durationText = firstPayload.duration_text;
  }
  activeRequests -= 1;
  await firstRoute.fulfill({
    json: {
      ok: true,
      event_id: null,
      changed_at: "2026-07-12T00:00:00Z",
      resource: { type: "story", id: syntheticStory.id },
    },
  });

  await expect.poll(() => payloads).toHaveLength(2);
  expect(payloads).toEqual([
    { title: "Первый заголовок" },
    { title: "Последний заголовок", rubric_id: 8, duration_text: "18 минут" },
  ]);
  expect(server).toEqual({
    title: "Последний заголовок",
    rubricId: 8,
    durationText: "18 минут",
  });
  expect(maxActiveRequests).toBe(1);
  await expect(title).toHaveValue("Последний заголовок");
  await expect(page.getByRole("combobox", { name: "Рубрика" })).toHaveValue("8");
  await expect(duration).toHaveValue("18 минут");
});

test("characterizes duplicate, reorder and delete controls", async ({ page, currentEditor }) => {
  await openSyntheticEditor(page);
  await currentEditor.row(0).getByRole("button", { name: "Дублировать блок" }).click();
  await expect(currentEditor.scenarioTable.locator("tbody tr")).toHaveCount(6);
  await expect(currentEditor.scenarioTable.getByText("Ведущий открывает browser-выпуск")).toHaveCount(2);
  const duplicateEditor = currentEditor.row(1).getByRole("textbox", { name: "Текст блока 2" });
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

test("reorders blocks by the drag handle with one save and keeps keyboard move available", async ({
  page,
  currentEditor,
}) => {
  const saves: unknown[] = [];
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/v1/stories/101/scenario")
      && request.method() === "PUT"
    ) saves.push(request.postDataJSON());
  });
  await openSyntheticEditor(page);

  const sourceHandle = currentEditor.row(0).getByRole("button", { name: "Перетащить блок 1" });
  await sourceHandle.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await currentEditor.row(2).boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height * 0.75,
  );
  await page.mouse.up();

  await expect(currentEditor.row(0)).toContainText("Browser-закадр");
  await expect(currentEditor.row(1)).toContainText("Browser-текст после гео");
  await expect(currentEditor.row(2)).toContainText("Ведущий открывает browser-выпуск");
  await expect.poll(() => saves).toHaveLength(1);
  expect((saves[0] as { rows: Array<{ segment_uid: string }> }).rows.map((row) => row.segment_uid))
    .toEqual(["seg_browser_2", "seg_browser_3", "seg_browser_1", "seg_browser_4", "seg_browser_5"]);

  await currentEditor.row(2).getByRole("button", { name: "Поднять блок вверх" }).click();
  await expect(currentEditor.row(1)).toContainText("Ведущий открывает browser-выпуск");
  await expect(currentEditor.row(2)).toContainText("Browser-текст после гео");
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

  const firstEditor = currentEditor.row(0).getByRole("textbox", { name: "Текст блока 1" });
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

test("finds, navigates and atomically replaces prose without losing sticky geometry", async ({
  page,
  currentEditor,
}) => {
  const saves: Array<{ rows: typeof syntheticRows }> = [];
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/v1/stories/101/scenario")
      && request.method() === "PUT"
    ) saves.push(request.postDataJSON() as { rows: typeof syntheticRows });
  });
  await openSyntheticEditor(page);

  const findButton = page.getByRole("button", { name: "Найти", exact: true });
  const replaceButton = page.getByRole("button", { name: "Найти и заменить" });
  await expect(findButton).toBeVisible();
  await expect(replaceButton).toBeVisible();

  const firstEditor = currentEditor.row(0).getByRole("textbox", { name: "Текст блока 1" });
  await firstEditor.click();
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+f`);
  const search = page.getByRole("search", { name: "Найти и заменить" });
  const query = search.getByRole("searchbox", { name: "Найти" });
  await expect(query).toBeFocused();
  await query.fill("Browser");
  await expect(search.getByRole("status")).toHaveText("1 из 5");
  await expect(page.locator(".scenario-search-highlight")).toHaveCount(5);
  await expect(page.locator(".scenario-search-highlight-active")).toHaveCount(1);

  const ordinaryColor = await page.locator(".scenario-search-highlight").nth(1)
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const activeColor = await page.locator(".scenario-search-highlight-active")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(activeColor).not.toBe(ordinaryColor);

  await search.getByRole("button", { name: "Предыдущее совпадение" }).click();
  await expect(search.getByRole("status")).toHaveText("5 из 5");
  await search.getByRole("button", { name: "Следующее совпадение" }).click();
  await expect(search.getByRole("status")).toHaveText("1 из 5");
  await search.getByRole("button", { name: "Следующее совпадение" }).click();
  await expect(search.getByRole("status")).toHaveText("2 из 5");
  const activeField = page.locator(".scenario-search-highlight-active")
    .locator("xpath=ancestor::*[contains(@class, 'rich-text-field')][1]");
  const toolbar = page.locator(".editor-toolbar-sticky");
  const fieldBox = await activeField.boundingBox();
  const toolbarBox = await toolbar.boundingBox();
  expect(fieldBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  expect(fieldBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height - 1);

  await search.getByRole("checkbox", { name: "Учитывать регистр" }).check();
  await query.fill("browser");
  await expect(search.getByRole("status")).toHaveText("1 из 1");
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(page.locator(".scenario-search-highlight")).toHaveCount(0);
  await expect(firstEditor).toBeFocused();

  await replaceButton.click();
  const replaceSearch = page.getByRole("search", { name: "Найти и заменить" });
  await replaceSearch.getByRole("checkbox", { name: "Учитывать регистр" }).uncheck();
  await replaceSearch.getByRole("searchbox", { name: "Найти" }).fill("Browser");
  await expect(replaceSearch.getByRole("status")).toHaveText("1 из 5");
  await replaceSearch.getByRole("textbox", { name: "Заменить на" }).fill("Эфир");
  await replaceSearch.getByRole("button", { name: "Заменить всё" }).click();

  await expect(currentEditor.row(0)).toContainText("Эфир-выпуск");
  await expect(currentEditor.row(4)).toContainText("Эфир-реплика");
  await expect(currentEditor.row(1).getByRole("textbox", { name: "Имя файла блока 2, файл 1" }))
    .toHaveValue("synthetic-browser.mov");
  await expect.poll(() => saves).toHaveLength(1);
  expect(saves[0].rows.map((savedRow) => savedRow.text)).toEqual([
    "Ведущий открывает Эфир-выпуск",
    "Эфир-закадр",
    "Эфир-текст после гео",
    "Эфир-интершум",
    "Эфир-реплика",
  ]);

  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
  await expect(currentEditor.row(0)).toContainText("browser-выпуск");
  await expect(currentEditor.row(4)).toContainText("Browser-реплика");
});

test("restores the editor focus when pending grant briefly leaves the page body active", async ({
  page,
  currentEditor,
}) => {
  await openSyntheticEditor(page);
  let releaseGrant!: () => void;
  const grantBarrier = new Promise<void>((resolve) => { releaseGrant = resolve; });
  await page.route("**/stories/101/scenario/lease", async (route) => {
    if (route.request().method() === "POST") await grantBarrier;
    return route.fallback();
  });
  const editor = currentEditor.textEditor(0);
  await editor.click();
  await expect(page.locator(".pending-field-input")).toHaveCount(1);
  releaseGrant();
  await expect(page.locator(".pending-field-input")).toHaveCount(0);
  await page.evaluate(() => {
    // A grant can remove the pending field between keyboard focus and the search shortcut.
    (document.activeElement as HTMLElement).blur();
    if (document.activeElement !== document.body) throw new Error("Expected a transient body focus");
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
  });
  const search = page.getByRole("search", { name: "Найти и заменить" });
  await expect(search.getByRole("searchbox", { name: "Найти" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(editor).toBeFocused();

  const findButton = page.getByRole("button", { name: "Найти", exact: true });
  await findButton.click();
  await expect(search.getByRole("searchbox", { name: "Найти" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(findButton).toBeFocused();
});

test("keeps explicit PT Sans while the scenario font changes, with real fonts and quiet acknowledgements", async ({ page, currentEditor }, testInfo) => {
  await openSyntheticEditor(page);
  const first = currentEditor.textEditor(0);
  const second = currentEditor.textEditor(1);
  await first.click();
  const manual = page.getByRole("combobox", { name: "Шрифт для текста блока 1" });
  await expect(manual).toBeEnabled();
  await manual.selectOption("PT Sans");
  await expect(manual).toHaveValue("PT Sans");
  const base = page.getByRole("group", { name: "Шрифт сценария", exact: true }).getByRole("button", { name: "Franklin Gothic Book", exact: true });
  let acknowledge!: () => void;
  const barrier = new Promise<void>((resolve) => { acknowledge = resolve; });
  await page.route("**/api/v1/stories/101/scenario", async (route) => {
    if (route.request().method() !== "PUT" || route.request().postDataJSON().default_font_family !== "Franklin Gothic Book") return route.fallback();
    const payload = route.request().postDataJSON();
    await barrier;
    return route.fulfill({ json: { ok: true, client_save_id: payload.client_save_id, revision: 1, saved_at: "2026-09-15T00:00:00Z" } });
  });
  const request = page.waitForRequest((request) => request.method() === "PUT" && new URL(request.url()).pathname.endsWith("/scenario") && request.postDataJSON().default_font_family === "Franklin Gothic Book");
  await base.click();
  const payload = (await request).postDataJSON();
  expect(payload.rows[0].formatting.targets.text.font_family).toBe("PT Sans");
  expect(payload.rows[1].formatting).toEqual({});
  await expect(first).toHaveCSS("font-family", '"PT Sans", Arial, sans-serif');
  await expect(second).toHaveCSS("font-family", '"Franklin Gothic Book", Arial, sans-serif');
  const session = await page.context().newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const domDocument = await session.send("DOM.getDocument");
  const fontsFor = async (label: string) => {
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: domDocument.root.nodeId, selector: `[aria-label="${label}"][contenteditable]` });
    const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
    return fonts.filter((font) => font.glyphCount > 0).map((font) => font.familyName);
  };
  const platformFonts = {
    explicit: await fontsFor("Текст блока 1"),
    inherited: await fontsFor("Текст блока 2"),
  };
  await testInfo.attach("scenario-platform-fonts", {
    body: Buffer.from(JSON.stringify(platformFonts, null, 2)), contentType: "application/json",
  });
  expect(platformFonts.explicit.length).toBeGreaterThan(0);
  expect(platformFonts.inherited.length).toBeGreaterThan(0);
  const missing = [
    ...(!platformFonts.explicit.includes("PT Sans") ? ["PT Sans"] : []),
    ...(!platformFonts.inherited.includes("Franklin Gothic Book") ? ["Franklin Gothic Book"] : []),
  ];
  if (process.env.REQUIRE_SCENARIO_SYSTEM_FONTS === "1") {
    expect(missing, "System fonts must render real glyphs in the strict font environment").toEqual([]);
  } else if (missing.length) {
    testInfo.annotations.push({ type: "missing-system-font", description: `CDP reports fallback for ${missing.join(", ")}; all functional assertions still run. Use REQUIRE_SCENARIO_SYSTEM_FONTS=1 where these fonts are installed.` });
  }
  await page.evaluate(() => { (window as any).__fontEditorNode = document.querySelector('[aria-label="Текст блока 2"][contenteditable]'); });
  await second.click();
  await second.evaluate((element) => {
    (element as HTMLElement).focus({ preventScroll: true });
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  });
  // Settle the browser's click scroll while the acknowledgement is still blocked.
  await page.waitForTimeout(400);
  const selectionBefore = await second.evaluate(() => { const selection = getSelection(); return [selection?.anchorOffset, selection?.focusOffset, scrollY]; });
  await expect(page.getByRole("group", { name: "Шрифт сценария", exact: true }).getByRole("button", { name: "Franklin Gothic Book", exact: true })).toHaveAttribute("aria-pressed", "true");
  const acknowledged = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname.endsWith("/scenario"));
  acknowledge();
  await acknowledged;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await second.evaluate((node) => node === (window as any).__fontEditorNode)).toBe(true);
  expect(await second.evaluate(() => { const selection = getSelection(); return [selection?.anchorOffset, selection?.focusOffset, scrollY]; })).toEqual(selectionBefore);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(base).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(base).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "Шрифт сценария", exact: true }).getByRole("button", { name: "PT Sans", exact: true }).click();
  await expect(second).toHaveCSS("font-family", '"PT Sans", Arial, sans-serif');
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: testInfo.outputPath("scenario-font.png"), fullPage: true });
  await session.detach();
});
