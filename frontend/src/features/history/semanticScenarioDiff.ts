import type { ScenarioFormattingTarget } from "../scenario/types";
import type { ScenarioRowDiff, ScenarioRowSnapshot } from "./types";

export type SemanticFieldKey =
  | "block_type"
  | "geo"
  | "speaker_fio"
  | "speaker_position"
  | "text"
  | "file_bundle"
  | "additional_comment";

export interface SemanticValue {
  text: string;
  formatting?: ScenarioFormattingTarget;
}

export interface SemanticFieldDiff {
  key: SemanticFieldKey;
  label: string;
  before: SemanticValue | null;
  after: SemanticValue | null;
}

export interface SemanticRowDiff {
  segment_uid: string;
  kind: ScenarioRowDiff["kind"];
  moved: boolean;
  before_order: number | null;
  after_order: number | null;
  fields: SemanticFieldDiff[];
}

const FIELD_ORDER: Array<{ key: SemanticFieldKey; label: string }> = [
  { key: "block_type", label: "Тип блока" },
  { key: "geo", label: "Гео" },
  { key: "speaker_fio", label: "ФИО" },
  { key: "speaker_position", label: "Должность" },
  { key: "text", label: "Текст" },
  { key: "file_bundle", label: "Имя файла / TC" },
  { key: "additional_comment", label: "В кадре" },
];

const BLOCK_LABELS: Record<string, string> = {
  podvodka: "Подводка",
  zk: "ЗК",
  zk_geo: "ЗК+гео",
  life: "Лайф",
  snh: "СНХ",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function targetText(snapshot: ScenarioRowSnapshot, target: string): string {
  const richText = asRecord(snapshot.rich_text);
  const targets = asRecord(richText.targets);
  return asText(asRecord(targets[target]).text);
}

function valueOf(text: string, formatting?: ScenarioFormattingTarget): SemanticValue | null {
  return text ? { text, ...(formatting ? { formatting } : {}) } : null;
}

function formattingFor(
  snapshot: ScenarioRowSnapshot,
  target: "geo" | "speaker_fio" | "speaker_position" | "text",
): ScenarioFormattingTarget {
  const blockType = asText(snapshot.block_type);
  const explicit = asRecord(asRecord(asRecord(snapshot.formatting).targets)[target]);
  return {
    font_family: asText(explicit.font_family) || "PT Sans",
    bold: typeof explicit.bold === "boolean"
      ? explicit.bold
      : blockType === "snh" && target !== "text",
    italic: typeof explicit.italic === "boolean"
      ? explicit.italic
      : blockType === "life"
        || (blockType === "zk_geo" && target === "geo")
        || blockType === "snh",
    strikethrough: explicit.strikethrough === true,
    fill_color: asText(explicit.fill_color) || "#ffffff",
  };
}

function fileBundleText(snapshot: ScenarioRowSnapshot): string {
  const structured = asRecord(snapshot.structured_data);
  const rawBundles = Array.isArray(structured.file_bundles)
    ? structured.file_bundles
    : [{
        file_name: snapshot.file_name,
        tc_in: snapshot.tc_in,
        tc_out: snapshot.tc_out,
      }];

  return rawBundles.flatMap((raw) => {
    const bundle = asRecord(raw);
    const fileName = asText(bundle.file_name);
    const tcIn = asText(bundle.tc_in);
    const tcOut = asText(bundle.tc_out);
    const timecode = [tcIn, tcOut].filter(Boolean).join("–");
    const line = [fileName, timecode].filter(Boolean).join(" · ");
    return line ? [line] : [];
  }).join("\n");
}

function semanticValues(
  snapshot: ScenarioRowSnapshot | null,
): Record<SemanticFieldKey, SemanticValue | null> {
  if (!snapshot) {
    return Object.fromEntries(
      FIELD_ORDER.map(({ key }) => [key, null]),
    ) as Record<SemanticFieldKey, null>;
  }

  const structured = asRecord(snapshot.structured_data);
  const [fallbackFio = "", fallbackPosition = ""] =
    asText(snapshot.speaker_text).split(/\r?\n/, 2);

  return {
    block_type: valueOf(BLOCK_LABELS[asText(snapshot.block_type)] || "Неизвестный тип"),
    geo: valueOf(
      targetText(snapshot, "geo") || asText(structured.geo),
      formattingFor(snapshot, "geo"),
    ),
    speaker_fio: valueOf(
      targetText(snapshot, "speaker_fio") || fallbackFio,
      formattingFor(snapshot, "speaker_fio"),
    ),
    speaker_position: valueOf(
      targetText(snapshot, "speaker_position") || fallbackPosition,
      formattingFor(snapshot, "speaker_position"),
    ),
    text: valueOf(
      targetText(snapshot, "text") || asText(snapshot.text),
      formattingFor(snapshot, "text"),
    ),
    file_bundle: valueOf(fileBundleText(snapshot)),
    additional_comment: valueOf(asText(snapshot.additional_comment)),
  };
}

function sameValue(before: SemanticValue | null, after: SemanticValue | null): boolean {
  return before?.text === after?.text
    && before?.formatting?.font_family === after?.formatting?.font_family
    && before?.formatting?.bold === after?.formatting?.bold
    && before?.formatting?.italic === after?.formatting?.italic
    && before?.formatting?.strikethrough === after?.formatting?.strikethrough
    && before?.formatting?.fill_color === after?.formatting?.fill_color;
}

function buildFields(
  before: ScenarioRowSnapshot | null,
  after: ScenarioRowSnapshot | null,
): SemanticFieldDiff[] {
  const beforeValues = semanticValues(before);
  const afterValues = semanticValues(after);

  return FIELD_ORDER.flatMap(({ key, label }) => (
    sameValue(beforeValues[key], afterValues[key])
      ? []
      : [{ key, label, before: beforeValues[key], after: afterValues[key] }]
  ));
}

export function buildSemanticScenarioDiff(changes: ScenarioRowDiff[]): SemanticRowDiff[] {
  return changes
    .map((change) => ({
      segment_uid: change.segment_uid,
      kind: change.kind,
      moved: change.moved,
      before_order: change.before?.order_index ?? null,
      after_order: change.after?.order_index ?? null,
      fields: buildFields(change.before, change.after),
    }))
    .filter((change) => change.moved || change.fields.length > 0);
}
