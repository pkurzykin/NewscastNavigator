import type { ScenarioTextTargetKey } from "./scenarioTableModel";
import type { EditorCoreRichTextTarget } from "../editor-core/types";
import type { ScenarioRow } from "./types";

export type ScenarioProseTarget = ScenarioTextTargetKey;

export interface ScenarioTextFieldId {
  segmentUid: string;
  target: ScenarioProseTarget;
}

export interface ScenarioTextFieldController {
  focusRange(from: number, to: number): void;
  setSearchHighlights(ranges: Array<{ from: number; to: number; active: boolean }>): void;
}

export const SCENARIO_PROSE_TARGETS: readonly ScenarioProseTarget[] = [
  "text",
  "geo",
  "speaker_fio",
  "speaker_position",
  "additional_comment",
];

export function scenarioTextFieldKey(field: ScenarioTextFieldId): string {
  return `${field.segmentUid}:${field.target}`;
}

export function readScenarioProse(row: ScenarioRow, target: ScenarioProseTarget): string {
  if (target === "text") return row.text;
  if (target === "geo") {
    return typeof row.structured_data.geo === "string" ? row.structured_data.geo : "";
  }
  if (target === "additional_comment") return row.additional_comment;

  const [fio = "", position = ""] = row.speaker_text.split("\n");
  return target === "speaker_fio" ? fio : position;
}

export function writeScenarioProse(
  row: ScenarioRow,
  target: ScenarioProseTarget,
  richText: EditorCoreRichTextTarget,
): ScenarioRow {
  const next = structuredClone(row);
  next.rich_text = {
    ...next.rich_text,
    schema_version: next.rich_text.schema_version || 1,
    targets: { ...(next.rich_text.targets || {}), [target]: richText },
  };

  if (target === "text") {
    next.text = richText.text;
    if (next.block_type === "zk_geo") {
      next.structured_data = {
        ...next.structured_data,
        text_lines: richText.text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      };
    }
  } else if (target === "geo") {
    next.structured_data = { ...next.structured_data, geo: richText.text };
  } else if (target === "additional_comment") {
    next.additional_comment = richText.text;
  } else {
    const fio = target === "speaker_fio" ? richText.text : readScenarioProse(next, "speaker_fio");
    const position = target === "speaker_position"
      ? richText.text
      : readScenarioProse(next, "speaker_position");
    next.speaker_text = position ? `${fio}\n${position}` : fio;
  }

  return next;
}
