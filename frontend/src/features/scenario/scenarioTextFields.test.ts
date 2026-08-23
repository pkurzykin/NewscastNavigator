import { describe, expect, it } from "vitest";

import {
  SCENARIO_PROSE_TARGETS,
  readScenarioProse,
  scenarioTextFieldKey,
} from "./scenarioTextFields";
import type { ScenarioRow } from "./types";

function row(overrides: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    segment_uid: "seg-alpha",
    order_index: 1,
    block_type: "snh",
    text: "Основной текст",
    speaker_text: "Анна\nРедактор\nлишняя строка",
    file_name: "FILE_SEARCH_ME",
    tc_in: "00:01",
    tc_out: "00:02",
    additional_comment: "В кадре",
    structured_data: { geo: "Москва" },
    formatting: {},
    rich_text: { schema_version: 1, targets: {} },
    ...overrides,
  };
}

describe("scenario prose field registry", () => {
  it("keeps the approved five prose targets in deterministic visual order", () => {
    expect(SCENARIO_PROSE_TARGETS).toEqual([
      "text",
      "geo",
      "speaker_fio",
      "speaker_position",
      "additional_comment",
    ]);
  });

  it("reads every prose backing field without exposing technical fields", () => {
    const source = row();

    expect(SCENARIO_PROSE_TARGETS.map((target) => readScenarioProse(source, target))).toEqual([
      "Основной текст",
      "Москва",
      "Анна",
      "Редактор",
      "В кадре",
    ]);
  });

  it("builds an exact stable key from the segment uid and target", () => {
    expect(scenarioTextFieldKey({ segmentUid: "seg-alpha", target: "speaker_position" }))
      .toBe("seg-alpha:speaker_position");
  });
});
