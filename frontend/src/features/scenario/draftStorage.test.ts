import { describe, it, expect, vi } from "vitest";
describe("tab-isolated scenario drafts", () => {
 it("never overwrites or acknowledges another document's draft", async () => {
  window.localStorage.clear();
  const a = await import("./draftStorage"); vi.resetModules(); const b = await import("./draftStorage");
  expect(a.scenarioDraftKey(1, 1)).not.toBe(b.scenarioDraftKey(1, 1));
  a.writeScenarioDraft(1, 1, 1, []);
  b.writeScenarioDraft(1, 1, 2, []);
  a.clearScenarioDraft(1, 1);
  expect(b.readScenarioDraft(1, 1)?.revision).toBe(2);
 });
});
