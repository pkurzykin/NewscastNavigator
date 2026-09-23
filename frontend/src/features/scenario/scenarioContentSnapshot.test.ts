import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { recordScenarioMutation, resetScenarioHistory, undoScenarioMutation, redoScenarioMutation } from "./scenarioHistory";
import { useScenarioAutosave } from "./useScenarioAutosave";
import { createDeferred } from "../../test/deferred";
import { createEmptyScenarioRow } from "./rowIdentity";

it("undoes and redoes a font-only snapshot without losing explicit marks", () => {
  const rows = [createEmptyScenarioRow(1)];
  rows[0].formatting = { targets: { text: { font_family: "PT Sans", bold: true } } };
  const before = { rows, default_font_family: "PT Sans" as const };
  const after = { rows, default_font_family: "Franklin Gothic Book" as const };
  const history = recordScenarioMutation(resetScenarioHistory(), before, after, { kind: "formatting" });
  const undo = undoScenarioMutation(history, after)!;
  expect(undo.default_font_family).toBe("PT Sans");
  const redo = redoScenarioMutation(undo.state, undo)!;
  expect(redo.default_font_family).toBe("Franklin Gothic Book");
  expect(redo.rows).toEqual(rows);
});

it("does not acknowledge a newer font when the rows are identical", async () => {
  const first = createDeferred<{ revision: number }>();
  const second = createDeferred<{ revision: number }>();
  const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => useScenarioAutosave({ storyId: 995, userId: 1, initialRevision: 0, save, ensureLease: async () => ({ edit_session_id: 1, lease_token: "synthetic" }) }));
  const rows = [createEmptyScenarioRow(1)];
  act(() => result.current.scheduleSave({ rows, default_font_family: "PT Sans" }));
  let flushed!: Promise<number>;
  await act(async () => { flushed = result.current.flushPending(); await Promise.resolve(); });
  act(() => result.current.scheduleSave({ rows, default_font_family: "Franklin Gothic Book" }));
  await act(async () => { void result.current.flushPending(); first.resolve({ revision: 1 }); await Promise.resolve(); });
  expect(result.current.isDirty()).toBe(true);
  expect(save.mock.calls[1][0]).toMatchObject({ base_revision: 1, default_font_family: "Franklin Gothic Book", rows });
  await act(async () => { second.resolve({ revision: 2 }); await flushed; });
  expect(result.current.isDirty()).toBe(false);
});
