import { describe, expect, it } from "vitest";

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
          geo: { text: "Староград", html: "<em>Староград</em>" },
          text: { text: "Старый текст", html: "Старый текст" },
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
          geo: { text: "Новоград", html: "<em>Новоград</em>" },
          text: { text: "Новый текст", html: "Новый текст" },
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
