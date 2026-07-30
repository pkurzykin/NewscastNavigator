import type { ScenarioFormattingTarget, ScenarioRow } from "./types";
import type { EditorCoreRichTextTarget } from "../editor-core/types";

export type EditorColumnKey =
  | "order_index"
  | "block_type"
  | "text"
  | "file_bundle"
  | "additional_comment";

export type FormatTargetKey = "text" | "geo" | "speaker_fio" | "speaker_position";

export interface FileBundleItem {
  file_name: string;
  tc_in: string;
  tc_out: string;
}

export const BLOCK_OPTIONS = [
  { value: "podvodka", label: "Подводка" },
  { value: "zk", label: "ЗК" },
  { value: "zk_geo", label: "ЗК+гео" },
  { value: "life", label: "Лайф" },
  { value: "snh", label: "СНХ" },
] as const;

export const FONT_OPTIONS = ["PT Sans", "Arial", "Georgia", "Times New Roman", "Roboto Slab"];

export const FILL_COLOR_OPTIONS = [
  { value: "#ffffff", label: "Без заливки" },
  { value: "#ffff00", label: "Желтый" },
  { value: "#ff0000", label: "Красный" },
  { value: "#00ff00", label: "Зеленый" },
  { value: "#0000ff", label: "Синий" },
  { value: "#ffa500", label: "Оранжевый" },
] as const;

export const EDITOR_COLUMNS: Array<{ key: EditorColumnKey; label: string }> = [
  { key: "order_index", label: "№" },
  { key: "block_type", label: "Блок" },
  { key: "text", label: "Текст" },
  { key: "file_bundle", label: "Имя файла / TC" },
  { key: "additional_comment", label: "В кадре" },
];

export const DEFAULT_EDITOR_COLUMN_WIDTHS: Record<EditorColumnKey, number> = {
  order_index: 36,
  block_type: 132,
  text: 540,
  file_bundle: 220,
  additional_comment: 180,
};

export const MIN_EDITOR_COLUMN_WIDTHS: Record<EditorColumnKey, number> = {
  order_index: 30,
  block_type: 120,
  text: 360,
  file_bundle: 180,
  additional_comment: 150,
};

export const EDITOR_COLUMN_WIDTHS_STORAGE_KEY = "newscast-editor-column-widths-v3";

export function blockTypeTone(blockType: string): string {
  return BLOCK_OPTIONS.some((option) => option.value === blockType) ? blockType : "zk";
}

export function preferredFocusTarget(blockType: string): FormatTargetKey {
  if (blockType === "snh") return "speaker_fio";
  if (blockType === "zk_geo") return "geo";
  return "text";
}

export function supportedFormatTargets(blockType: ScenarioRow["block_type"]): FormatTargetKey[] {
  if (blockType === "snh") return ["speaker_fio", "speaker_position", "text"];
  if (blockType === "zk_geo") return ["geo", "text"];
  return ["text"];
}

function normalizeTextLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function plainTextForTarget(
  row: ScenarioRow,
  target: FormatTargetKey,
  blockType: ScenarioRow["block_type"],
): string {
  if (target === "text") return row.text;
  if (target === "geo") return "";
  if (blockType !== "snh") return "";
  const [fio = "", position = ""] = row.speaker_text.split("\n");
  return target === "speaker_fio" ? fio : position;
}

function freshRichTextTarget(text: string): EditorCoreRichTextTarget {
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
  return { editor: "legacy_html", text, html };
}

export function defaultScenarioFormatting(
  row: ScenarioRow,
  target: FormatTargetKey,
): ScenarioFormattingTarget {
  const italic = row.block_type === "life"
    || (row.block_type === "zk_geo" && target === "geo")
    || row.block_type === "snh";
  return {
    font_family: "PT Sans",
    bold: row.block_type === "snh" && target !== "text",
    italic,
    strikethrough: false,
    fill_color: "#ffffff",
  };
}

export function scenarioFormatting(
  row: ScenarioRow,
  target: FormatTargetKey,
): ScenarioFormattingTarget {
  return {
    ...defaultScenarioFormatting(row, target),
    ...(row.formatting.targets?.[target] || {}),
  };
}

export function setScenarioFormatting(
  row: ScenarioRow,
  target: FormatTargetKey,
  patch: Partial<ScenarioFormattingTarget>,
): ScenarioRow {
  if (!supportedFormatTargets(row.block_type).includes(target)) return row;
  return {
    ...row,
    formatting: {
      ...row.formatting,
      targets: {
        ...(row.formatting.targets || {}),
        [target]: { ...scenarioFormatting(row, target), ...patch },
      },
    },
  };
}

export function changeScenarioRowBlockType(
  row: ScenarioRow,
  nextBlockType: ScenarioRow["block_type"],
): ScenarioRow {
  const currentSupported = new Set(supportedFormatTargets(row.block_type));
  const nextSupported = supportedFormatTargets(nextBlockType);
  const nextStructuredData: Record<string, unknown> = nextBlockType === "zk_geo"
    ? { geo: "", text_lines: normalizeTextLines(row.text) }
    : {};
  const bundles = parseRowFileBundles(row);
  if (bundles.length) nextStructuredData.file_bundles = bundles;

  const nextRichTextTargets = Object.fromEntries(nextSupported.map((target) => {
    const existing = currentSupported.has(target) ? row.rich_text.targets?.[target] : undefined;
    return [
      target,
      existing || freshRichTextTarget(plainTextForTarget(row, target, nextBlockType)),
    ];
  }));
  const nextFormattingTargets = Object.fromEntries(nextSupported.flatMap((target) => {
    const existing = currentSupported.has(target) ? row.formatting.targets?.[target] : undefined;
    return existing ? [[target, existing]] : [];
  }));

  return {
    ...row,
    block_type: nextBlockType,
    speaker_text: nextBlockType === "snh" ? row.speaker_text : "",
    structured_data: nextStructuredData,
    formatting: Object.keys(nextFormattingTargets).length
      ? { targets: nextFormattingTargets }
      : {},
    rich_text: {
      schema_version: row.rich_text.schema_version || 1,
      targets: nextRichTextTargets,
    },
  };
}

export function loadEditorColumnWidths(): Record<EditorColumnKey, number> {
  if (typeof window === "undefined") return { ...DEFAULT_EDITOR_COLUMN_WIDTHS };
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(EDITOR_COLUMN_WIDTHS_STORAGE_KEY) || "{}",
    ) as Partial<Record<EditorColumnKey, number>>;
    return Object.fromEntries(
      EDITOR_COLUMNS.map(({ key }) => [
        key,
        Math.max(
          MIN_EDITOR_COLUMN_WIDTHS[key],
          Number.isFinite(parsed[key]) ? Number(parsed[key]) : DEFAULT_EDITOR_COLUMN_WIDTHS[key],
        ),
      ]),
    ) as Record<EditorColumnKey, number>;
  } catch {
    return { ...DEFAULT_EDITOR_COLUMN_WIDTHS };
  }
}

export function normalizeTimecodeInputValue(rawValue: string): string {
  const compact = String(rawValue || "").trim().replace(/[.;]/g, ":").replace(/\s+/g, "");
  if (!compact) return "";
  if (!compact.includes(":")) return compact.replace(/\D/g, "").slice(0, 6);
  const parts = compact
    .split(":")
    .map((item) => item.replace(/\D/g, ""))
    .filter(Boolean)
    .slice(0, 3);
  return parts.map((item) => item.slice(0, 2).padStart(2, "0")).join(":");
}

export function normalizeTimecodeDisplayValue(rawValue: string): string {
  const normalized = normalizeTimecodeInputValue(rawValue);
  if (/^\d{4}$/.test(normalized)) return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
  if (/^\d{6}$/.test(normalized)) {
    return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}:${normalized.slice(4, 6)}`;
  }
  return normalized;
}

function isSoftTimecodeDraftValue(rawValue: string): boolean {
  const normalized = String(rawValue || "").trim().replace(/[.;]/g, ":");
  const colonCount = (normalized.match(/:/g) || []).length;
  return /^\d{1,6}$/.test(normalized)
    || (/^[\d:]{1,8}$/.test(normalized) && colonCount <= 2);
}

export function timecodeValidationMessage(rawValue: string): string {
  if (!rawValue || isSoftTimecodeDraftValue(rawValue)) return "";
  const normalized = normalizeTimecodeDisplayValue(rawValue);
  return /^\d{2}:\d{2}$/.test(normalized) || /^\d{2}:\d{2}:\d{2}$/.test(normalized)
    ? ""
    : "Формат: ММ:СС или ЧЧ:ММ:СС";
}

function normalizeFileBundle(raw?: Partial<FileBundleItem> | null): FileBundleItem {
  return {
    file_name: String(raw?.file_name || "").trim(),
    tc_in: String(raw?.tc_in || "").trim(),
    tc_out: String(raw?.tc_out || "").trim(),
  };
}

function isMeaningfulFileBundle(item: FileBundleItem): boolean {
  return Boolean(item.file_name || item.tc_in || item.tc_out);
}

export function parseRowFileBundles(row: ScenarioRow): FileBundleItem[] {
  const rawBundles = Array.isArray(row.structured_data.file_bundles)
    ? row.structured_data.file_bundles
    : null;
  if (rawBundles) {
    return rawBundles
      .map((item) => item && typeof item === "object"
        ? normalizeFileBundle(item as Partial<FileBundleItem>)
        : normalizeFileBundle())
      .filter(isMeaningfulFileBundle);
  }
  const legacy = normalizeFileBundle(row);
  return isMeaningfulFileBundle(legacy) ? [legacy] : [];
}

export function buildFileBundleInputValue(
  bundles: FileBundleItem[],
  bundleIndex: number,
): string {
  const fileName = bundles[bundleIndex]?.file_name.trim() || "";
  if (!fileName || bundleIndex === 0) return fileName;
  const previous = bundles[bundleIndex - 1]?.file_name.trim() || "";
  if (previous === fileName) return "+";
  return previous ? `+ ${fileName}` : fileName;
}

export function resolveFileBundleInput(rawValue: string, previousFileName: string): {
  fileName: string;
  committable: boolean;
} {
  const normalized = rawValue.trim();
  if (!normalized) return { fileName: "", committable: false };
  if (normalized === "+") {
    return { fileName: previousFileName.trim(), committable: Boolean(previousFileName.trim()) };
  }
  if (normalized.startsWith("+")) {
    const explicit = normalized.slice(1).trim();
    return { fileName: explicit, committable: Boolean(explicit) };
  }
  return { fileName: normalized, committable: true };
}

export function updateRowFileBundles(row: ScenarioRow, bundles: FileBundleItem[]): ScenarioRow {
  const normalized = bundles.map(normalizeFileBundle).filter(isMeaningfulFileBundle);
  const primary = normalized[0] || normalizeFileBundle();
  const structuredData = { ...row.structured_data };
  if (normalized.length) structuredData.file_bundles = normalized;
  else delete structuredData.file_bundles;
  return {
    ...row,
    file_name: primary.file_name,
    tc_in: primary.tc_in,
    tc_out: primary.tc_out,
    structured_data: structuredData,
  };
}

export function updateFileBundle(
  row: ScenarioRow,
  bundleIndex: number,
  patch: Partial<FileBundleItem>,
): ScenarioRow {
  const bundles = parseRowFileBundles(row);
  const next = bundles.map((item, index) =>
    index === bundleIndex ? normalizeFileBundle({ ...item, ...patch }) : item);
  return updateRowFileBundles(row, next);
}
