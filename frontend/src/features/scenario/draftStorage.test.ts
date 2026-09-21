import { describe, it, expect, vi } from "vitest";
describe("tab-isolated scenario drafts", () => {
 it("never overwrites or acknowledges another document's draft", async () => {
  window.localStorage.clear();
  const a = await import("./draftStorage"); vi.resetModules(); const b = await import("./draftStorage");
  expect(a.scenarioDraftKey(1, 1)).not.toBe(b.scenarioDraftKey(1, 1));
  a.writeScenarioDraft(1, 1, 1, { rows: [], default_font_family: "PT Sans" });
  b.writeScenarioDraft(1, 1, 2, { rows: [], default_font_family: "PT Sans" });
  a.clearScenarioDraft(1, 1);
  expect(b.readScenarioDraft(1, 1)?.revision).toBe(2);
 });
});

it("round trips the snapshot font and normalizes only missing legacy values", async () => {
  window.localStorage.clear();
  const storage = await import("./draftStorage");
  storage.writeScenarioDraft(7, 1, 3, { rows: [], default_font_family: "Franklin Gothic Book" });
  expect(storage.readScenarioDraft(7, 1)).toMatchObject({ revision: 3, rows: [], default_font_family: "Franklin Gothic Book" });
  const key = storage.scenarioDraftKey(7, 1);
  window.localStorage.setItem(key, JSON.stringify({ revision: 1, rows: [], saved_at: "2026-09-15" }));
  expect(storage.readScenarioDraft(7, 1)?.default_font_family).toBe("PT Sans");
  window.localStorage.setItem(key, JSON.stringify({ revision: 1, rows: [], default_font_family: "Arial" }));
  expect(storage.readScenarioDraft(7, 1)).toBeNull();
});
