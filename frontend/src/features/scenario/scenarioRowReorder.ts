import { withOrderIndexes } from "./rowIdentity";
import type { ScenarioRow } from "./types";

export function reorderScenarioRows(
  rows: ScenarioRow[],
  sourceUid: string,
  targetUid: string,
  edge: "before" | "after",
): ScenarioRow[] {
  const sourceIndex = rows.findIndex((row) => row.segment_uid === sourceUid);
  const targetIndex = rows.findIndex((row) => row.segment_uid === targetUid);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return rows;

  const next = rows.filter((_, index) => index !== sourceIndex);
  const targetIndexAfterRemoval = next.findIndex((row) => row.segment_uid === targetUid);
  const insertionIndex = targetIndexAfterRemoval + (edge === "after" ? 1 : 0);
  next.splice(insertionIndex, 0, rows[sourceIndex]);

  if (next.every((row, index) => row.segment_uid === rows[index]?.segment_uid)) return rows;
  return withOrderIndexes(next);
}
