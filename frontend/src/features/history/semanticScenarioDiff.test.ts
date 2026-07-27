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
