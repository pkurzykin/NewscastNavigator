import { describe, expect, it } from "vitest";

import { findScenarioMatches, replaceScenarioMatches } from "./scenarioSearch";
import type { ScenarioRow } from "./types";

function row(
  segmentUid: string,
  orderIndex: number,
  overrides: Partial<ScenarioRow> = {},
): ScenarioRow {
  return {
    segment_uid: segmentUid,
    order_index: orderIndex,
    block_type: "snh",
    text: "",
    speaker_text: "",
    file_name: "",
    tc_in: "",
    tc_out: "",
    additional_comment: "",
    structured_data: {},
    formatting: {},
    rich_text: { schema_version: 1, targets: {} },
    ...overrides,
  };
}

describe("scenario prose search", () => {
  it("walks rows visually, then prose targets, and assigns final ordinals", () => {
    const rows = [
      row("seg-first", 20, {
        text: "мир text",
        speaker_text: "Мир ФИО\nмир должность",
        additional_comment: "МИР комментарий",
        structured_data: { geo: "мир гео" },
      }),
      row("seg-second", 10, { text: "ещё мир" }),
    ];

    expect(findScenarioMatches(rows, "мир", false)).toEqual([
      { segmentUid: "seg-first", target: "text", from: 0, to: 3, ordinal: 0 },
      { segmentUid: "seg-first", target: "geo", from: 0, to: 3, ordinal: 1 },
      { segmentUid: "seg-first", target: "speaker_fio", from: 0, to: 3, ordinal: 2 },
      { segmentUid: "seg-first", target: "speaker_position", from: 0, to: 3, ordinal: 3 },
      { segmentUid: "seg-first", target: "additional_comment", from: 0, to: 3, ordinal: 4 },
      { segmentUid: "seg-second", target: "text", from: 4, to: 7, ordinal: 5 },
    ]);
  });

  it("uses exact case only when matchCase is enabled", () => {
    const rows = [row("seg-case", 1, { text: "Текст текст ТЕКСТ" })];

    expect(findScenarioMatches(rows, "Текст", false).map(({ from, to }) => ({ from, to })))
      .toEqual([{ from: 0, to: 5 }, { from: 6, to: 11 }, { from: 12, to: 17 }]);
    expect(findScenarioMatches(rows, "Текст", true).map(({ from, to }) => ({ from, to })))
      .toEqual([{ from: 0, to: 5 }]);
  });

  it("treats the query literally and returns non-overlapping UTF-16 ranges left-to-right", () => {
    const rows = [row("seg-literal", 1, { text: "😀..ааа" })];

    expect(findScenarioMatches(rows, ".", true).map(({ from, to }) => ({ from, to })))
      .toEqual([{ from: 2, to: 3 }, { from: 3, to: 4 }]);
    expect(findScenarioMatches(rows, "аа", true).map(({ from, to }) => ({ from, to })))
      .toEqual([{ from: 4, to: 6 }]);
  });

  it("returns no matches for an empty query or technical and metadata values", () => {
    const rows = [row("seg-tech", 1, {
      file_name: "секрет",
      tc_in: "секрет",
      tc_out: "секрет",
      structured_data: {
        title: "секрет",
        rubric: "секрет",
        metadata: "секрет",
      },
    })];

    expect(findScenarioMatches(rows, "", false)).toEqual([]);
    expect(findScenarioMatches(rows, "секрет", false)).toEqual([]);
  });

  it("replaces grouped prose ranges purely and keeps plain and rich targets consistent", () => {
    const rows = [row("seg-replace", 1, {
      block_type: "zk_geo",
      text: "мир и мир",
      file_name: "мир.mov",
      tc_in: "мир",
      tc_out: "мир",
      structured_data: { geo: "мир", text_lines: ["мир и мир"] },
      rich_text: {
        schema_version: 1,
        targets: {
          text: {
            editor: "tiptap",
            text: "мир и мир",
            html: "<p><strong>мир</strong> и мир</p>",
            doc: {
              type: "doc",
              content: [{
                type: "paragraph",
                content: [
                  { type: "text", marks: [{ type: "bold" }], text: "мир" },
                  { type: "text", text: " и мир" },
                ],
              }],
            },
          },
        },
      },
    }), row("seg-speaker", 2, {
      speaker_text: "мир\nмир",
    }), row("seg-comment", 3, {
      additional_comment: "мир",
    })];
    const matches = findScenarioMatches(rows, "мир", false);

    const result = replaceScenarioMatches(rows, matches, "свет");

    expect(result).not.toBe(rows);
    expect(result[0]).not.toBe(rows[0]);
    expect(result[0]).toMatchObject({
      text: "свет и свет",
      file_name: "мир.mov",
      tc_in: "мир",
      tc_out: "мир",
      structured_data: { geo: "свет", text_lines: ["свет и свет"] },
    });
    expect(result[1].speaker_text).toBe("свет\nсвет");
    expect(result[2].additional_comment).toBe("свет");
    expect(result[0].rich_text.targets?.text).toEqual({
      editor: "tiptap",
      text: "свет и свет",
      html: "<p><strong>свет</strong> и свет</p>",
      doc: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "свет" },
            { type: "text", text: " и свет" },
          ],
        }],
      },
    });
    expect(rows[0].text).toBe("мир и мир");
    expect(rows[0].rich_text.targets?.text?.html).toBe("<p><strong>мир</strong> и мир</p>");
  });

  it("ignores unknown, stale, overlapping, and out-of-range match groups fail-safe", () => {
    const rows = [
      row("seg-safe", 1, {
        text: "кот кот",
        additional_comment: "кот",
        rich_text: {
          schema_version: 1,
          targets: {
            text: { editor: "tiptap", text: "устарело", html: "<p>устарело</p>" },
          },
        },
      }),
      row("seg-valid", 2, { text: "кот" }),
    ];
    const unsafeMatches = [
      { segmentUid: "missing", target: "text" as const, from: 0, to: 3, ordinal: 0 },
      { segmentUid: "seg-safe", target: "file_name" as never, from: 0, to: 3, ordinal: 0 },
      { segmentUid: "seg-safe", target: "text" as const, from: 0, to: 3, ordinal: 1 },
      { segmentUid: "seg-safe", target: "text" as const, from: 2, to: 5, ordinal: 2 },
      { segmentUid: "seg-safe", target: "additional_comment" as const, from: 0, to: 99, ordinal: 3 },
      { segmentUid: "seg-valid", target: "text" as const, from: 0, to: 3, ordinal: 4 },
    ];

    const result = replaceScenarioMatches(rows, unsafeMatches, "пёс");

    expect(result[0]).toEqual(rows[0]);
    expect(result[1].text).toBe("пёс");
    expect(result[1].rich_text.targets?.text?.text).toBe("пёс");
  });

  it("ignores a stale rich document even when its cached text matches the plain backing field", () => {
    const rows = [row("seg-stale-doc", 1, {
      text: "кот",
      rich_text: {
        schema_version: 1,
        targets: {
          text: {
            editor: "tiptap",
            text: "кот",
            html: "<p>пёс</p>",
            doc: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "пёс" }] }],
            },
          },
        },
      },
    })];

    expect(replaceScenarioMatches(rows, [
      { segmentUid: "seg-stale-doc", target: "text", from: 0, to: 3, ordinal: 0 },
    ], "лиса")).toEqual(rows);
  });
});
