import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const actor = { id: 1, username: "access_author", display_name: "Автор", position: "Сотрудник", function_codes: ["author"], is_active: true, must_change_password: false, created_at: "2026-07-12T00:00:00Z" };
const secondAuthor = { ...actor, id: 2, username: "access_other", display_name: "Другой автор" };
const baseRow = { segment_uid: "seg_00000000-0000-4000-8000-000000000001", order_index: 1, block_type: "zk", text: "Базовый текст", speaker_text: "", file_name: "", tc_in: "", tc_out: "", additional_comment: "", structured_data: {}, formatting: {}, rich_text: { schema_version: 1, targets: {} } };
function createAccessState() { return { revision: 0, rows: [baseRow], lease: null as null | { edit_session_id: number; lease_token: string; expires_at: string; revision: number }, puts: [] as any[], deletes: 0, deletePayloads: [] as any[], failRelease: false, metadataPatches: [] as any[], gets: 0, acquisitions: 0, delay: false, forceAvailable: false, ownerId: 1, waiting: [] as Array<() => void>, title: "Синтетический доступ", author: actor, archive: false }; }
async function fixture(context: BrowserContext, codes = ["author"], state = createAccessState(), userId = 1) {
 const management = { action: { code: "update_management", label: "Изменить", method: "PATCH", href: "/api/v1/stories/101/management" }, author_options: [actor, secondAuthor] };
 const story = () => ({ id: 101, title: state.title, duration_text: null, priority: { code: "standard", label: "Стандарт" }, rubric: { id: 7, name: "Тестовая рубрика" }, author: state.author, situation: { code: "active", label: "В работе" }, assignments: [], management, archived_at: state.archive ? "2026-09-14T00:00:00Z" : null, created_at: "2026-07-12T00:00:00Z" });
 const edit = () => state.forceAvailable ? { state: "available" } : state.archive ? { state: "archived" } : state.lease ? { state: state.ownerId === userId ? "mine" : "held", edit_session_id: state.lease.edit_session_id, expires_at: state.lease.expires_at, holder: actor } : { state: "available" };
 await context.route("**/api/v1/**", async (route: Route) => {
  const request = route.request(); const path = new URL(request.url()).pathname; const method = request.method();
  if (path.endsWith("/auth/me")) return route.fulfill({ json: { ...actor, id: userId, function_codes: codes } });
  if (path.endsWith("/me/actions") || path.endsWith("/notifications")) return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
  if (path === "/api/v1/stories/101") {
   if (method === "PATCH") state.title = request.postDataJSON().title ?? state.title;
   return route.fulfill({ json: story() });
  }
  if (path.endsWith("/metadata")) { state.metadataPatches.push(request.postDataJSON()); state.title = request.postDataJSON().title ?? state.title; return route.fulfill({ json: { ok: true } }); }
  if (path.endsWith("/management")) { state.author = secondAuthor; return route.fulfill({ json: { ok: true } }); }
  if (path.endsWith("/workflow")) return route.fulfill({ json: { story_id: 101, primary_action: null, additional_actions: [], review_request: null, editorial_check: null, proofread: null, changed_after_proofread: false, reproofread_request: null } });
  if (path.endsWith("/scenario/access")) return route.fulfill({ json: { story_id: 101, revision: state.revision, edit: edit() } });
  if (path.endsWith("/scenario/lease") && method === "POST") {
   state.acquisitions++;
   if (state.delay) await new Promise<void>((done) => state.waiting.push(done));
   if (state.lease || state.archive) return route.fulfill({ status: 409, json: { error: { code: "SCENARIO_LEASE_HELD", message: "Сценарий занят другим окном" } } });
   state.ownerId = userId;
   state.lease = { edit_session_id: state.acquisitions, lease_token: `tab-${state.acquisitions}`, expires_at: "2099-07-15T12:00:00Z", revision: state.revision };
   return route.fulfill({ json: state.lease });
  }
  if (path.endsWith("/scenario/lease") && method === "DELETE") {
   state.deletes++; state.deletePayloads.push(request.postDataJSON());
   if (state.failRelease) return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Освобождение временно недоступно" } } });
   if (request.postDataJSON().lease_token === state.lease?.lease_token) state.lease = null;
   return route.fulfill({ json: { ok: true } });
  }
  if (path.endsWith("/scenario/lease/heartbeat")) return route.fulfill({ json: { ok: true, expires_at: "2099-07-15T12:00:00Z" } });
  if (path.endsWith("/scenario") && method === "GET") { state.gets++; return route.fulfill({ json: { story: story(), scenario: { revision: state.revision, rows: state.rows }, edit: edit(), metadata: { editable: true, rubrics: [{ id: 7, name: "Тестовая рубрика" }] }, captionpanels: { eligible: true, last_opened_revision: null, changed_since_last_open: false, diff_session_id: null } } }); }
  if (path.endsWith("/scenario") && method === "PUT") {
   const payload = request.postDataJSON(); state.puts.push(payload);
   if (!state.lease || payload.lease_token !== state.lease.lease_token) return route.fulfill({ status: 409, json: { error: { code: "SCENARIO_LEASE_INVALID", message: "Нет права" } } });
   state.rows = payload.rows; state.revision++; return route.fulfill({ json: { ok: true, client_save_id: payload.client_save_id, revision: state.revision, saved_at: "2026-09-14T00:00:00Z" } });
  }
  return route.fulfill({ status: 404, json: { error: { message: `Unexpected ${method} ${path}` } } });
 });
 return state;
}
const textField = (page: Page) => page.getByRole("textbox", { name: "Текст блока 1", exact: true });
const candidate = (page: Page) => page.getByRole("textbox", { name: "Локальный ввод: Текст блока 1", exact: true });

test("buffers rapid first typing and paste before grant without a canonical transaction", async ({ page, context }) => {
 const state = await fixture(context); state.delay = true;
 await page.goto("/stories/101/scenario"); await textField(page).click();
 const initialGets = state.gets;
 await expect(candidate(page)).toBeFocused();
 await page.keyboard.press("End"); await page.keyboard.type(" первый ");
 await candidate(page).evaluate((element) => { const data = new DataTransfer(); data.setData("text/html", "<strong>жирный</strong>"); data.setData("text/plain", "жирный"); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); });
 await expect(candidate(page)).toContainText("первый жирный");
 await expect(page.locator('.editor-core-field > div[hidden] [role="textbox"]')).toContainText("Базовый текст");
 expect(state.puts).toHaveLength(0); expect(state.gets).toBe(initialGets);
 state.delay = false; state.waiting.splice(0).forEach((done) => done());
 await expect(textField(page)).toContainText("Базовый текст первый жирный");
 await expect(textField(page).locator("strong")).toHaveText("жирный");
 await expect.poll(() => state.puts.length).toBe(1);
 expect(state.puts[0].rows[0].text).toBe("Базовый текст первый жирный");
 expect(state.acquisitions).toBe(1);
});

test("keeps denied same-user other-tab candidate outside canonical rows", async ({ page, context }) => {
 const state = await fixture(context); const other = await context.newPage();
 await page.goto("/stories/101/scenario"); await other.goto("/stories/101/scenario");
 await textField(page).click(); await expect(page.getByRole("switch", { name: "Редактирование сценария" })).toBeChecked();
 state.delay = true; state.forceAvailable = true;
 await other.evaluate(() => window.dispatchEvent(new Event("focus")));
 await expect(other.getByText("Сценарий открыт вами в другом окне.")).not.toBeVisible();
 // Both opened available. The second acquire races with the first holder.
 await textField(other).click(); await expect(candidate(other)).toBeVisible(); await other.keyboard.type("Чужой кандидат");
 state.delay = false; state.waiting.splice(0).forEach((done) => done());
 await expect(other.getByText("Право редактирования не получено. Локальный ввод сохранён отдельно.")).toBeVisible();
 await expect(candidate(other)).toContainText("Чужой кандидат");
 expect(state.puts).toHaveLength(0);
 await expect(other.locator('.editor-core-field > div[hidden] [role="textbox"]')).toHaveText("Базовый текст");
 await other.close();
});

test("technical functions read by default, explicit switch flushes metadata and scenario before release", async ({ page, context }) => {
 const state = await fixture(context, ["designer"]);
 await page.goto("/stories/101/scenario");
 await textField(page).click(); expect(state.acquisitions).toBe(0);
 await expect(textField(page)).toHaveAttribute("contenteditable", "false");
 await page.getByRole("switch", { name: "Редактирование сценария" }).click();
 await expect(textField(page)).toHaveAttribute("contenteditable", "true");
 await textField(page).fill("Сохранить перед выходом");
 await page.getByRole("textbox", { name: "Название", exact: true }).fill("Название перед выходом");
 await page.getByRole("switch", { name: "Редактирование сценария" }).click();
 await expect.poll(() => state.deletes).toBe(1);
 expect(state.puts[0].rows[0].text).toBe("Сохранить перед выходом"); expect(state.title).toBe("Название перед выходом");
 await expect(textField(page)).toHaveAttribute("contenteditable", "false");
});

test("combined editorial functions enter on interaction and author changes preserve the mounted dirty editor", async ({ page, context }) => {
 const state = await fixture(context, ["chief", "designer"]);
 await page.goto("/stories/101/scenario"); await textField(page).click();
 await expect(page.getByRole("switch", { name: "Редактирование сценария" })).toBeChecked();
 await textField(page).fill("Локальный текст при смене автора");
 await textField(page).evaluate((element) => { element.setAttribute("data-mount-proof", "same"); });
 const gets = state.gets;
 await page.getByRole("button", { name: "Изменить", exact: true }).click();
 await page.getByRole("combobox", { name: "Автор", exact: true }).selectOption("2");
 await page.getByRole("button", { name: "Сохранить", exact: true }).click();
 await expect(page.getByRole("dialog", { name: "Изменить автора" })).not.toBeVisible();
 await expect(textField(page)).toHaveAttribute("data-mount-proof", "same");
 await expect(textField(page)).toHaveText("Локальный текст при смене автора"); expect(state.gets).toBe(gets);
});

test("grant during composition waits for the final composed input and replays once", async ({ page, context }) => {
 const state = await fixture(context); state.delay = true;
 await page.goto("/stories/101/scenario"); await textField(page).click();
 await candidate(page).evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" })));
 await page.keyboard.press("End"); await page.keyboard.insertText("漢字");
 await expect(candidate(page)).toContainText("漢字");
 state.delay = false; state.waiting.splice(0).forEach((done) => done());
 await expect(page.getByRole("switch", { name: "Редактирование сценария" })).toBeChecked();
 await expect(candidate(page)).toBeVisible(); expect(state.puts).toHaveLength(0);
 await candidate(page).evaluate((element) => {
  element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "漢字" }));
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "漢字", isComposing: false }));
 });
 await expect(textField(page)).toHaveText("Базовый текст漢字");
 await expect.poll(() => state.puts.length).toBe(1);
 expect(state.puts[0].rows[0].text).toBe("Базовый текст漢字");
});

test("visible polling discovers a holder and later expiry without reloading canonical text", async ({ page, context }) => {
 const state = await fixture(context);
 await page.goto("/stories/101/scenario"); await expect(textField(page)).toBeVisible();
 const initialGets = state.gets;
 state.lease = { edit_session_id: 55, lease_token: "other-window", expires_at: "2099-01-01T00:00:00Z", revision: 0 };
 await expect(page.getByText("Сценарий открыт вами в другом окне.")).toBeVisible({ timeout: 6500 });
 await expect(textField(page)).toHaveAttribute("contenteditable", "false"); expect(state.gets).toBe(initialGets);
 state.lease = null;
 await expect(page.getByText("Сценарий открыт вами в другом окне.")).not.toBeVisible({ timeout: 6500 });
 await textField(page).click(); await expect(page.getByRole("switch", { name: "Редактирование сценария" })).toBeChecked();
 expect(state.gets).toBe(initialGets);
});

test("a different authenticated user sees the live holder and remains read-only", async ({ page, context, browser }) => {
 const state = await fixture(context);
 const secondContext = await browser.newContext();
 await secondContext.addInitScript(() => localStorage.setItem("newscast:whats-new:2:1.2.0", "seen"));
 await fixture(secondContext, ["author"], state, 2);
 const other = await secondContext.newPage();
 await page.goto("/stories/101/scenario"); await other.goto(new URL("/stories/101/scenario", page.url()).href);
 await textField(page).click(); await expect(page.getByRole("switch", { name: "Редактирование сценария" })).toBeChecked();
 await other.evaluate(() => window.dispatchEvent(new Event("focus")));
 await expect(other.getByText("Сценарий редактирует Автор.")).toBeVisible();
 await expect(textField(other)).toHaveAttribute("contenteditable", "false");
 expect(state.acquisitions).toBe(1); expect(state.puts).toHaveLength(0);
 await secondContext.close();
});

test("archive is read-only even for editorial and technical combined functions", async ({ page, context }) => {
 const state = await fixture(context, ["chief", "designer"]); state.archive = true;
 await page.goto("/stories/101/scenario");
 await expect(textField(page)).toHaveAttribute("contenteditable", "false");
 await expect(page.getByRole("switch", { name: "Редактирование сценария" })).toHaveCount(0);
 await textField(page).click(); expect(state.acquisitions).toBe(0);
});

for (const mode of ["plain", "html", "denied-html"] as const) {
 test(`first drop ${mode} buffers content before focus and keeps canonical text unchanged until grant`, async ({ page, context }) => {
  const state = await fixture(context); state.delay = true;
  await page.goto("/stories/101/scenario"); await expect(textField(page)).toBeVisible();
  expect(state.acquisitions).toBe(0);
  await textField(page).evaluate((element, mode) => {
   const transfer = new DataTransfer(); transfer.setData("text/plain", "Перенесённый текст");
   if (mode !== "plain") transfer.setData("text/html", "<p><strong>Перенесённый</strong> текст</p>");
   const box = element.getBoundingClientRect();
   element.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: box.x + 3, clientY: box.y + 5 }));
  }, mode);
  await expect(candidate(page)).toContainText("Перенесённый текст");
  await expect.poll(() => state.acquisitions).toBe(1);
  await expect(page.locator('.editor-core-field > div[hidden] [role="textbox"]')).toHaveText("Базовый текст");
  expect(state.puts).toHaveLength(0);
  if (mode === "denied-html") state.lease = { edit_session_id: 99, lease_token: "another-window", expires_at: "2099-01-01T00:00:00Z", revision: 0 };
  state.delay = false; state.waiting.splice(0).forEach((done) => done());
  if (mode === "denied-html") {
   await expect(page.getByText("Право редактирования не получено. Локальный ввод сохранён отдельно.")).toBeVisible();
   await expect(candidate(page).locator("strong")).toHaveText("Перенесённый");
   await expect(page.locator('.editor-core-field > div[hidden] [role="textbox"]')).toHaveText("Базовый текст");
   expect(state.puts).toHaveLength(0);
   expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.includes("scenario-input:") && localStorage.getItem(key)?.includes("Перенесённый")))).toBe(true);
  } else {
   await expect(textField(page)).toContainText("Перенесённый текст");
   if (mode === "html") await expect(textField(page).locator("strong")).toHaveText("Перенесённый");
   await expect.poll(() => state.puts.length).toBe(1);
   expect(state.puts[0].rows[0].text).toContain("Перенесённый текст");
  }
 });
}

for (const denied of [false, true]) {
 test(`first Find and Replace command acquires before opening (${denied ? "denied" : "granted"}) while Find remains read-only`, async ({ page, context }) => {
  const state = await fixture(context); state.delay = true;
  await page.goto("/stories/101/scenario");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByRole("search", { name: "Найти и заменить" })).toBeVisible();
  expect(state.acquisitions).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("search", { name: "Найти и заменить" })).toHaveCount(0);
  await page.getByRole("button", { name: "Найти и заменить", exact: true }).click();
  await expect.poll(() => state.acquisitions).toBe(1);
  await expect(page.getByRole("search", { name: "Найти и заменить" })).toHaveCount(0);
  if (denied) state.lease = { edit_session_id: 99, lease_token: "another-window", expires_at: "2099-01-01T00:00:00Z", revision: 0 };
  state.delay = false; state.waiting.splice(0).forEach((done) => done());
  if (denied) {
   await expect(page.getByText("Сценарий занят другим окном")).toBeVisible();
   await expect(page.getByRole("search", { name: "Найти и заменить" })).toHaveCount(0);
  } else {
   await expect(page.getByRole("search", { name: "Найти и заменить" })).toHaveCount(1);
   await expect(page.getByRole("textbox", { name: "Заменить на" })).toBeVisible();
  }
  expect(state.acquisitions).toBe(1); expect(state.puts).toHaveLength(0);
  await expect(textField(page)).toHaveText("Базовый текст");
 });
}

for (const [label, value, expected] of [
 ["Название", " Название после blur ", { title: "Название после blur" }],
 ["Хронометраж", " 02:45 ", { duration_text: "02:45" }],
] as const) {
 test(`deferred ${label} blur commits once after grant without stealing focus`, async ({ page, context }) => {
  const state = await fixture(context); state.delay = true;
  await page.goto("/stories/101/scenario");
  await page.getByRole("textbox", { name: label, exact: true }).fill(value);
  const next = page.getByRole("button", { name: "Найти", exact: true }); await next.focus();
  await expect.poll(() => state.acquisitions).toBe(1); expect(state.metadataPatches).toHaveLength(0);
  state.delay = false; state.waiting.splice(0).forEach((done) => done());
  await expect.poll(() => state.metadataPatches.length).toBe(1);
  expect(state.metadataPatches[0]).toEqual(expected); await expect(next).toBeFocused();
 });
}

test("deferred TC blur normalizes once after grant and preserves focus and file", async ({ page, context }) => {
 const state = await fixture(context); state.delay = true;
 state.rows = [{ ...baseRow, file_name: "synthetic.mov", tc_in: "00:01" }];
 await page.goto("/stories/101/scenario");
 const field = page.getByRole("textbox", { name: "TC IN блока 1, файл 1" }); await field.fill("010203");
 const next = page.getByRole("button", { name: "Найти", exact: true }); await next.focus();
 await expect.poll(() => state.acquisitions).toBe(1); expect(state.puts).toHaveLength(0);
 state.delay = false; state.waiting.splice(0).forEach((done) => done());
 await expect(field).toHaveValue("01:02:03"); await expect(next).toBeFocused();
 await expect.poll(() => state.puts.length).toBe(1);
 expect(state.puts[0].rows[0].file_name).toBe("synthetic.mov"); expect(state.puts[0].rows[0].tc_in).toBe("01:02:03");
});

test("revision mismatch release retry remains usable with a pending candidate and continues reconciliation", async ({ page, context }) => {
 const state = await fixture(context); state.delay = true; state.failRelease = true;
 await page.goto("/stories/101/scenario"); await textField(page).click();
 await candidate(page).fill("Сохранённый кандидат после отказа DELETE");
 const initialGets = state.gets; state.revision = 1;
 state.delay = false; state.waiting.splice(0).forEach((done) => done());
 const retry = page.getByRole("button", { name: "Повторить завершение редактирования" });
 await expect(retry).toBeVisible(); await expect(candidate(page)).toHaveText("Сохранённый кандидат после отказа DELETE");
 expect(state.acquisitions).toBe(1); expect(state.deletes).toBe(1); expect(state.puts).toHaveLength(0);
 state.failRelease = false; await retry.click();
 await expect.poll(() => state.deletes).toBe(2); expect(state.deletePayloads[1]).toEqual(state.deletePayloads[0]);
 await expect.poll(() => state.gets).toBeGreaterThan(initialGets);
 await expect(page.getByText("Сохранённый кандидат после отказа DELETE", { exact: true })).toBeVisible();
 expect(state.acquisitions).toBe(1); expect(state.puts).toHaveLength(0);
});
