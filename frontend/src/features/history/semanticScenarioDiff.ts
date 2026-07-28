import type { ScenarioFormattingTarget } from "../scenario/types";
import { normalizeEditorCoreText } from "../editor-core/serializers";
import {
  FILL_COLOR_OPTIONS,
  FONT_OPTIONS,
} from "../scenario/scenarioTableModel";
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
  runs?: SemanticTextRun[];
}

export interface SemanticTextRun {
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

const ALLOWED_FONTS = new Set<string>(FONT_OPTIONS);
const ALLOWED_FILL_COLORS = new Set<string>(
  FILL_COLOR_OPTIONS.map((option) => option.value),
);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asEditorText(value: unknown): string {
  return typeof value === "string" ? normalizeEditorCoreText(value) : "";
}

function targetText(snapshot: ScenarioRowSnapshot, target: string): string {
  const richText = asRecord(snapshot.rich_text);
  const targets = asRecord(richText.targets);
  return asEditorText(asRecord(targets[target]).text);
}

function valueOf(
  text: string,
  formatting?: ScenarioFormattingTarget,
  runs?: SemanticTextRun[],
): SemanticValue | null {
  return text
    ? {
        text,
        ...(formatting ? { formatting } : {}),
        ...(runs?.length ? { runs } : {}),
      }
    : null;
}

function formattingFor(
  snapshot: ScenarioRowSnapshot,
  target: "geo" | "speaker_fio" | "speaker_position" | "text",
): ScenarioFormattingTarget {
  const blockType = asText(snapshot.block_type);
  const explicit = asRecord(asRecord(asRecord(snapshot.formatting).targets)[target]);
  const explicitFont = asText(explicit.font_family);
  const explicitFill = asText(explicit.fill_color);
  return {
    font_family: ALLOWED_FONTS.has(explicitFont) ? explicitFont : "PT Sans",
    bold: typeof explicit.bold === "boolean"
      ? explicit.bold
      : blockType === "snh" && target !== "text",
    italic: typeof explicit.italic === "boolean"
      ? explicit.italic
      : blockType === "life"
        || (blockType === "zk_geo" && target === "geo")
        || blockType === "snh",
    strikethrough: explicit.strikethrough === true,
    fill_color: ALLOWED_FILL_COLORS.has(explicitFill) ? explicitFill : "#ffffff",
  };
}

function sameFormatting(
  before: ScenarioFormattingTarget | undefined,
  after: ScenarioFormattingTarget | undefined,
): boolean {
  return before?.font_family === after?.font_family
    && before?.bold === after?.bold
    && before?.italic === after?.italic
    && before?.strikethrough === after?.strikethrough
    && before?.fill_color === after?.fill_color;
}

function formattingWithMarks(
  base: ScenarioFormattingTarget,
  rawMarks: unknown,
): ScenarioFormattingTarget {
  const formatting = { ...base };
  if (!Array.isArray(rawMarks)) return formatting;

  rawMarks.forEach((rawMark) => {
    const mark = asRecord(rawMark);
    const type = mark.type;
    if (type === "bold") {
      formatting.bold = true;
      return;
    }
    if (type === "italic") {
      formatting.italic = true;
      return;
    }
    if (type === "strike") {
      formatting.strikethrough = true;
      return;
    }
    const attrs = asRecord(mark.attrs);
    if (type === "textStyle") {
      const fontFamily = asText(attrs.fontFamily);
      if (ALLOWED_FONTS.has(fontFamily)) formatting.font_family = fontFamily;
      return;
    }
    if (type === "highlight") {
      const fillColor = asText(attrs.color);
      if (ALLOWED_FILL_COLORS.has(fillColor)) formatting.fill_color = fillColor;
    }
  });
  return formatting;
}

function appendRun(
  runs: SemanticTextRun[],
  text: string,
  formatting: ScenarioFormattingTarget,
): void {
  if (!text) return;
  const previous = runs.at(-1);
  if (previous && sameFormatting(previous.formatting, formatting)) {
    previous.text += text;
    return;
  }
  runs.push({ text, formatting });
}

function normalizeRuns(runs: SemanticTextRun[]): SemanticTextRun[] {
  const normalized = runs
    .map((run) => ({
      ...run,
      text: run.text.replace(/\u00a0/g, " ").replace(/\r/g, ""),
    }))
    .filter((run) => run.text.length > 0);
  while (normalized.length > 0) {
    const lastRun = normalized.at(-1)!;
    const textWithoutTrailingNewlines = lastRun.text.replace(/\n+$/g, "");
    if (textWithoutTrailingNewlines === lastRun.text) break;
    if (textWithoutTrailingNewlines) {
      lastRun.text = textWithoutTrailingNewlines;
      break;
    }
    normalized.pop();
  }

  return normalized.reduce<SemanticTextRun[]>((merged, run) => {
    const previous = merged.at(-1);
    if (previous && sameFormatting(previous.formatting, run.formatting)) {
      previous.text += run.text;
    } else {
      merged.push(run);
    }
    return merged;
  }, []);
}

function tipTapRunsFor(
  snapshot: ScenarioRowSnapshot,
  target: "geo" | "speaker_fio" | "speaker_position" | "text",
  baseFormatting: ScenarioFormattingTarget,
  expectedText: string,
): SemanticTextRun[] {
  const richText = asRecord(snapshot.rich_text);
  const targetValue = asRecord(asRecord(richText.targets)[target]);
  const doc = asRecord(targetValue.doc);
  if (doc.type !== "doc" || !Array.isArray(doc.content)) return [];

  const runs: SemanticTextRun[] = [];
  const paragraphs = doc.content
    .map(asRecord)
    .filter((node) => node.type === "paragraph");
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (Array.isArray(paragraph.content)) {
      paragraph.content.forEach((rawNode) => {
        const node = asRecord(rawNode);
        if (node.type === "hardBreak") {
          appendRun(runs, "\n", baseFormatting);
        } else if (node.type === "text" && typeof node.text === "string") {
          appendRun(
            runs,
            node.text,
            formattingWithMarks(baseFormatting, node.marks),
          );
        }
      });
    }
    if (paragraphIndex < paragraphs.length - 1) {
      appendRun(runs, "\n", baseFormatting);
    }
  });

  const normalized = normalizeRuns(runs);
  const projectedText = normalized.map((run) => run.text).join("");
  if (!projectedText || (expectedText && projectedText !== expectedText)) return [];
  return normalized;
}

function targetValue(
  snapshot: ScenarioRowSnapshot,
  target: "geo" | "speaker_fio" | "speaker_position" | "text",
  fallbackText: string,
): SemanticValue | null {
  const text = targetText(snapshot, target) || asEditorText(fallbackText);
  const formatting = formattingFor(snapshot, target);
  const runs = tipTapRunsFor(snapshot, target, formatting, text);
  return valueOf(runs.length ? runs.map((run) => run.text).join("") : text, formatting, runs);
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

  const blockType = asText(snapshot.block_type);
  const structured = asRecord(snapshot.structured_data);
  const rawSpeakerText = typeof snapshot.speaker_text === "string"
    ? snapshot.speaker_text
    : "";
  const [rawFallbackFio = "", rawFallbackPosition = ""] =
    rawSpeakerText.split(/\r?\n/, 2);
  const fallbackFio = rawFallbackFio.trim();
  const fallbackPosition = rawFallbackPosition.trim();

  return {
    block_type: valueOf(BLOCK_LABELS[blockType] || "Неизвестный тип"),
    geo: blockType === "zk_geo"
      ? targetValue(snapshot, "geo", asEditorText(structured.geo))
      : null,
    speaker_fio: blockType === "snh"
      ? targetValue(snapshot, "speaker_fio", fallbackFio)
      : null,
    speaker_position: blockType === "snh"
      ? targetValue(snapshot, "speaker_position", fallbackPosition)
      : null,
    text: targetValue(snapshot, "text", asEditorText(snapshot.text)),
    file_bundle: valueOf(fileBundleText(snapshot)),
    additional_comment: valueOf(asText(snapshot.additional_comment)),
  };
}

function effectiveRuns(value: SemanticValue | null): SemanticTextRun[] {
  if (!value) return [];
  return value.runs?.length
    ? value.runs
    : [{ text: value.text, ...(value.formatting ? { formatting: value.formatting } : {}) }];
}

function sameValue(before: SemanticValue | null, after: SemanticValue | null): boolean {
  if (before?.text !== after?.text) return false;
  const beforeRuns = effectiveRuns(before);
  const afterRuns = effectiveRuns(after);
  return beforeRuns.length === afterRuns.length
    && beforeRuns.every((run, index) => (
      run.text === afterRuns[index].text
      && sameFormatting(run.formatting, afterRuns[index].formatting)
    ));
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
