import { describe, expect, it } from "vitest";

import { reorderScenarioRows } from "./scenarioRowReorder";
import type { ScenarioRow } from "./types";

function row(uid: string, orderIndex: number): ScenarioRow {
  return {
    segment_uid: uid,
    order_index: orderIndex,
    block_type: "zk",
    text: uid,
    speaker_text: "",
    file_name: "",
    tc_in: "",
    tc_out: "",
    additional_comment: "",
    structured_data: {},
    formatting: {},
    rich_text: { schema_version: 1, targets: {} },
  };
}

const sourceRows = [row("a", 1), row("b", 2), row("c", 3), row("d", 4)];

describe("reorderScenarioRows", () => {
  it.each([
    ["before upwards", "c", "a", "before", ["c", "a", "b", "d"]],
    ["after upwards", "c", "a", "after", ["a", "c", "b", "d"]],
    ["before downwards", "a", "c", "before", ["b", "a", "c", "d"]],
    ["after downwards", "a", "c", "after", ["b", "c", "a", "d"]],
    ["to start", "d", "a", "before", ["d", "a", "b", "c"]],
    ["to end", "a", "d", "after", ["b", "c", "d", "a"]],
  ])("moves %s", (_name, sourceUid, targetUid, edge, expected) => {
    const result = reorderScenarioRows(
      sourceRows,
      sourceUid,
      targetUid,
      edge as "before" | "after",
    );
    expect(result.map((item) => item.segment_uid)).toEqual(expected);
    expect(result.map((item) => item.order_index)).toEqual([1, 2, 3, 4]);
    expect(sourceRows.map((item) => item.segment_uid)).toEqual(["a", "b", "c", "d"]);
    expect(sourceRows.map((item) => item.order_index)).toEqual([1, 2, 3, 4]);
  });

  it("returns the original array for unknown uid and drop on the source", () => {
    expect(reorderScenarioRows(sourceRows, "missing", "b", "before")).toBe(sourceRows);
    expect(reorderScenarioRows(sourceRows, "a", "missing", "after")).toBe(sourceRows);
    expect(reorderScenarioRows(sourceRows, "b", "b", "before")).toBe(sourceRows);
    expect(reorderScenarioRows(sourceRows, "b", "b", "after")).toBe(sourceRows);
  });
});
