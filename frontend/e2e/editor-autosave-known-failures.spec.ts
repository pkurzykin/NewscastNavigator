import type { Page, Route } from "@playwright/test";

import { test, expect } from "./fixtures/current-editor";

const syntheticUser = {
  id: 1,
  username: "synthetic_admin",
  role: "admin",
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-11T00:00:00Z",
};

const syntheticProject = {
  id: 101,
  title: "Autosave browser synthetic",
  rubric: "Тестовая рубрика",
  planned_duration: "01:00",
  status: "draft",
  author_user_id: 1,
  author_username: "synthetic_admin",
  executor_user_ids: [],
  text_seq: 1,
  current_text_seq: 1,
  current_text_is_latest: true,
  titles_status: "not_started",
  edit_status: "not_started",
  voiceover_status: "not_started",
  final_review_status: "not_started",
  open_action_comment_count: 0,
  my_open_action_comment_count: 0,
  my_in_progress_action_comment_count: 0,
  my_recently_resolved_action_comment_count: 0,
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

  await page.addInitScript(({ user }) => {
    window.localStorage.setItem("nn_web_auth_token", "synthetic-browser-token");
    window.localStorage.setItem("nn_web_auth_user", JSON.stringify(user));
  }, { user: syntheticUser });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/auth/me") {
      await route.fulfill({ json: syntheticUser });
      return;
    }
    if (path === "/api/v1/projects" && method === "GET") {
      await route.fulfill({ json: { items: [syntheticProject], total: 1 } });
      return;
    }
    if (path === "/api/v1/projects/101/editor" && method === "GET") {
      await route.fulfill({ json: { project: syntheticProject, elements: [initialRow] } });
      return;
    }
    if (path === "/api/v1/projects/101/editor" && method === "PUT") {
      resolveSave({ route, rows: request.postDataJSON().rows });
      return;
    }
    if (path === "/api/v1/projects/101/meta" && method === "PUT") {
      await route.fulfill({ json: { ok: true, message: "Метаданные сохранены", project: syntheticProject } });
      return;
    }
    if (path === "/api/v1/projects/101/workspace") {
      await route.fulfill({
        json: {
          project: syntheticProject,
          workspace: { file_root: "", file_roots: [], project_note: "" },
          comments: [],
          material_links: [],
          files: [],
        },
      });
      return;
    }
    if (path === "/api/v1/users") {
      await route.fulfill({ json: { items: [syntheticUser], total: 1 } });
      return;
    }
    if (path === "/api/v1/projects/101/history" || path === "/api/v1/projects/101/revisions") {
      await route.fulfill({ json: { items: [], total: 0 } });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: `Unexpected synthetic route: ${method} ${path}` } });
  });

  return { saveSeen };
}

async function openAutosaveEditor(page: Page) {
  const { saveSeen } = await installDeferredSyntheticApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Сюжет Autosave browser synthetic/ }).click();
  await page
    .getByRole("complementary", { name: "Предпросмотр выбранной карточки" })
    .getByRole("button", { name: "Открыть карточку" })
    .click();
  return { saveSeen };
}

test("stale autosave response does not overwrite typing made while the request is in flight", async ({
  page,
  currentEditor,
}) => {
  test.fail(true, "Current runtime replaces local editor rows with the stale save response.");
  const { saveSeen } = await openAutosaveEditor(page);
  const editor = currentEditor.textEditor(0);

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
      project: syntheticProject,
      elements: deferredSave.rows,
    },
  });
  await expect(page.getByText("Автосохранение...")).toHaveCount(0);

  await expect(editor).toContainText("Базовый текст до запроса после запроса");
});

test("autosave status transition keeps visible geometry focus selection and scroll stable", async ({
  page,
  currentEditor,
}) => {
  test.fail(true, "Current variable-size save status visibly moves during autosave.");
  const { saveSeen } = await openAutosaveEditor(page);
  const editor = currentEditor.textEditor(0);
  const status = page.locator(".editor-save-status");

  await editor.click();
  await editor.press("End");
  const before = await status.boundingBox();
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

  expect(before).not.toBeNull();
  expect(during).not.toBeNull();
  expect.soft(Math.abs((during?.x || 0) - (before?.x || 0))).toBeLessThanOrEqual(1);
  expect.soft(Math.abs((during?.width || 0) - (before?.width || 0))).toBeLessThanOrEqual(1);
  expect.soft(duringState.scrollY).toBe(beforeState.scrollY);
  expect.soft(duringState.activeClass).toBe(beforeState.activeClass);
  expect.soft(duringState.selection).toBe(beforeState.selection);
});
