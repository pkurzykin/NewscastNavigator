import { describe, expect, it } from "vitest";

import {
  recordScenarioMutation,
  redoScenarioMutation,
  resetScenarioHistory,
  SCENARIO_HISTORY_LIMIT,
  SCENARIO_TYPING_GROUP_MS,
  undoScenarioMutation,
} from "./scenarioHistory";
import type { ScenarioRow } from "./types";

function row(text: string, segmentUid = "segment-1"): ScenarioRow {
  return {
    segment_uid: segmentUid,
    order_index: 1,
    block_type: "zk",
    text,
    speaker_text: "",
    file_name: "",
    tc_in: "",
    tc_out: "",
    additional_comment: "",
    structured_data: {
      lines: [text],
      optional: undefined,
    },
    formatting: { targets: { text: { italic: false } } },
    rich_text: { schema_version: 1, targets: { text: { editor: "legacy_html", text, html: text } } },
  };
}

const mutation = (kind: "typing" | "field", groupKey: string, timestamp: number) => ({
  kind,
  groupKey,
  timestamp,
} as const);

describe("scenario history model", () => {
  it("starts with the exact empty state", () => {
    expect(resetScenarioHistory()).toEqual({
      past: [],
      future: [],
      lastGroupKey: null,
      lastRecordedAt: 0,
    });
  });

  it("stores a deep snapshot and does not expose mutable history rows", () => {
    const before = [row("before")];
    const next = [row("after")];
    const state = recordScenarioMutation(resetScenarioHistory(), before, next, mutation("typing", "row-1:text", 100));

    before[0].text = "mutated before";
    next[0].text = "mutated next";
    next[0].structured_data.lines[0] = "mutated nested value";

    expect(state.past).toHaveLength(1);
    expect(state.past[0].rows[0].text).toBe("before");
    expect(state.past[0].rows[0].structured_data.lines[0]).toBe("before");

    const undo = undoScenarioMutation(state, next);
    expect(undo?.rows[0].text).toBe("before");
    if (!undo) throw new Error("expected undo transition");
    undo.rows[0].text = "mutated returned rows";
    undo.state.future[0].rows[0].text = "mutated returned future";
    expect(state.past[0].rows[0].text).toBe("before");
  });

  it("undoes and redoes without mutating rows or state arguments", () => {
    const initial = resetScenarioHistory();
    const first = recordScenarioMutation(initial, [row("one")], [row("two")], mutation("field", "row-1:text", 100));
    const second = recordScenarioMutation(first, [row("two")], [row("three")], mutation("field", "row-1:comment", 200));

    const current = [row("three")];
    const undone = undoScenarioMutation(second, current);
    expect(undone?.rows[0].text).toBe("two");
    expect(current[0].text).toBe("three");
    expect(second.past).toHaveLength(2);
    expect(second.future).toHaveLength(0);
    expect(undone?.state.past).toHaveLength(1);
    expect(undone?.state.future).toHaveLength(1);

    if (!undone) throw new Error("expected undo transition");
    const redone = redoScenarioMutation(undone.state, undone.rows);
    expect(redone?.rows[0].text).toBe("three");
    expect(redone?.state.past).toHaveLength(2);
    expect(redone?.state.future).toHaveLength(0);
    expect(undone.rows[0].text).toBe("two");
  });

  it("returns null when undo or redo has no available transition", () => {
    const empty = resetScenarioHistory();
    expect(undoScenarioMutation(empty, [row("current")])).toBeNull();
    expect(redoScenarioMutation(empty, [row("current")])).toBeNull();
  });

  it("coalesces typing with the same group key through 750 ms", () => {
    const first = recordScenarioMutation(resetScenarioHistory(), [row("a")], [row("ab")], mutation("typing", "row-1:text", 1_000));
    const second = recordScenarioMutation(first, [row("ab")], [row("abc")], mutation("typing", "row-1:text", 1_000 + SCENARIO_TYPING_GROUP_MS));

    expect(second.past).toHaveLength(1);
    expect(second.past[0].rows[0].text).toBe("a");
    expect(second.lastGroupKey).toBe("row-1:text");
    expect(second.lastRecordedAt).toBe(1_000 + SCENARIO_TYPING_GROUP_MS);
    expect(undoScenarioMutation(second, [row("abc")])?.rows[0].text).toBe("a");
  });

  it("starts a new step for a different group key or after 751 ms", () => {
    const first = recordScenarioMutation(resetScenarioHistory(), [row("a")], [row("ab")], mutation("typing", "row-1:text", 1_000));
    const differentKey = recordScenarioMutation(first, [row("ab")], [row("abc")], mutation("typing", "row-2:text", 1_001));
    const delayed = recordScenarioMutation(differentKey, [row("abc")], [row("abcd")], mutation("typing", "row-2:text", 1_001 + SCENARIO_TYPING_GROUP_MS + 1));

    expect(differentKey.past).toHaveLength(2);
    expect(delayed.past).toHaveLength(3);
    expect(delayed.past.map((snapshot) => snapshot.rows[0].text)).toEqual(["a", "ab", "abc"]);
  });

  it("treats formatting, structure, replace, and replace-all as discrete steps", () => {
    const kinds = ["formatting", "structure", "replace", "replace-all"] as const;
    let state = resetScenarioHistory();
    let before = "0";
    for (const [index, kind] of kinds.entries()) {
      const next = String(index + 1);
      state = recordScenarioMutation(state, [row(before)], [row(next)], { kind, timestamp: 500 });
      before = next;
    }

    expect(state.past).toHaveLength(kinds.length);
    expect(state.past.map((snapshot) => snapshot.rows[0].text)).toEqual(["0", "1", "2", "3"]);
    expect(state.lastGroupKey).toBeNull();
    expect(state.lastRecordedAt).toBe(500);
  });

  it("does not add a step or clear future for a no-op mutation", () => {
    const first = recordScenarioMutation(resetScenarioHistory(), [row("a")], [row("b")], mutation("typing", "row-1:text", 100));
    const undone = undoScenarioMutation(first, [row("b")]);
    if (!undone) throw new Error("expected undo transition");

    const noOp = recordScenarioMutation(undone.state, undone.rows, [row("a")], mutation("typing", "row-1:text", 200));
    expect(noOp.past).toHaveLength(0);
    expect(noOp.future).toHaveLength(1);
    expect(noOp.lastGroupKey).toBeNull();
    expect(noOp.lastRecordedAt).toBe(0);
  });

  it("clears future after any real new mutation, including a coalesced one", () => {
    const first = recordScenarioMutation(resetScenarioHistory(), [row("a")], [row("b")], mutation("typing", "row-1:text", 100));
    const second = recordScenarioMutation(first, [row("b")], [row("c")], mutation("typing", "row-1:text", 200));
    const undone = undoScenarioMutation(second, [row("c")]);
    if (!undone) throw new Error("expected undo transition");

    const changed = recordScenarioMutation(undone.state, undone.rows, [row("new")], mutation("typing", "row-1:text", 300));
    expect(changed.future).toEqual([]);
    expect(changed.past).toHaveLength(1);
    expect(changed.past[0].rows[0].text).toBe("a");
  });

  it("keeps only the latest 100 undo steps", () => {
    let state = resetScenarioHistory();
    for (let index = 0; index < SCENARIO_HISTORY_LIMIT + 5; index += 1) {
      state = recordScenarioMutation(
        state,
        [row(String(index), `segment-${index}`)],
        [row(String(index + 1), `segment-${index}`)],
        { kind: "replace", timestamp: index },
      );
    }

    expect(state.past).toHaveLength(SCENARIO_HISTORY_LIMIT);
    expect(state.past[0].rows[0].text).toBe("5");
    expect(state.past.at(-1)?.rows[0].text).toBe(String(SCENARIO_HISTORY_LIMIT + 4));
  });

  it("does not share mutable snapshots between returned states", () => {
    const before = [row("before")];
    const next = [row("next")];
    const first = recordScenarioMutation(resetScenarioHistory(), before, next, mutation("field", "row-1:text", 1));
    const second = recordScenarioMutation(first, next, [row("latest")], mutation("field", "row-1:text", 2_000));

    second.past[0].rows[0].text = "mutated second state";
    expect(first.past[0].rows[0].text).toBe("before");
    expect(before[0].text).toBe("before");
  });
});
