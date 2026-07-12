import type { Page, Route } from "@playwright/test";

import { test, expect } from "./fixtures/current-editor";

const syntheticUser = {
  id: 1,
  username: "synthetic_admin",
  display_name: "Тест",
  position: "Корреспондент",
  function_codes: ["author"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-11T00:00:00Z",
};

const syntheticProject = {
  id: 101,
  title: "Autosave browser synthetic",
  priority: { code: "standard", label: "Стандарт" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author: syntheticUser,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  archived_at: null,
  created_at: "2026-07-11T00:00:00Z",
  status_changed_at: "2026-07-11T00:00:00Z",
};

const initialRow = {
  id: 11,
  segment_uid: "seg_browser_autosave_11",
  order_index: 1,
  block_type: "zk",
  text: "Базовый текст",
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
      text: { editor: "tiptap", text: "Базовый текст", html: "Базовый текст" },
    },
  },
};

interface DeferredSave {
  route: Route;
  rows: typeof initialRow[];
}

async function installDeferredSyntheticApi(
  page: Page
): Promise<{ saveSeen: Promise<DeferredSave> }> {
  let resolveSave!: (value: DeferredSave) => void;
  const saveSeen = new Promise<DeferredSave>((resolve) => {
    resolveSave = resolve;
  });

  await page.context().addCookies([
    { name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" },
  ]);

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/auth/me") {
      await route.fulfill({ json: syntheticUser });
      return;
    }
    if (path === "/api/v1/stories/101") {
      await route.fulfill({ json: syntheticProject });
      return;
    }
    if (path === "/api/v1/stories/101/editor" && method === "GET") {
      await route.fulfill({ json: { story: syntheticProject, elements: [initialRow] } });
      return;
    }
    if (path === "/api/v1/stories/101/editor" && method === "PUT") {
      resolveSave({ route, rows: request.postDataJSON().rows });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: `Unexpected synthetic route: ${method} ${path}` } });
  });

  return { saveSeen };
}

async function openAutosaveEditor(page: Page) {
  const { saveSeen } = await installDeferredSyntheticApi(page);
  await page.goto("/stories/101/scenario");
  return { saveSeen };
}

test("stale autosave response does not overwrite typing made while the request is in flight", async ({
  page,
  currentEditor,
}) => {
  const { saveSeen } = await openAutosaveEditor(page);
  const editor = currentEditor.textEditor(0);
  await expect(editor).toContainText("Базовый текст");

  await editor.click();
  await editor.press("End");
  await editor.type(" до запроса");
  const deferredSave = await saveSeen;
  expect(deferredSave.rows[0].text).toBe("Базовый текст до запроса");

  await editor.type(" после запроса");
  await expect(editor).toContainText("Базовый текст до запроса после запроса");
  await deferredSave.route.fulfill({
    json: {
      ok: true,
      message: "Таблица сценария сохранена",
      updated: 1,
      inserted: 0,
      removed: 0,
      total: 1,
      story: syntheticProject,
      elements: deferredSave.rows,
    },
  });
  await expect(page.getByText("Автосохранение...")).toHaveCount(0);

  test.fail(true, "Current runtime replaces local editor rows with the stale save response.");
  await expect(editor).toContainText("Базовый текст до запроса после запроса");
});

test("autosave status transition keeps visible geometry focus selection and scroll stable", async ({
  page,
  currentEditor,
}) => {
  const { saveSeen } = await openAutosaveEditor(page);
  const editor = currentEditor.textEditor(0);
  const status = page.locator(".editor-save-status");
  await expect(editor).toContainText("Базовый текст");
  await expect(status).toBeVisible();
  const before = await status.boundingBox();
  expect(before).not.toBeNull();

  await editor.click();
  await editor.press("End");
  const beforeState = await page.evaluate(() => ({
    scrollY: window.scrollY,
    activeClass: document.activeElement?.className || "",
    selection: window.getSelection()?.toString() || "",
  }));

  await editor.type(" изменение");
  await saveSeen;
  await expect(page.getByText("Автосохранение...")).toBeVisible();
  const during = await status.boundingBox();
  const duringState = await page.evaluate(() => ({
    scrollY: window.scrollY,
    activeClass: document.activeElement?.className || "",
    selection: window.getSelection()?.toString() || "",
  }));

  expect(during).not.toBeNull();
  test.fail(true, "Current variable-size save status visibly moves during autosave.");
  expect.soft(Math.abs((during?.x || 0) - (before?.x || 0))).toBeLessThanOrEqual(1);
  expect.soft(Math.abs((during?.width || 0) - (before?.width || 0))).toBeLessThanOrEqual(1);
  expect.soft(duringState.scrollY).toBe(beforeState.scrollY);
  expect.soft(duringState.activeClass).toBe(beforeState.activeClass);
  expect.soft(duringState.selection).toBe(beforeState.selection);
});
