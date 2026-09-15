import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/current-editor";

const syntheticUser = {
  id: 1,
  username: "synthetic_author",
  display_name: "Тест",
  position: "Корреспондент",
  function_codes: ["author"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-09-14T00:00:00Z",
};

const syntheticStory = {
  id: 101,
  title: "Типографика сценария",
  duration_text: "01:30",
  priority: { code: "standard", label: "Стандарт" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author: syntheticUser,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: "2026-09-14T00:00:00Z",
  archived_at: null,
};

const syntheticWorkflow = {
  story_id: 101,
  review_request: null,
  editorial_check: null,
  proofread: null,
  changed_after_proofread: false,
  reproofread_request: null,
  primary_action: null,
  additional_actions: [],
};

function row(
  id: number,
  blockType: "podvodka" | "zk_geo" | "snh",
  text: string,
  extra: Record<string, unknown> = {},
) {
  return {
    segment_uid: `seg_typography_${id}`,
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
    rich_text: {
      schema_version: 1,
      targets: {
        text: { editor: "tiptap", text, html: text },
      },
    },
    ...extra,
  };
}

function initialRows() {
  return [
    row(1, "podvodka", "Марка", {
      additional_comment: "Камера",
      rich_text: {
        schema_version: 1,
        targets: {
          text: {
            editor: "tiptap",
            text: "Марка",
            html: "<strong><em>Марка</em></strong>",
          },
          additional_comment: { editor: "tiptap", text: "Камера", html: "Камера" },
        },
      },
    }),
    row(2, "zk_geo", "Текст гео", {
      file_name: "synthetic.mov",
      tc_in: "00:01",
      tc_out: "00:05",
      structured_data: {
        geo: "Тестоград",
        text_lines: ["Текст гео"],
        file_bundles: [{ file_name: "synthetic.mov", tc_in: "00:01", tc_out: "00:05" }],
      },
      rich_text: {
        schema_version: 1,
        targets: {
          geo: { editor: "tiptap", text: "Тестоград", html: "Тестоград" },
          text: { editor: "tiptap", text: "Текст гео", html: "Текст гео" },
        },
      },
    }),
    row(3, "snh", "Реплика", {
      speaker_text: "Тестов Тест\nЭксперт",
      rich_text: {
        schema_version: 1,
        targets: {
          speaker_fio: { editor: "tiptap", text: "Тестов Тест", html: "Тестов Тест" },
          speaker_position: { editor: "tiptap", text: "Эксперт", html: "Эксперт" },
          text: { editor: "tiptap", text: "Реплика", html: "Реплика" },
        },
      },
    }),
  ];
}

async function installSyntheticApi(page: Page) {
  let revision = 0;
  let rows = initialRows();
  await page.context().addCookies([{
    name: "newscast_session",
    value: "synthetic-session",
    url: "http://127.0.0.1:5173",
  }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/scenario/access")) return route.fallback();
    if (path === "/api/v1/auth/me") return route.fulfill({ json: syntheticUser });
    if (path === "/api/v1/me/actions") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/v1/notifications") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/stories/101") return route.fulfill({ json: syntheticStory });
    if (path === "/api/v1/stories/101/workflow") {
      return route.fulfill({ json: syntheticWorkflow });
    }
    if (path === "/api/v1/stories/101/scenario" && request.method() === "GET") {
      return route.fulfill({
        json: {
          story: syntheticStory,
          scenario: { revision, rows },
          edit: { state: "available" },
          metadata: { editable: true, rubrics: [syntheticStory.rubric] },
          captionpanels: {
            eligible: true,
            last_opened_revision: null,
            changed_since_last_open: false,
            diff_session_id: null,
          },
        },
      });
    }
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "POST") {
      return route.fulfill({
        json: {
          edit_session_id: 5,
          lease_token: "synthetic-lease",
          expires_at: "2099-09-14T00:01:30Z",
          revision,
        },
      });
    }
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "DELETE") {
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/v1/stories/101/scenario" && request.method() === "PUT") {
      const payload = request.postDataJSON() as {
        client_save_id: string;
        rows: ReturnType<typeof initialRows>;
      };
      rows = structuredClone(payload.rows);
      revision += 1;
      return route.fulfill({
        json: {
          ok: true,
          client_save_id: payload.client_save_id,
          revision,
          saved_at: "2026-09-14T00:00:00Z",
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { message: `Unexpected synthetic route: ${request.method()} ${path}` } },
    });
  });
  return { rows: () => rows };
}

async function dispatchKey(
  field: Locator,
  init: { code: string; key: string; altKey?: boolean; shiftKey?: boolean },
) {
  return field.evaluate((element, eventInit) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...eventInit,
    });
    const dispatchResult = element.dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented, dispatchResult };
  }, init);
}

async function typeSyntheticRuShiftDigit2(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    modifiers: 8,
    key: '"',
    code: "Digit2",
    text: '"',
    windowsVirtualKeyCode: 50,
    nativeVirtualKeyCode: 50,
  });
  await session.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 8,
    key: '"',
    code: "Digit2",
    windowsVirtualKeyCode: 50,
    nativeVirtualKeyCode: 50,
  });
  await session.detach();
}

async function moveCaretToEnd(field: Locator) {
  await field.focus();
  await field.press("End");
}

test("handles approved typography keys once in every scenario prose field", async ({
  page,
  currentEditor,
}) => {
  const server = await installSyntheticApi(page);
  await page.goto("/stories/101/scenario");

  const main = currentEditor.row(0).getByRole("textbox", { name: "Текст блока 1" });
  const geo = currentEditor.row(1).getByRole("textbox", { name: "Гео блока 2" });
  const fio = currentEditor.row(2).getByRole("textbox", { name: "ФИО блока 3" });
  const position = currentEditor.row(2).getByRole("textbox", { name: "Должность блока 3" });
  const onCamera = currentEditor.row(0).getByRole("textbox", { name: "В кадре 1" });

  for (const [field, event] of [
    [main, { code: "NumpadSubtract", key: "-" }],
    [geo, { code: "Minus", key: "-", altKey: true }],
    [fio, { code: "NumpadSubtract", key: "-" }],
    [position, { code: "Minus", key: "-", altKey: true }],
    [onCamera, { code: "NumpadSubtract", key: "-" }],
  ] as const) {
    await moveCaretToEnd(field);
    expect(await dispatchKey(field, event)).toEqual({
      defaultPrevented: true,
      dispatchResult: false,
    });
    await expect(field).toContainText("–");
    expect((await field.textContent())?.endsWith("–")).toBe(true);
  }

  await expect(main.locator("strong em")).toHaveText("Марка–");
  await moveCaretToEnd(geo);
  expect(await dispatchKey(geo, { code: "Digit2", key: '"', shiftKey: true })).toEqual({
    defaultPrevented: false,
    dispatchResult: true,
  });
  await typeSyntheticRuShiftDigit2(page);
  await expect(geo).toContainText("Тестоград–«»");

  await moveCaretToEnd(main);
  await main.press("-");
  await main.press("_");
  await main.press("'");
  await page.keyboard.insertText("Ээ@");
  expect(await dispatchKey(main, { code: "Quote", key: '"', shiftKey: true })).toEqual({
    defaultPrevented: true,
    dispatchResult: false,
  });
  await expect(main).toContainText('Марка–-_\'Ээ@"');
  expect((await main.textContent())?.endsWith('"')).toBe(true);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), ' "x" - – —');
  await main.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
  await expect(main).toContainText('Марка–-_\'Ээ@" "x" - – —');

  const title = page.getByRole("textbox", { name: "Название" });
  const fileName = currentEditor.row(1).getByRole("textbox", {
    name: "Имя файла блока 2, файл 1",
  });
  const timecode = currentEditor.row(1).getByRole("textbox", {
    name: "TC IN блока 2, файл 1",
  });
  for (const input of [title, fileName, timecode]) {
    expect(await dispatchKey(input, { code: "NumpadSubtract", key: "-" })).toEqual({
      defaultPrevented: false,
      dispatchResult: true,
    });
  }

  await moveCaretToEnd(onCamera);
  expect(await dispatchKey(onCamera, { code: "NumpadSubtract", key: "-" })).toEqual({
    defaultPrevented: true,
    dispatchResult: false,
  });
  await expect(onCamera).toContainText("Камера––");
  await onCamera.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(onCamera).toContainText("Камера–");
  await onCamera.press(process.platform === "darwin" ? "Shift+Meta+z" : "Control+y");
  await expect(onCamera).toContainText("Камера––");

  await expect.poll(() => server.rows()[0].text).toBe('Марка–-_\'Ээ@" "x" - – —');
  await expect.poll(() => (
    server.rows()[1].structured_data as { geo?: string }
  ).geo).toBe("Тестоград–«»");
  await expect.poll(() => server.rows()[2].speaker_text).toBe("Тестов Тест–\nЭксперт–");
  await expect.poll(() => server.rows()[0].additional_comment).toBe("Камера––");

  await page.reload();
  await expect(currentEditor.row(0).getByRole("textbox", { name: "Текст блока 1" }))
    .toContainText('Марка–-_\'Ээ@" "x" - – —');
  await expect(currentEditor.row(1).getByRole("textbox", { name: "Гео блока 2" }))
    .toContainText("Тестоград–«»");
  await expect(currentEditor.row(2).getByRole("textbox", { name: "ФИО блока 3" }))
    .toContainText("Тестов Тест–");
  await expect(currentEditor.row(0).getByRole("textbox", { name: "В кадре 1" }))
    .toContainText("Камера––");
});

test("renders the GEO default and retains an explicit bold override after reload", async ({
  page,
  currentEditor,
}) => {
  const server = await installSyntheticApi(page);
  await page.goto("/stories/101/scenario");

  let geo = currentEditor.row(1).getByRole("textbox", { name: "Гео блока 2" });
  await expect(geo.locator("xpath=..")).toHaveCSS("font-weight", "700");
  await expect(geo.locator("xpath=..")).toHaveCSS("font-style", "italic");
  await expect(geo.locator("xpath=..")).toHaveCSS("text-decoration-line", "none");

  await geo.click();
  const toolbar = page.getByRole("toolbar", { name: "Форматирование" });
  const bold = toolbar.getByRole("button", { name: "Жирный для гео блока 2" });
  const italic = toolbar.getByRole("button", { name: "Курсив для гео блока 2" });
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(italic).toHaveAttribute("aria-pressed", "true");

  await bold.click();
  await expect.poll(() => (
    server.rows()[1].formatting as { targets?: { geo?: { bold?: boolean } } }
  ).targets?.geo?.bold).toBe(false);

  await page.reload();
  geo = currentEditor.row(1).getByRole("textbox", { name: "Гео блока 2" });
  await expect(geo.locator("xpath=..")).toHaveCSS("font-weight", "400");
  await expect(geo.locator("xpath=..")).toHaveCSS("font-style", "italic");
  await geo.click();
  await expect(toolbar.getByRole("button", { name: "Жирный для гео блока 2" }))
    .toHaveAttribute("aria-pressed", "false");
  await expect(toolbar.getByRole("button", { name: "Курсив для гео блока 2" }))
    .toHaveAttribute("aria-pressed", "true");
});

test("approved editor keeps compact controls and the blue table header in view", async ({ page }, testInfo) => {
  await installSyntheticApi(page);
  await page.goto("/stories/101/scenario");
  await expect(page.getByText("Просмотр сценария", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Редактирование сценария" }).click();
  await expect(page.getByText("Вы редактируете сценарий", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: syntheticStory.title, exact: true })).toHaveCount(1);
  const header = page.locator(".editor-table-header-panel");
  await expect(header).toBeVisible();
  expect((await header.boundingBox())!.y).toBeLessThan(500);
  await expect(header).toHaveCSS("background-color", "rgb(190, 220, 230)");
  const add = page.getByRole("button", { name: "+ Подводка", exact: true });
  expect((await add.boundingBox())!.height).toBeLessThanOrEqual(32);
  const swatch = page.locator(".editor-color-swatch").first();
  const size = (await swatch.boundingBox())!;
  expect(size.width).toBe(size.height);
  expect(size.width).toBeLessThanOrEqual(26);
  const firstText = page.getByRole("textbox", { name: "Текст блока 1", exact: true });
  await expect(firstText).toBeInViewport();
  await page.screenshot({ path: `../output/visual-polish/editor-${testInfo.project.name}.png`, fullPage: true });
});

test("workflow action remains in the story header through pending and failure", async ({ page }) => {
  await installSyntheticApi(page);
  await page.route("**/api/v1/stories/101/workflow", (route) => route.fulfill({ json: {
    ...syntheticWorkflow,
    primary_action: { code: "confirm_editorial", label: "Текст готов", method: "POST",
      href: "/api/v1/stories/101/workflow/confirm-editorial", emphasis: "primary", confirmation: null, form: null },
  } }));
  let failAction: (() => Promise<void>) | undefined;
  await page.route("**/workflow/confirm-editorial", (route) => {
    failAction = () => route.fulfill({ status: 409, json: { error: { message: "Состояние изменилось" } } });
  });
  await page.goto("/stories/101/scenario");
  const header = page.locator(".story-header");
  const action = header.getByRole("button", { name: "Текст готов", exact: true });
  await expect(action).toBeVisible();
  await expect(page.getByRole("region", { name: "Редактор сценария", exact: true })
    .getByRole("button", { name: "Текст готов", exact: true })).toHaveCount(0);
  await action.click();
  await expect(action).toBeDisabled();
  await expect.poll(() => Boolean(failAction)).toBe(true);
  await failAction!();
  await expect(header.getByRole("alert")).toContainText("Состояние изменилось");
  await expect(action).toBeEnabled();
});
