import { describe, expect, it } from "vitest";

import type { ScenarioFormattingTarget } from "../scenario/types";
import { buildSemanticScenarioDiff } from "./semanticScenarioDiff";

describe("buildSemanticScenarioDiff", () => {
  it("projects changed snapshots through the semantic allowlist", () => {
    const before = {
      order_index: 1,
      block_type: "zk_geo",
      text: "Старый текст",
      speaker_text: "",
      file_name: "before.mov",
      tc_in: "00:01",
      tc_out: "00:05",
      additional_comment: "Старый план",
      structured_data: {
        geo: "Староград",
        file_bundles: [
          { file_name: "before.mov", tc_in: "00:01", tc_out: "00:05" },
        ],
        internal_probe: { secret: "не показывать" },
      },
      formatting: { targets: { text: { bold: false } } },
      rich_text: {
        schema_version: 1,
        targets: {
          geo: { text: "Староград", html: "<em>RAW GEO BEFORE</em>" },
          text: { text: "Старый текст", html: "<strong>RAW TEXT BEFORE</strong>" },
        },
      },
      unknown_server_field: { raw: true },
    };
    const after = {
      ...before,
      text: "Новый текст",
      additional_comment: "Новый план",
      structured_data: {
        ...before.structured_data,
        geo: "Новоград",
        file_bundles: [
          { file_name: "after.mov", tc_in: "00:02", tc_out: "00:06" },
        ],
      },
      rich_text: {
        ...before.rich_text,
        targets: {
          ...before.rich_text.targets,
          geo: { text: "Новоград", html: "<em>RAW GEO AFTER</em>" },
          text: { text: "Новый текст", html: "<strong>RAW TEXT AFTER</strong>" },
        },
      },
    };

    const result = buildSemanticScenarioDiff([{
      segment_uid: "seg_changed",
      kind: "changed",
      moved: false,
      changed_fields: ["text", "structured_data", "additional_comment"],
      before,
      after,
    }]);

    expect(result[0].fields.map((field) => field.key)).toEqual([
      "geo",
      "text",
      "file_bundle",
      "additional_comment",
    ]);
    expect(result[0].fields.find((field) => field.key === "file_bundle")?.before?.text)
      .toBe("before.mov · 00:01–00:05");
    expect(result[0].fields.find((field) => field.key === "geo")).toMatchObject({
      before: { text: "Староград" },
      after: { text: "Новоград" },
    });
    expect(result[0].fields.find((field) => field.key === "text")).toMatchObject({
      before: { text: "Старый текст" },
      after: { text: "Новый текст" },
    });
    expect(JSON.stringify(result)).not.toContain("internal_probe");
    expect(JSON.stringify(result)).not.toContain("unknown_server_field");
  });

  it("splits an СНХ speaker into name and position", () => {
    const [snh] = buildSemanticScenarioDiff([{
      segment_uid: "seg_snh",
      kind: "changed",
      moved: false,
      changed_fields: ["speaker_text"],
      before: { block_type: "snh", speaker_text: "Старое имя\nСтарая должность" },
      after: { block_type: "snh", speaker_text: "Новое имя\nНовая должность" },
    }]);

    expect(snh.fields.map((field) => field.key)).toEqual([
      "speaker_fio",
      "speaker_position",
    ]);
  });

  it("keeps text visible when only its formatting changes", () => {
    const [formatted] = buildSemanticScenarioDiff([{
      segment_uid: "seg_format",
      kind: "changed",
      moved: false,
      changed_fields: ["formatting"],
      before: {
        block_type: "zk",
        text: "Одинаковый текст",
        formatting: { targets: { text: { bold: false } } },
      },
      after: {
        block_type: "zk",
        text: "Одинаковый текст",
        formatting: { targets: { text: { bold: true } } },
      },
    }]);

    expect(formatted.fields.map((field) => field.key)).toEqual(["text"]);
    expect(formatted.fields[0].before?.formatting?.bold).toBe(false);
    expect(formatted.fields[0].after?.formatting?.bold).toBe(true);
  });

  it("projects only allowlisted TipTap text nodes and selection marks into semantic runs", () => {
    const text = "Обычный жирный курсив цвет безопасный";
    const [formatted] = buildSemanticScenarioDiff([{
      segment_uid: "seg_selection_formatting",
      kind: "changed",
      moved: false,
      changed_fields: ["rich_text"],
      before: {
        block_type: "zk",
        text,
        rich_text: {
          schema_version: 1,
          targets: {
            text: {
              editor: "tiptap",
              text,
              html: `<img src="javascript:alert(1)"><style>body{display:none}</style>${text}`,
              doc: {
                type: "doc",
                content: [{
                  type: "paragraph",
                  content: [{ type: "text", text }],
                }],
              },
            },
          },
        },
      },
      after: {
        block_type: "zk",
        text,
        rich_text: {
          schema_version: 1,
          targets: {
            text: {
              editor: "tiptap",
              text,
              html: "<strong>RAW HTML MUST NOT BE USED</strong>",
              doc: {
                type: "doc",
                attrs: { style: "background:url(javascript:alert(1))" },
                content: [{
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Обычный " },
                    { type: "text", text: "жирный", marks: [{ type: "bold" }] },
                    {
                      type: "text",
                      text: " курсив",
                      marks: [{ type: "italic" }, { type: "strike" }],
                    },
                    {
                      type: "text",
                      text: " цвет",
                      marks: [
                        {
                          type: "textStyle",
                          attrs: {
                            fontFamily: "Arial",
                            style: "font-size:999px",
                            unknown: "probe",
                          },
                        },
                        {
                          type: "highlight",
                          attrs: { color: "#ffff00", style: "position:fixed" },
                        },
                      ],
                    },
                    {
                      type: "text",
                      text: " безопасный",
                      marks: [
                        { type: "internalMark", attrs: { style: "display:none" } },
                        {
                          type: "textStyle",
                          attrs: { fontFamily: "url(javascript:alert(1))" },
                        },
                        {
                          type: "highlight",
                          attrs: { color: "expression(alert(1))" },
                        },
                      ],
                    },
                    {
                      type: "image",
                      attrs: {
                        src: "javascript:alert(1)",
                        style: "position:fixed",
                      },
                    },
                  ],
                }],
              },
            },
          },
        },
      },
    }]);

    const value = formatted.fields.find((field) => field.key === "text")?.after;
    expect(value?.text).toBe(text);
    expect(value?.runs?.map((run) => run.text)).toEqual([
      "Обычный ",
      "жирный",
      " курсив",
      " цвет",
      " безопасный",
    ]);
    expect(value?.runs?.[1].formatting).toMatchObject({ bold: true });
    expect(value?.runs?.[2].formatting).toMatchObject({
      italic: true,
      strikethrough: true,
    });
    expect(value?.runs?.[3].formatting).toMatchObject({
      font_family: "Arial",
      fill_color: "#ffff00",
    });
    expect(value?.runs?.[4].formatting).toMatchObject({
      font_family: "PT Sans",
      fill_color: "#ffffff",
      bold: false,
      italic: false,
      strikethrough: false,
    });
    expect(JSON.stringify(formatted)).not.toMatch(
      /RAW HTML|javascript:|expression\(|font-size|position:fixed|display:none|internalMark|unknown/,
    );
  });

  it("preserves editor edge spaces and an empty first paragraph in formatted runs", () => {
    const text = "\n  жирный  ";
    const richText = (marks: Array<{ type: string }>) => ({
      schema_version: 1,
      targets: {
        text: {
          editor: "tiptap",
          text,
          doc: {
            type: "doc",
            content: [
              { type: "paragraph" },
              {
                type: "paragraph",
                content: [{ type: "text", text: "  жирный  ", marks }],
              },
            ],
          },
        },
      },
    });
    const [formatted] = buildSemanticScenarioDiff([{
      segment_uid: "seg_editor_whitespace",
      kind: "changed",
      moved: false,
      changed_fields: ["rich_text"],
      before: {
        block_type: "zk",
        text,
        rich_text: richText([]),
      },
      after: {
        block_type: "zk",
        text,
        rich_text: richText([{ type: "bold" }]),
      },
    }]);

    const field = formatted.fields.find((candidate) => candidate.key === "text");
    expect(field?.before?.text).toBe(text);
    expect(field?.after?.text).toBe(text);
    expect(field?.after?.runs?.map((run) => run.text)).toEqual([
      "\n",
      "  жирный  ",
    ]);
    expect(field?.after?.runs?.[1].formatting?.bold).toBe(true);
  });

  it("projects structured fields only for the block types that display them", () => {
    const semantic = buildSemanticScenarioDiff([
      {
        segment_uid: "seg_plain",
        kind: "added",
        moved: false,
        changed_fields: [],
        before: null,
        after: {
          block_type: "zk",
          text: "Общий текст",
          speaker_text: "Скрытое ФИО\nСкрытая должность",
          additional_comment: "В кадре",
          structured_data: {
            geo: "Скрытое гео",
            file_bundles: [{ file_name: "common.mov", tc_in: "00:01", tc_out: "00:02" }],
          },
          rich_text: {
            targets: {
              geo: { text: "Скрытое rich geo" },
              speaker_fio: { text: "Скрытое rich ФИО" },
              speaker_position: { text: "Скрытая rich должность" },
            },
          },
        },
      },
      {
        segment_uid: "seg_geo",
        kind: "added",
        moved: false,
        changed_fields: [],
        before: null,
        after: {
          block_type: "zk_geo",
          text: "Текст с гео",
          speaker_text: "Скрытое ФИО\nСкрытая должность",
          structured_data: { geo: "Новоград" },
        },
      },
      {
        segment_uid: "seg_snh",
        kind: "added",
        moved: false,
        changed_fields: [],
        before: null,
        after: {
          block_type: "snh",
          text: "Текст СНХ",
          speaker_text: "Марина\nЭксперт",
          structured_data: { geo: "Скрытое гео СНХ" },
        },
      },
    ]);

    expect(semantic[0].fields.map((field) => field.key)).toEqual([
      "block_type",
      "text",
      "file_bundle",
      "additional_comment",
    ]);
    expect(semantic[1].fields.map((field) => field.key)).toEqual([
      "block_type",
      "geo",
      "text",
    ]);
    expect(semantic[2].fields.map((field) => field.key)).toEqual([
      "block_type",
      "speaker_fio",
      "speaker_position",
      "text",
    ]);
    expect(JSON.stringify(semantic)).not.toContain("Скрытое");
  });

  it("preserves an empty speaker FIO before splitting the position line", () => {
    const [snh] = buildSemanticScenarioDiff([{
      segment_uid: "seg_empty_fio",
      kind: "changed",
      moved: false,
      changed_fields: ["speaker_text"],
      before: { block_type: "snh", speaker_text: "\nДолжность" },
      after: { block_type: "snh", speaker_text: "\nНовая должность" },
    }]);

    expect(snh.fields.map((field) => field.key)).toEqual(["speaker_position"]);
    expect(snh.fields[0]).toMatchObject({
      before: { text: "Должность" },
      after: { text: "Новая должность" },
    });
  });

  it("compares only font and fill values that the renderer can display", () => {
    const unknownOnly = buildSemanticScenarioDiff([{
      segment_uid: "seg_unknown_visuals",
      kind: "changed",
      moved: false,
      changed_fields: ["formatting"],
      before: {
        block_type: "zk",
        text: "Без видимой правки",
        formatting: {
          targets: {
            text: { font_family: "url(before)", fill_color: "expression(before)" },
          },
        },
      },
      after: {
        block_type: "zk",
        text: "Без видимой правки",
        formatting: {
          targets: {
            text: { font_family: "url(after)", fill_color: "expression(after)" },
          },
        },
      },
    }]);
    expect(unknownOnly).toEqual([]);

    const [allowedChange] = buildSemanticScenarioDiff([{
      segment_uid: "seg_allowed_visuals",
      kind: "changed",
      moved: false,
      changed_fields: ["formatting"],
      before: {
        block_type: "zk",
        text: "Видимая правка",
        formatting: {
          targets: {
            text: { font_family: "Arial", fill_color: "#ffff00" },
          },
        },
      },
      after: {
        block_type: "zk",
        text: "Видимая правка",
        formatting: {
          targets: {
            text: { font_family: "url(after)", fill_color: "expression(after)" },
          },
        },
      },
    }]);
    expect(allowedChange.fields[0]).toMatchObject({
      key: "text",
      before: {
        formatting: { font_family: "Arial", fill_color: "#ffff00" },
      },
      after: {
        formatting: { font_family: "PT Sans", fill_color: "#ffffff" },
      },
    });
  });

  it("preserves each non-empty file bundle on its own line", () => {
    const [bundles] = buildSemanticScenarioDiff([{
      segment_uid: "seg_bundles",
      kind: "changed",
      moved: false,
      changed_fields: ["structured_data"],
      before: {
        block_type: "zk",
        structured_data: {
          file_bundles: [
            { file_name: "first.mov", tc_in: "00:01", tc_out: "00:05" },
            { file_name: "second.mov", tc_in: "00:06", tc_out: "00:10" },
          ],
        },
      },
      after: {
        block_type: "zk",
        structured_data: {
          file_bundles: [
            { file_name: "updated.mov", tc_in: "00:11", tc_out: "00:15" },
          ],
        },
      },
    }]);

    expect(bundles.fields.find((field) => field.key === "file_bundle")).toMatchObject({
      before: { text: "first.mov · 00:01–00:05\nsecond.mov · 00:06–00:10" },
      after: { text: "updated.mov · 00:11–00:15" },
    });
  });

  it("filters formatting changes outside the known semantic keys", () => {
    const beforeFormatting: ScenarioFormattingTarget & Record<string, unknown> = {
      unknown_formatting_key: "before",
    };
    const afterFormatting: ScenarioFormattingTarget & Record<string, unknown> = {
      unknown_formatting_key: "after",
    };

    const technicalFormatting = buildSemanticScenarioDiff([{
      segment_uid: "seg_unknown_formatting",
      kind: "changed",
      moved: false,
      changed_fields: ["formatting"],
      before: {
        block_type: "zk",
        text: "Без изменений",
        formatting: { targets: { text: beforeFormatting } },
      },
      after: {
        block_type: "zk",
        text: "Без изменений",
        formatting: { targets: { text: afterFormatting } },
      },
    }]);

    expect(technicalFormatting).toEqual([]);
  });

  it("replaces an unknown block code with a safe label", () => {
    const [unknownBlock] = buildSemanticScenarioDiff([{
      segment_uid: "seg_unknown_block",
      kind: "added",
      moved: false,
      changed_fields: [],
      before: null,
      after: { block_type: "internal_block_code", text: "Новый текст" },
    }]);

    expect(unknownBlock.fields.find((field) => field.key === "block_type")).toMatchObject({
      before: null,
      after: { text: "Неизвестный тип" },
    });
    expect(JSON.stringify(unknownBlock)).not.toContain("internal_block_code");
  });

  it("preserves semantic additions, removals, and moves", () => {
    const semantic = buildSemanticScenarioDiff([
      {
        segment_uid: "seg_added",
        kind: "added",
        moved: false,
        changed_fields: [],
        before: null,
        after: { order_index: 2, block_type: "zk", text: "Добавлено" },
      },
      {
        segment_uid: "seg_removed",
        kind: "removed",
        moved: false,
        changed_fields: [],
        before: { order_index: 4, block_type: "life", text: "Удалено" },
        after: null,
      },
      {
        segment_uid: "seg_moved",
        kind: "moved",
        moved: true,
        changed_fields: [],
        before: { order_index: 1, block_type: "zk", text: "Без правки" },
        after: { order_index: 3, block_type: "zk", text: "Без правки" },
      },
    ]);

    expect(semantic.map((change) => change.kind)).toEqual([
      "added",
      "removed",
      "moved",
    ]);
    expect(semantic[0].fields.map((field) => field.key)).toEqual([
      "block_type",
      "text",
    ]);
    expect(semantic[2].fields).toEqual([]);
    expect([semantic[2].before_order, semantic[2].after_order]).toEqual([1, 3]);
  });

  it("drops changes which only affect unknown technical fields", () => {
    const technicalOnly = buildSemanticScenarioDiff([{
      segment_uid: "seg_unknown",
      kind: "changed",
      moved: false,
      changed_fields: ["unknown_server_field"],
      before: { block_type: "zk", text: "Без изменений", unknown_server_field: 1 },
      after: { block_type: "zk", text: "Без изменений", unknown_server_field: 2 },
    }]);

    expect(technicalOnly).toEqual([]);
  });
});
