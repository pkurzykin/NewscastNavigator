import type { ScenarioRow } from "./types";

function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function createSegmentUid(): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : fallbackUuid();
  return `seg_${uuid}`;
}

export function withOrderIndexes(rows: ScenarioRow[]): ScenarioRow[] {
  return rows.map((row, index) => ({ ...row, order_index: index + 1 }));
}

export function createEmptyScenarioRow(orderIndex: number): ScenarioRow {
  return {
    segment_uid: createSegmentUid(),
    order_index: orderIndex,
    block_type: "zk",
    text: "",
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

export function cloneScenarioRow(row: ScenarioRow): ScenarioRow {
  return structuredClone(row);
}
