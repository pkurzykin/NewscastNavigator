import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures/current-editor";

const user = { id: 1, username: "synthetic_author", display_name: "Тест", position: "Корреспондент", function_codes: ["author"], is_active: true, must_change_password: false, created_at: "2026-07-12T00:00:00Z" };
const story = { id: 101, title: "Autosave browser synthetic", priority: { code: "standard", label: "Стандарт" }, rubric: { id: 7, name: "Тестовая рубрика" }, author: user, situation: { code: "active", label: "В работе" }, assignments: [], archived_at: null, created_at: "2026-07-12T00:00:00Z" };
const row = { segment_uid: "seg_00000000-0000-4000-8000-000000000001", order_index: 1, block_type: "zk", text: "Базовый текст", speaker_text: "", file_name: "", tc_in: "", tc_out: "", additional_comment: "", structured_data: {}, formatting: {}, rich_text: { schema_version: 1, targets: { text: { editor: "tiptap", text: "Базовый текст", html: "Базовый текст" } } } };
const emptyRow = { ...row, text: "", rich_text: { schema_version: 1, targets: {} } };

async function installApi(page: Page): Promise<{ saveSeen: Promise<Route> }> {
  let resolve!: (route: Route) => void;
  const saveSeen = new Promise<Route>((done) => { resolve = done; });
  await page.context().addCookies([{ name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: user });
    if (path === "/api/v1/stories/101") return route.fulfill({ json: story });
    if (path === "/api/v1/stories/101/scenario" && request.method() === "GET") return route.fulfill({ json: { story: { id: 101, title: story.title }, scenario: { revision: 0, rows: [row] }, edit: { state: "available" }, captionpanels: { eligible: true, last_opened_revision: 0, changed_since_last_open: true, diff_session_id: 93 } } });
    if (path === "/api/v1/stories/101/scenario/lease") return route.fulfill({ json: { edit_session_id: 3, lease_token: "lease", expires_at: "2026-07-12T12:00:00Z", revision: 0 } });
    if (path === "/api/v1/stories/101/scenario" && request.method() === "PUT") { resolve(route); return; }
    return route.fulfill({ status: 404, json: { error: { message: "Unexpected synthetic request" } } });
  });
  return { saveSeen };
}

test("keeps input after an in-flight acknowledgement-only autosave", async ({ page, currentEditor }) => {
  const { saveSeen } = await installApi(page);
  await page.goto("/stories/101/scenario");
  await expect(page.getByRole("heading", { name: "CaptionPanels" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("After Effects изменения нужно загрузить явным открытием");
  await expect(page.getByRole("link", { name: "Посмотреть изменения" })).toHaveAttribute("href", "/stories/101/history?session=93");
  const editor = currentEditor.textEditor(0);
  await editor.click(); await editor.press("End"); await editor.type(" до запроса");
  const deferred = await saveSeen;
  await editor.type(" после запроса");
  await deferred.fulfill({ json: { ok: true, client_save_id: deferred.request().postDataJSON().client_save_id, revision: 1, saved_at: "2026-07-12T12:00:00Z" } });
  await expect(editor).toContainText("Базовый текст до запроса после запроса");
});

test("releases and reacquires its lease across a hard reload without a phantom save", async ({ page, currentEditor }) => {
  let revision = 0;
  let rows = [structuredClone(emptyRow)];
  let activeLease: { edit_session_id: number; lease_token: string } | null = null;
  let nextSessionId = 40;
  let saveCount = 0;
  const requestOrder: string[] = [];
  const successfulSaves: Array<{ edit_session_id: number; lease_token: string }> = [];
  let heldAcquireCount = 0;
  let deferOldRelease = false;
  let pendingOldRelease: { route: Route; edit_session_id: number; lease_token: string } | null = null;

  await page.context().addCookies([{ name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: user });
    if (path === "/api/v1/stories/101") return route.fulfill({ json: story });
    if (path === "/api/v1/stories/101/scenario" && request.method() === "GET") {
      return route.fulfill({
        json: {
          story: { id: 101, title: story.title },
          scenario: { revision, rows },
          edit: activeLease ? { state: "mine", edit_session_id: activeLease.edit_session_id, holder: user } : { state: "available" },
        },
      });
    }
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "POST") {
      requestOrder.push("acquire");
      if (activeLease) {
        heldAcquireCount += 1;
        return route.fulfill({ status: 409, json: { error: { code: "SCENARIO_LEASE_HELD", message: "Сценарий уже редактирует другой пользователь" } } });
      }
      const editSessionId = nextSessionId++;
      activeLease = { edit_session_id: editSessionId, lease_token: `lease-${editSessionId}` };
      return route.fulfill({ json: { ...activeLease, expires_at: "2026-07-15T12:00:00Z", revision } });
    }
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "DELETE") {
      requestOrder.push("release");
      const payload = request.postDataJSON();
      if (
        deferOldRelease
        && activeLease
        && payload.edit_session_id === activeLease.edit_session_id
        && payload.lease_token === activeLease.lease_token
      ) {
        pendingOldRelease = { route, edit_session_id: payload.edit_session_id, lease_token: payload.lease_token };
        return;
      }
      if (activeLease && payload.edit_session_id === activeLease.edit_session_id && payload.lease_token === activeLease.lease_token) activeLease = null;
      return route.fulfill({ json: { ok: true, event_id: null, changed_at: "2026-07-15T12:00:00Z", resource: null } });
    }
    if (path === "/api/v1/stories/101/scenario" && request.method() === "PUT") {
      requestOrder.push("save");
      const payload = request.postDataJSON();
      if (!activeLease || payload.edit_session_id !== activeLease.edit_session_id || payload.lease_token !== activeLease.lease_token) {
        return route.fulfill({ status: 409, json: { error: { code: "SCENARIO_LEASE_INVALID", message: "Lease invalid" } } });
      }
      rows = structuredClone(payload.rows);
      revision += 1;
      saveCount += 1;
      successfulSaves.push({ edit_session_id: payload.edit_session_id, lease_token: payload.lease_token });
      return route.fulfill({ json: { ok: true, client_save_id: payload.client_save_id, revision, saved_at: "2026-07-15T12:00:00Z" } });
    }
    return route.fulfill({ status: 404, json: { error: { message: "Unexpected synthetic request" } } });
  });

  await page.goto("/stories/101/scenario");
  let editor = currentEditor.textEditor(0);
  await editor.click();
  await editor.type("CP3 браузерная проверка");
  await expect.poll(() => saveCount).toBe(1);
  const firstCredential = { ...activeLease! };

  deferOldRelease = true;
  await page.reload();
  await expect.poll(() => pendingOldRelease !== null).toBe(true);
  editor = currentEditor.textEditor(0);
  await expect(editor).toContainText("CP3 браузерная проверка");
  expect(requestOrder).toContain("release");
  await page.waitForTimeout(900);
  expect(saveCount).toBe(1);
  await editor.click();
  await editor.press("End");
  await editor.type(" после reload");
  await expect(page.getByText("Сценарий уже редактирует другой пользователь").first()).toBeVisible();
  expect(saveCount).toBe(1);
  await expect(editor).toContainText("CP3 браузерная проверка после reload");
  const draftBeforeRecovery = await page.evaluate(() => window.localStorage.getItem("newscast:scenario-draft:101:1"));
  expect(draftBeforeRecovery).toContain("после reload");

  const deferredRelease = pendingOldRelease!;
  expect({ edit_session_id: deferredRelease.edit_session_id, lease_token: deferredRelease.lease_token }).toEqual(firstCredential);
  activeLease = null;
  deferOldRelease = false;
  await deferredRelease.route.fulfill({ json: { ok: true, event_id: null, changed_at: "2026-07-15T12:00:00Z", resource: null } });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect.poll(() => saveCount).toBe(2);
  await expect(editor).toContainText("CP3 браузерная проверка после reload");
  await expect(page.getByText("Сценарий уже редактирует другой пользователь")).toHaveCount(0);
  expect(activeLease).not.toBeNull();
  expect(activeLease).not.toEqual(firstCredential);
  expect(successfulSaves[1]).toEqual(activeLease);
  expect(heldAcquireCount).toBeGreaterThanOrEqual(1);
  expect(requestOrder.filter((item) => item === "acquire").length).toBeGreaterThanOrEqual(3);
  expect(requestOrder.filter((item) => item === "save")).toHaveLength(2);
});

test("releases, restores, and edits through an actual BFCache navigation when Chromium supports it", async ({ page, currentEditor }) => {
  let revision = 0;
  let rows = [structuredClone(emptyRow)];
  let activeLease: { edit_session_id: number; lease_token: string } | null = null;
  let nextSessionId = 60;
  let saveCount = 0;

  await page.context().addCookies([{ name: "newscast_session", value: "synthetic-session", url: "http://127.0.0.1:5173" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: user });
    if (path === "/api/v1/stories/101") return route.fulfill({ json: story });
    if (path === "/api/v1/stories/101/scenario" && request.method() === "GET") {
      return route.fulfill({
        json: {
          story: { id: 101, title: story.title },
          scenario: { revision, rows },
          edit: activeLease ? { state: "held", holder: user } : { state: "available" },
          captionpanels: { eligible: false, last_opened_revision: null, changed_since_last_open: false, diff_session_id: null },
        },
      });
    }
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "POST") {
      if (activeLease) {
        return route.fulfill({ status: 409, json: { error: { code: "SCENARIO_LEASE_HELD", message: "Сценарий уже редактирует другой пользователь" } } });
      }
      const editSessionId = nextSessionId++;
      activeLease = { edit_session_id: editSessionId, lease_token: `lease-${editSessionId}` };
      return route.fulfill({ json: { ...activeLease, expires_at: "2026-07-15T12:00:00Z", revision } });
    }
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "DELETE") {
      const payload = request.postDataJSON();
      if (activeLease && payload.edit_session_id === activeLease.edit_session_id && payload.lease_token === activeLease.lease_token) activeLease = null;
      return route.fulfill({ json: { ok: true, event_id: null, changed_at: "2026-07-15T12:00:00Z", resource: null } });
    }
    if (path === "/api/v1/stories/101/scenario" && request.method() === "PUT") {
      const payload = request.postDataJSON();
      if (!activeLease || payload.edit_session_id !== activeLease.edit_session_id || payload.lease_token !== activeLease.lease_token) {
        return route.fulfill({ status: 409, json: { error: { code: "SCENARIO_LEASE_INVALID", message: "Lease invalid" } } });
      }
      rows = structuredClone(payload.rows);
      revision += 1;
      saveCount += 1;
      return route.fulfill({ json: { ok: true, client_save_id: payload.client_save_id, revision, saved_at: "2026-07-15T12:00:00Z" } });
    }
    return route.fulfill({ status: 404, json: { error: { message: "Unexpected synthetic request" } } });
  });

  await page.goto("/stories/101/scenario");
  let editor = currentEditor.textEditor(0);
  await editor.click();
  await editor.type("BFCache A");
  await expect.poll(() => saveCount).toBe(1);
  await page.evaluate(() => {
    (window as typeof window & { __cp3PageshowPersisted?: boolean | null }).__cp3PageshowPersisted = null;
    window.addEventListener("pageshow", (event) => {
      (window as typeof window & { __cp3PageshowPersisted?: boolean | null }).__cp3PageshowPersisted = event.persisted;
    });
  });

  await page.goto("/__cp3_bfcache_probe__");
  await page.goBack();
  const restoredFromCache = await page.evaluate(() =>
    (window as typeof window & { __cp3PageshowPersisted?: boolean | null }).__cp3PageshowPersisted === true,
  );
  test.skip(!restoredFromCache, "Chromium environment did not produce an actual BFCache restoration; deterministic hook coverage remains authoritative.");

  editor = currentEditor.textEditor(0);
  await expect(editor).toContainText("BFCache A");
  await editor.click();
  await editor.press("End");
  await editor.type(" затем B");
  await expect.poll(() => saveCount).toBe(2);
  await expect(editor).toContainText("BFCache A затем B");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
