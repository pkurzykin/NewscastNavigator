import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures/current-editor";

const user = { id: 1, username: "synthetic_author", display_name: "Тест", position: "Корреспондент", function_codes: ["author"], is_active: true, must_change_password: false, created_at: "2026-07-12T00:00:00Z" };
const story = { id: 101, title: "Autosave browser synthetic", priority: { code: "standard", label: "Стандарт" }, rubric: { id: 7, name: "Тестовая рубрика" }, author: user, situation: { code: "active", label: "В работе" }, assignments: [], archived_at: null, created_at: "2026-07-12T00:00:00Z" };
const row = { segment_uid: "seg_00000000-0000-4000-8000-000000000001", order_index: 1, block_type: "zk", text: "Базовый текст", speaker_text: "", file_name: "", tc_in: "", tc_out: "", additional_comment: "", structured_data: {}, formatting: {}, rich_text: { schema_version: 1, targets: { text: { editor: "tiptap", text: "Базовый текст", html: "Базовый текст" } } } };

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
