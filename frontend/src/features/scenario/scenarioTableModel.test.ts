import { describe, expect, it } from "vitest";

import {
  changeScenarioRowBlockType,
  defaultScenarioFormatting,
  scenarioFormatting,
} from "./scenarioTableModel";
import type { ScenarioRow } from "./types";

function scenarioRow(overrides: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    segment_uid: "segment-geo-formatting",
    order_index: 1,
    block_type: "zk_geo",
    text: "Текст географического блока",
    speaker_text: "",
    file_name: "synthetic.mov",
    tc_in: "00:01",
    tc_out: "00:05",
    additional_comment: "Синтетический комментарий",
    structured_data: {
      geo: "Тестоград",
      text_lines: ["Текст географического блока"],
      file_bundles: [{ file_name: "synthetic.mov", tc_in: "00:01", tc_out: "00:05" }],
    },
    formatting: {},
    rich_text: {
      schema_version: 1,
      targets: {
        geo: { editor: "tiptap", text: "Тестоград", html: "<em>Тестоград</em>" },
        text: {
          editor: "tiptap",
          text: "Текст географического блока",
          html: "Текст географического блока",
        },
      },
    },
    ...overrides,
  };
}

describe("scenario formatting defaults", () => {
  it("defaults GEO to bold italic without changing the text target", () => {
    const row = scenarioRow();

    expect(defaultScenarioFormatting(row, "geo")).toEqual({
      font_family: "PT Sans",
      bold: true,
      italic: true,
      strikethrough: false,
      fill_color: "#ffffff",
    });
    expect(defaultScenarioFormatting(row, "text")).toEqual({
      font_family: "PT Sans",
      bold: false,
      italic: false,
      strikethrough: false,
      fill_color: "#ffffff",
    });
  });

  it.each([
    ["podvodka text", "podvodka", "text", false, false],
    ["life text", "life", "text", false, true],
    ["snh fio", "snh", "speaker_fio", true, true],
    ["snh position", "snh", "speaker_position", true, true],
    ["snh text", "snh", "text", false, true],
  ] as const)(
    "keeps the existing %s defaults",
    (_label, blockType, target, bold, italic) => {
      const formatting = defaultScenarioFormatting(
        scenarioRow({ block_type: blockType }),
        target,
      );
      expect({ bold: formatting.bold, italic: formatting.italic }).toEqual({ bold, italic });
    },
  );

  it("keeps explicit GEO overrides over the new defaults", () => {
    const row = scenarioRow({
      formatting: {
        targets: {
          geo: {
            font_family: "Georgia",
            bold: false,
            italic: true,
            strikethrough: true,
            fill_color: "#ffff00",
          },
        },
      },
    });

    expect(scenarioFormatting(row, "geo")).toEqual({
      font_family: "Georgia",
      bold: false,
      italic: true,
      strikethrough: true,
      fill_color: "#ffff00",
    });
  });

  it("gives a converted ZK row the GEO default without losing text or file bundles", () => {
    const source = scenarioRow({
      block_type: "zk",
      structured_data: {
        file_bundles: [{ file_name: "synthetic.mov", tc_in: "00:01", tc_out: "00:05" }],
      },
      formatting: { targets: { text: { font_family: "Arial", bold: true } } },
      rich_text: {
        schema_version: 1,
        targets: {
          text: {
            editor: "tiptap",
            text: "Текст географического блока",
            html: "<strong>Текст географического блока</strong>",
          },
        },
      },
    });

    const converted = changeScenarioRowBlockType(source, "zk_geo");

    expect(converted.text).toBe("Текст географического блока");
    expect(converted.structured_data).toEqual({
      geo: "",
      text_lines: ["Текст географического блока"],
      file_bundles: [{ file_name: "synthetic.mov", tc_in: "00:01", tc_out: "00:05" }],
    });
    expect(converted.rich_text.targets?.text).toEqual(source.rich_text.targets?.text);
    expect(converted.rich_text.targets?.geo).toEqual({ editor: "legacy_html", text: "", html: "" });
    expect(scenarioFormatting(converted, "text")).toMatchObject({
      font_family: "Arial",
      bold: true,
      italic: false,
    });
    expect(scenarioFormatting(converted, "geo")).toMatchObject({ bold: true, italic: true });
  });
});
