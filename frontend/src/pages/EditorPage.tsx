import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type TextareaHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import {
  addProjectComment,
  approveProjectRevision,
  branchProjectRevision,
  createProjectRevision,
  deleteProjectComment,
  deleteProjectFile,
  downloadProjectExport,
  downloadProjectFile,
  fetchProjectEditor,
  fetchProjectHistory,
  fetchProjectRevisionDiff,
  fetchProjectRevisionElements,
  fetchProjectRevisions,
  fetchProjectWorkspace,
  fetchUsers,
  markProjectRevisionCurrent,
  mergeProjectRevisionToMain,
  rejectProjectRevision,
  restoreProjectRevisionToWorkspace,
  saveProjectEditor,
  submitProjectRevision,
  updateProjectMeta,
  updateProjectWorkspace,
  uploadProjectFile,
} from "../shared/api";
import type {
  ProjectCommentItem,
  ProjectFileItem,
  ProjectHistoryItem,
  ProjectListItem,
  ProjectRevisionDiffResponse,
  ProjectRevisionItem,
  ProjectRevisionRowDiffItem,
  ProjectStatusValue,
  ScriptElementFormatting,
  ScriptElementFormattingTarget,
  ScriptElementRichText,
  ScriptElementRichTextTarget,
  ScriptElementRow,
  UserListItem,
  UserPublic,
} from "../shared/types";
import { EditorCoreField, type EditorCoreFieldChangePayload } from "../features/editor-core/EditorField";

interface EditorPageProps {
  token: string;
  projectId: number;
  user: UserPublic;
  onBackToMain: () => void;
}

const BLOCK_OPTIONS = [
  { value: "podvodka", label: "Подводка" },
  { value: "zk", label: "ЗК" },
  { value: "zk_geo", label: "ЗК+гео" },
  { value: "life", label: "Лайф" },
  { value: "snh", label: "СНХ" },
];

type EditorColumnKey = "order_index" | "block_type" | "text" | "file_bundle" | "additional_comment";
type FormatTargetKey = "text" | "speaker_fio" | "speaker_position" | "geo";
type AutosaveState = "idle" | "saving" | "error";
type RevisionActionKind =
  | "create"
  | "open"
  | "branch"
  | "merge"
  | "submit"
  | "approve"
  | "reject"
  | "restore"
  | "current";
type RichTextEditorId = `${number}:${FormatTargetKey}`;
type RowDropPosition = "before" | "after";
type EditorViewMode = "edit" | "review";

const DEFAULT_EDITOR_COLUMN_WIDTHS: Record<EditorColumnKey, number> = {
  order_index: 64,
  block_type: 144,
  text: 540,
  file_bundle: 220,
  additional_comment: 180,
};

const MIN_EDITOR_COLUMN_WIDTHS: Record<EditorColumnKey, number> = {
  order_index: 56,
  block_type: 132,
  text: 360,
  file_bundle: 180,
  additional_comment: 150,
};

const EDITOR_COLUMNS: Array<{ key: EditorColumnKey; label: string }> = [
  { key: "order_index", label: "№" },
  { key: "block_type", label: "Блок" },
  { key: "text", label: "Текст" },
  { key: "file_bundle", label: "Имя файла / TC" },
  { key: "additional_comment", label: "В кадре" },
];

const EDITOR_COLUMN_WIDTHS_STORAGE_KEY = "newscast-editor-column-widths-v2";

const ACTIVE_PROJECT_STATUSES: Array<{ value: ProjectStatusValue; label: string }> = [
  { value: "draft", label: "Черновик" },
  { value: "reviewed", label: "На проверке" },
  { value: "in_editing", label: "В работе" },
  { value: "in_proofreading", label: "На корректуре" },
  { value: "ready", label: "Готово" },
  { value: "delivered", label: "Сдано" },
];

const EVENT_LABELS: Record<string, string> = {
  project_created: "Проект создан",
  project_cloned: "Проект скопирован",
  status_changed: "Статус изменен",
  project_archived: "Проект отправлен в архив",
  project_restored: "Проект возвращен из архива",
  file_uploaded: "Файл загружен",
  revision_created: "Создана версия текста",
  revision_branched: "Создана ветка версии",
  revision_merged: "Ветка слита в main",
  revision_submitted: "Версия отправлена на согласование",
  revision_approved: "Версия утверждена",
  revision_rejected: "Версия отклонена",
  revision_restored_to_workspace: "Версия восстановлена в workspace",
  revision_marked_current: "Версия отмечена как текущая",
};

const DEFAULT_FONT_FAMILY = "PT Sans";
const DEFAULT_FILL_COLOR = "#ffffff";
const LEGACY_DEFAULT_FILL_COLOR = "#f4f6f9";
const FONT_OPTIONS = ["PT Sans", "Arial", "Georgia", "Times New Roman", "Roboto Slab"];
const FILL_COLOR_OPTIONS = [
  { value: DEFAULT_FILL_COLOR, label: "Без заливки" },
  { value: "#ffff00", label: "Желтый" },
  { value: "#ff0000", label: "Красный" },
  { value: "#00ff00", label: "Зеленый" },
  { value: "#0000ff", label: "Синий" },
  { value: "#ffa500", label: "Оранжевый" },
];

interface ActiveFormatScope {
  rowIndex: number;
  target: FormatTargetKey;
}

interface SnhRowParts {
  fio: string;
  position: string;
}

interface ZkGeoParts {
  geo: string;
  text: string;
}

interface FileBundleItem {
  file_name: string;
  tc_in: string;
  tc_out: string;
}

interface ParsedFileBundleInput {
  raw: string;
  normalized: string;
  resolved_file_name: string;
  is_committable: boolean;
}

interface AutoSizeTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  minHeight?: number;
}

interface RichTextChangePayload {
  editor?: "legacy_html" | "tiptap";
  text: string;
  html: string;
  doc?: Record<string, unknown>;
}

function normalizeProjectStatus(projectStatus: string): string {
  const normalized = (projectStatus || "").trim().toLowerCase();
  return normalized || "draft";
}

function isSnhBlock(blockType: string): boolean {
  return (blockType || "").trim().toLowerCase() === "snh";
}

function isZkGeoBlock(blockType: string): boolean {
  return (blockType || "").trim().toLowerCase() === "zk_geo";
}

function parseSnhSpeakerText(speakerText: string): SnhRowParts {
  const [fio = "", position = ""] = (speakerText || "").split(/\r?\n/, 2);
  return {
    fio: fio.trim(),
    position: position.trim(),
  };
}

function buildSnhSpeakerText(fio: string, position: string): string {
  const normalizedFio = fio.trim();
  const normalizedPosition = position.trim();

  if (!normalizedFio && !normalizedPosition) {
    return "";
  }
  return [normalizedFio, normalizedPosition].filter(Boolean).join("\n");
}

function normalizeTextLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseZkGeoStructuredData(row: ScriptElementRow): ZkGeoParts {
  const payload =
    row.structured_data && typeof row.structured_data === "object" ? row.structured_data : {};
  const geo = typeof payload.geo === "string" ? payload.geo.trim() : "";
  const rawLines = Array.isArray(payload.text_lines)
    ? payload.text_lines.map((item) => String(item || ""))
    : [];
  const textLines = rawLines
    .map((item) => item.trim())
    .filter(Boolean);
  const fallbackText = row.text || "";

  return {
    geo,
    text: textLines.length > 0 ? textLines.join("\n") : fallbackText,
  };
}

function buildZkGeoStructuredData(geo: string, text: string): Record<string, unknown> {
  return {
    geo: geo.trim(),
    text_lines: normalizeTextLines(text),
  };
}

function cloneRowDraftForInsert(row: ScriptElementRow): ScriptElementRow {
  return {
    ...row,
    id: null,
    segment_uid: null,
    structured_data: JSON.parse(JSON.stringify(row.structured_data || {})) as Record<string, unknown>,
    formatting: JSON.parse(JSON.stringify(row.formatting || {})),
    rich_text: JSON.parse(JSON.stringify(row.rich_text || {})),
  };
}

function normalizeFileBundleItem(rawValue?: Partial<FileBundleItem> | null): FileBundleItem {
  return {
    file_name: String(rawValue?.file_name || "").trim(),
    tc_in: String(rawValue?.tc_in || "").trim(),
    tc_out: String(rawValue?.tc_out || "").trim(),
  };
}

function normalizeTimecodeInputValue(rawValue: string): string {
  const compact = String(rawValue || "")
    .trim()
    .replace(/[.;]/g, ":")
    .replace(/\s+/g, "");
  if (!compact) {
    return "";
  }

  if (!compact.includes(":")) {
    return compact.replace(/\D/g, "").slice(0, 6);
  }

  const parts = compact
    .split(":")
    .map((item) => item.replace(/\D/g, ""))
    .filter(Boolean)
    .slice(0, 3);

  if (parts.length === 0) {
    return "";
  }

  return parts.map((item) => item.slice(0, 2).padStart(2, "0")).join(":");
}

function isMeaningfulFileBundle(item: FileBundleItem): boolean {
  return Boolean(item.file_name || item.tc_in || item.tc_out);
}

function parseFileBundleInputValue(rawValue: string, previousFileName: string): ParsedFileBundleInput {
  const normalized = String(rawValue || "").trim();
  const previous = String(previousFileName || "").trim();
  if (!normalized) {
    return {
      raw: rawValue,
      normalized,
      resolved_file_name: "",
      is_committable: false,
    };
  }

  if (normalized === "+") {
    return {
      raw: rawValue,
      normalized,
      resolved_file_name: previous,
      is_committable: Boolean(previous),
    };
  }

  if (normalized.startsWith("+")) {
    const explicitFileName = normalized.slice(1).trim();
    return {
      raw: rawValue,
      normalized,
      resolved_file_name: explicitFileName,
      is_committable: Boolean(explicitFileName),
    };
  }

  return {
    raw: rawValue,
    normalized,
    resolved_file_name: normalized,
    is_committable: true,
  };
}

function parseRowFileBundles(row: ScriptElementRow): FileBundleItem[] {
  const rawBundles = Array.isArray(row.structured_data?.file_bundles)
    ? row.structured_data.file_bundles
    : null;
  if (rawBundles) {
    const normalized = rawBundles
      .map((item) =>
        item && typeof item === "object"
          ? normalizeFileBundleItem(item as Partial<FileBundleItem>)
          : normalizeFileBundleItem(null)
      )
      .filter(isMeaningfulFileBundle);
    return normalized;
  }
  const legacyBundle = normalizeFileBundleItem({
    file_name: row.file_name,
    tc_in: row.tc_in,
    tc_out: row.tc_out,
  });
  return isMeaningfulFileBundle(legacyBundle) ? [legacyBundle] : [];
}

function buildFileBundleInputValue(bundles: FileBundleItem[], bundleIndex: number): string {
  const bundle = bundles[bundleIndex];
  if (!bundle) {
    return "";
  }
  const currentFileName = bundle.file_name.trim();
  if (!currentFileName) {
    return "";
  }
  if (bundleIndex === 0) {
    return currentFileName;
  }
  const previousFileName = bundles[bundleIndex - 1]?.file_name.trim() || "";
  if (previousFileName && previousFileName === currentFileName) {
    return "+";
  }
  return previousFileName ? `+ ${currentFileName}` : currentFileName;
}

function pickPrimaryFileBundle(bundles: FileBundleItem[]): FileBundleItem {
  return (
    bundles.find((item) => Boolean(item.file_name || item.tc_in || item.tc_out)) ||
    bundles[0] ||
    normalizeFileBundleItem(null)
  );
}

function buildStructuredDataWithFileBundles(
  baseStructuredData: Record<string, unknown>,
  bundles: FileBundleItem[]
): Record<string, unknown> {
  const nextStructuredData: Record<string, unknown> = {
    ...(baseStructuredData || {}),
  };
  if (bundles.length > 0) {
    nextStructuredData.file_bundles = bundles.map((item) => normalizeFileBundleItem(item));
  } else {
    delete nextStructuredData.file_bundles;
  }
  return Object.keys(nextStructuredData).length > 0 ? nextStructuredData : {};
}

function updateRowFileBundles(row: ScriptElementRow, bundles: FileBundleItem[]): ScriptElementRow {
  const normalizedBundles = bundles.map((item) => normalizeFileBundleItem(item));
  const primaryBundle = pickPrimaryFileBundle(normalizedBundles);
  return {
    ...row,
    file_name: primaryBundle.file_name,
    tc_in: primaryBundle.tc_in,
    tc_out: primaryBundle.tc_out,
    structured_data: buildStructuredDataWithFileBundles(row.structured_data, normalizedBundles),
  };
}

function getRichTextEditorId(rowIndex: number, target: FormatTargetKey): RichTextEditorId {
  return `${rowIndex}:${target}`;
}

function parseRichTextEditorId(value: string): { rowIndex: number; target: FormatTargetKey } | null {
  const [rowIndexText, targetText] = value.split(":", 2);
  const rowIndex = Number(rowIndexText);
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    return null;
  }
  if (
    targetText !== "text" &&
    targetText !== "speaker_fio" &&
    targetText !== "speaker_position" &&
    targetText !== "geo"
  ) {
    return null;
  }
  return {
    rowIndex,
    target: targetText,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEditableText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\r/g, "").replace(/\n+$/g, "");
}

function buildRichTextHtmlFromPlainText(value: string): string {
  const normalized = normalizeEditableText(value);
  if (!normalized) {
    return "";
  }
  return escapeHtml(normalized).replace(/\n/g, "<br>");
}

function getFormattingHtml(
  row: ScriptElementRow,
  target: FormatTargetKey,
  fallbackText: string
): string {
  const formatting = normalizeFormatting(row.block_type, row.formatting);
  const storedHtml = formatting.html_by_target?.[target] || "";
  if (storedHtml.trim()) {
    return storedHtml;
  }
  return buildRichTextHtmlFromPlainText(fallbackText);
}

function getRichTextTarget(
  row: ScriptElementRow,
  target: FormatTargetKey,
  fallbackText: string
): ScriptElementRichTextTarget | null {
  const payload =
    row.rich_text && typeof row.rich_text === "object" ? row.rich_text : ({} as ScriptElementRichText);
  const targets =
    payload.targets && typeof payload.targets === "object"
      ? payload.targets
      : ({} as Record<string, ScriptElementRichTextTarget>);
  const source = targets[target];

  if (!source || typeof source !== "object") {
    return {
      editor: "legacy_html",
      text: fallbackText,
      html: getFormattingHtml(row, target, fallbackText),
    };
  }

  const text = typeof source.text === "string" ? source.text : fallbackText;
  const html =
    typeof source.html === "string" && source.html.trim()
      ? source.html
      : getFormattingHtml(row, target, text);

  const normalized: ScriptElementRichTextTarget = {
    editor: typeof source.editor === "string" && source.editor.trim() ? source.editor : "legacy_html",
    text,
    html,
  };
  if (source.doc && typeof source.doc === "object") {
    normalized.doc = source.doc;
  }
  return normalized;
}

function updateRichTextTarget(
  row: ScriptElementRow,
  target: FormatTargetKey,
  payload: RichTextChangePayload
): ScriptElementRichText {
  const currentPayload =
    row.rich_text && typeof row.rich_text === "object" ? row.rich_text : ({} as ScriptElementRichText);
  const currentTargets =
    currentPayload.targets && typeof currentPayload.targets === "object"
      ? currentPayload.targets
      : ({} as Record<string, ScriptElementRichTextTarget>);
  const currentTarget = currentTargets[target];

  const nextTarget: ScriptElementRichTextTarget = {
    editor: payload.editor || currentTarget?.editor || "legacy_html",
    text: payload.text,
    html: payload.html.trim() ? payload.html : buildRichTextHtmlFromPlainText(payload.text),
  };
  if (payload.doc && typeof payload.doc === "object") {
    nextTarget.doc = payload.doc;
  }

  return {
    schema_version: 1,
    targets: {
      ...currentTargets,
      [target]: nextTarget,
    },
  };
}

function getSupportedRichTextTargets(blockType: string): FormatTargetKey[] {
  const normalizedBlockType = (blockType || "").trim().toLowerCase();
  if (normalizedBlockType === "snh") {
    return ["speaker_fio", "speaker_position", "text"];
  }
  if (normalizedBlockType === "zk_geo") {
    return ["geo", "text"];
  }
  return ["text"];
}

function buildPlainTargetsForRowValues(
  blockType: string,
  text: string,
  speakerText: string,
  structuredData: Record<string, unknown>
): Record<FormatTargetKey, string> {
  const normalizedBlockType = (blockType || "").trim().toLowerCase();
  if (normalizedBlockType === "snh") {
    const snhParts = parseSnhSpeakerText(speakerText);
    return {
      speaker_fio: snhParts.fio,
      speaker_position: snhParts.position,
      text,
      geo: "",
    };
  }
  if (normalizedBlockType === "zk_geo") {
    const zkGeoParts = parseZkGeoStructuredData({
      id: null,
      segment_uid: null,
      order_index: 0,
      block_type: normalizedBlockType,
      text,
      speaker_text: "",
      file_name: "",
      tc_in: "",
      tc_out: "",
      additional_comment: "",
      structured_data: structuredData,
      formatting: {},
      rich_text: {},
    });
    return {
      speaker_fio: "",
      speaker_position: "",
      text: zkGeoParts.text,
      geo: zkGeoParts.geo,
    };
  }
  return {
    speaker_fio: "",
    speaker_position: "",
    text,
    geo: "",
  };
}

function normalizeRichTextForBlockChange(
  row: ScriptElementRow,
  nextBlockType: string,
  nextText: string,
  nextSpeakerText: string,
  nextStructuredData: Record<string, unknown>
): ScriptElementRichText {
  const currentPayload =
    row.rich_text && typeof row.rich_text === "object" ? row.rich_text : ({} as ScriptElementRichText);
  const currentTargets =
    currentPayload.targets && typeof currentPayload.targets === "object"
      ? currentPayload.targets
      : ({} as Record<string, ScriptElementRichTextTarget>);

  const currentSupportedTargets = new Set(getSupportedRichTextTargets(row.block_type));
  const nextSupportedTargets = getSupportedRichTextTargets(nextBlockType);
  const plainTargets = buildPlainTargetsForRowValues(
    nextBlockType,
    nextText,
    nextSpeakerText,
    nextStructuredData
  );

  const nextTargets: Record<string, ScriptElementRichTextTarget> = {};
  for (const target of nextSupportedTargets) {
    const source = currentSupportedTargets.has(target) ? currentTargets[target] : undefined;
    const plainText = plainTargets[target] || "";
    const nextTarget: ScriptElementRichTextTarget = {
      editor: typeof source?.editor === "string" && source.editor.trim() ? source.editor : "legacy_html",
      text: plainText,
      html:
        typeof source?.html === "string" && source.html.trim()
          ? source.html
          : buildRichTextHtmlFromPlainText(plainText),
    };
    if (source?.doc && typeof source.doc === "object") {
      nextTarget.doc = source.doc;
    }
    nextTargets[target] = nextTarget;
  }

  return {
    schema_version: 1,
    targets: nextTargets,
  };
}

function createDefaultFormattingTarget(
  overrides: Partial<ScriptElementFormattingTarget> = {}
): ScriptElementFormattingTarget {
  return {
    font_family: DEFAULT_FONT_FAMILY,
    bold: false,
    italic: false,
    strikethrough: false,
    fill_color: DEFAULT_FILL_COLOR,
    ...overrides,
  };
}

function getDefaultFormattingForBlock(blockType: string): ScriptElementFormatting {
  const normalizedBlock = (blockType || "").trim().toLowerCase();
  if (normalizedBlock === "snh") {
    return {
      targets: {
        speaker_fio: createDefaultFormattingTarget({ bold: true, italic: true }),
        speaker_position: createDefaultFormattingTarget({ bold: true, italic: true }),
        text: createDefaultFormattingTarget({ italic: true }),
      },
    };
  }
  if (normalizedBlock === "zk_geo") {
    return {
      targets: {
        geo: createDefaultFormattingTarget({ italic: true }),
        text: createDefaultFormattingTarget(),
      },
    };
  }
  if (normalizedBlock === "life") {
    return {
      targets: {
        text: createDefaultFormattingTarget({ italic: true }),
      },
    };
  }
  return {
    targets: {
      text: createDefaultFormattingTarget(),
    },
  };
}

function normalizeFormatting(
  blockType: string,
  formatting?: ScriptElementFormatting | null
): ScriptElementFormatting {
  const defaults = getDefaultFormattingForBlock(blockType);
  const normalizedTargets: Record<string, ScriptElementFormattingTarget> = {
    ...(defaults.targets || {}),
  };
  const normalizedHtmlByTarget: Record<string, string> = {};

  for (const [target, targetDefaults] of Object.entries(defaults.targets || {})) {
    const source = formatting?.targets?.[target];
    normalizedTargets[target] = {
      ...targetDefaults,
      ...(source || {}),
      font_family: (source?.font_family || targetDefaults.font_family || DEFAULT_FONT_FAMILY).trim(),
      fill_color:
        (source?.fill_color || targetDefaults.fill_color || DEFAULT_FILL_COLOR).trim().toLowerCase() ===
        LEGACY_DEFAULT_FILL_COLOR
          ? DEFAULT_FILL_COLOR
          : (source?.fill_color || targetDefaults.fill_color || DEFAULT_FILL_COLOR).trim(),
    };
    const htmlValue = formatting?.html_by_target?.[target];
    if (typeof htmlValue === "string" && htmlValue.trim()) {
      normalizedHtmlByTarget[target] = htmlValue;
    }
  }

  return { targets: normalizedTargets, html_by_target: normalizedHtmlByTarget };
}

function getFormattingTarget(
  row: ScriptElementRow,
  target: FormatTargetKey
): ScriptElementFormattingTarget | null {
  const formatting = normalizeFormatting(row.block_type, row.formatting);
  return formatting.targets?.[target] || null;
}

function updateFormattingHtml(
  row: ScriptElementRow,
  target: FormatTargetKey,
  html: string
): ScriptElementFormatting {
  const normalized = normalizeFormatting(row.block_type, row.formatting);
  const nextHtmlByTarget = {
    ...(normalized.html_by_target || {}),
  };
  if (html.trim()) {
    nextHtmlByTarget[target] = html;
  } else {
    delete nextHtmlByTarget[target];
  }
  return {
    ...normalized,
    html_by_target: nextHtmlByTarget,
  };
}

function buildFormattingStyle(target: ScriptElementFormattingTarget | null): CSSProperties {
  if (!target) {
    return {};
  }
  return {
    fontFamily: target.font_family || DEFAULT_FONT_FAMILY,
    fontWeight: target.bold ? 700 : 400,
    fontStyle: target.italic ? "italic" : "normal",
    textDecoration: target.strikethrough ? "line-through" : "none",
    backgroundColor: target.fill_color || DEFAULT_FILL_COLOR,
  };
}

function clampEditorColumnWidth(columnKey: EditorColumnKey, rawValue?: number): number {
  const value =
    typeof rawValue === "number" && Number.isFinite(rawValue)
      ? Math.round(rawValue)
      : DEFAULT_EDITOR_COLUMN_WIDTHS[columnKey];
  return Math.max(MIN_EDITOR_COLUMN_WIDTHS[columnKey], value);
}

function loadEditorColumnWidths(): Record<EditorColumnKey, number> {
  if (typeof window === "undefined") {
    return { ...DEFAULT_EDITOR_COLUMN_WIDTHS };
  }

  try {
    const rawValue = window.localStorage.getItem(EDITOR_COLUMN_WIDTHS_STORAGE_KEY);
    if (!rawValue) {
      return { ...DEFAULT_EDITOR_COLUMN_WIDTHS };
    }
    const parsed = JSON.parse(rawValue) as Partial<Record<EditorColumnKey, number>>;
    return {
      order_index: clampEditorColumnWidth("order_index", parsed.order_index),
      block_type: clampEditorColumnWidth("block_type", parsed.block_type),
      text: clampEditorColumnWidth("text", parsed.text),
      file_bundle: clampEditorColumnWidth("file_bundle", parsed.file_bundle),
      additional_comment: clampEditorColumnWidth(
        "additional_comment",
        parsed.additional_comment
      ),
    };
  } catch (_error) {
    return { ...DEFAULT_EDITOR_COLUMN_WIDTHS };
  }
}

function canEditProjectRows(userRole: string, projectStatus: string): boolean {
  const normalizedRole = (userRole || "").trim().toLowerCase();
  const normalizedStatus = normalizeProjectStatus(projectStatus);

  if (normalizedStatus === "archived") {
    return false;
  }
  if (normalizedRole === "admin" || normalizedRole === "editor") {
    return true;
  }
  if (normalizedStatus === "in_proofreading") {
    return normalizedRole === "proofreader";
  }
  return normalizedRole === "author" || normalizedRole === "proofreader";
}

function canEditProjectMeta(userRole: string, projectStatus: string): boolean {
  const canEditByRole = userRole === "admin" || userRole === "editor" || userRole === "author";
  return canEditByRole && projectStatus !== "archived";
}

function canAssignProject(userRole: string, projectStatus: string): boolean {
  const canEditByRole = userRole === "admin" || userRole === "editor";
  return canEditByRole && projectStatus !== "archived";
}

function canChangeProjectStatus(userRole: string, projectStatus: string): boolean {
  const canEditByRole =
    userRole === "admin" || userRole === "editor" || userRole === "proofreader";
  return canEditByRole && projectStatus !== "archived";
}

function rowEditRestrictionMessage(userRole: string, projectStatus: string): string {
  const normalizedStatus = normalizeProjectStatus(projectStatus);
  const normalizedRole = (userRole || "").trim().toLowerCase();

  if (normalizedStatus === "archived") {
    return "Редактирование строк отключено: проект находится в архиве.";
  }
  if (normalizedStatus === "in_proofreading" && normalizedRole === "author") {
    return "Редактирование строк отключено: на этапе корректуры изменения вносит корректор.";
  }
  return "Редактирование строк отключено: недостаточно прав для текущего статуса проекта.";
}

function buildEmptyRow(blockType: string, orderIndex: number): ScriptElementRow {
  return {
    id: null,
    segment_uid: null,
    order_index: orderIndex,
    block_type: blockType,
    text: "",
    speaker_text: "",
    file_name: "",
    tc_in: "",
    tc_out: "",
    additional_comment: "",
    structured_data: isZkGeoBlock(blockType) ? buildZkGeoStructuredData("", "") : {},
    formatting: normalizeFormatting(blockType, null),
    rich_text: {},
  };
}

function normalizeOrder(rows: ScriptElementRow[]): ScriptElementRow[] {
  return rows.map((row, index) => ({
    ...row,
    order_index: index + 1,
  }));
}

function toEditableRows(rows: ScriptElementRow[]): ScriptElementRow[] {
  if (rows.length === 0) {
    return [buildEmptyRow("zk", 1)];
  }

  return normalizeOrder(
    rows.map((row, index) => ({
      ...row,
      id: row.id ?? null,
      segment_uid: row.segment_uid ?? null,
      block_type: row.block_type || "zk",
      text: row.text || "",
      speaker_text: row.speaker_text || "",
      file_name: row.file_name || "",
      tc_in: row.tc_in || "",
      tc_out: row.tc_out || "",
      additional_comment: row.additional_comment || "",
      structured_data:
        row.structured_data && typeof row.structured_data === "object" ? row.structured_data : {},
      formatting: normalizeFormatting(row.block_type || "zk", row.formatting),
      rich_text: row.rich_text && typeof row.rich_text === "object" ? row.rich_text : {},
      order_index: index + 1,
    }))
  );
}

function normalizeIdList(values: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = value.trim();
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

function createTableSignature(
  rows: ScriptElementRow[],
  title: string,
  rubric: string,
  plannedDuration: string
): string {
  return JSON.stringify({
    title: title.trim(),
    rubric: rubric.trim(),
    planned_duration: plannedDuration.trim(),
    rows: normalizeOrder(rows).map((row) => ({
      id: row.id ?? null,
      segment_uid: row.segment_uid ?? null,
      order_index: row.order_index,
      block_type: row.block_type,
      text: row.text,
      speaker_text: row.speaker_text,
      file_name: row.file_name,
      tc_in: row.tc_in,
      tc_out: row.tc_out,
      additional_comment: row.additional_comment,
      structured_data: row.structured_data,
      formatting: row.formatting,
      rich_text: row.rich_text,
    })),
  });
}

function createWorkflowSignature(
  status: string,
  authorUserId: string,
  executorUserIds: string[],
  proofreaderUserId: string
): string {
  return JSON.stringify({
    status,
    author_user_id: authorUserId || "",
    executor_user_ids: normalizeIdList(executorUserIds),
    proofreader_user_id: proofreaderUserId || "",
  });
}

function createWorkspaceSignature(fileRoots: string[], projectNote: string): string {
  return JSON.stringify({
    file_roots: fileRoots.map((item) => item.trim()).filter(Boolean),
    project_note: projectNote,
  });
}

function statusLabel(value?: string | null): string {
  const lookup = ACTIVE_PROJECT_STATUSES.find((item) => item.value === value);
  if (lookup) {
    return lookup.label;
  }
  if (value === "archived") {
    return "Архив";
  }
  return value || "-";
}

function eventTypeLabel(value: string): string {
  return EVENT_LABELS[value] || value;
}

function revisionStatusLabel(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "submitted") {
    return "На согласовании";
  }
  if (normalized === "approved") {
    return "Утверждено";
  }
  if (normalized === "rejected") {
    return "Отклонено";
  }
  if (normalized === "draft") {
    return "Черновик";
  }
  return value || "-";
}

function revisionStatusTone(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "submitted") {
    return "submitted";
  }
  if (normalized === "approved") {
    return "approved";
  }
  if (normalized === "rejected") {
    return "rejected";
  }
  return "draft";
}

function blockTypeLabel(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  const match = BLOCK_OPTIONS.find((item) => item.value === normalized);
  return match?.label || value || "-";
}

function blockTypeTone(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  switch (normalized) {
    case "snh":
      return "snh";
    case "zk_geo":
      return "zk_geo";
    case "life":
      return "life";
    case "podvodka":
      return "podvodka";
    case "zk":
    default:
      return "zk";
  }
}

function preferredFocusTargetForBlock(blockType: string): FormatTargetKey {
  if (isSnhBlock(blockType)) {
    return "speaker_fio";
  }
  if (isZkGeoBlock(blockType)) {
    return "geo";
  }
  return "text";
}

function primaryFocusScopeForBlock(rowIndex: number, blockType: string): ActiveFormatScope {
  return {
    rowIndex,
    target: preferredFocusTargetForBlock(blockType),
  };
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  const tagName = (element?.tagName || "").toLowerCase();

  return (
    ["input", "textarea", "select", "button"].includes(tagName) ||
    Boolean(element?.isContentEditable) ||
    Boolean(element?.closest(".rich-text-field"))
  );
}

function buildRowOutlinePreview(row: ScriptElementRow): string {
  if (isSnhBlock(row.block_type)) {
    const speaker = parseSnhSpeakerText(row.speaker_text);
    return (speaker.fio || row.text || "").trim();
  }
  if (isZkGeoBlock(row.block_type)) {
    const parts = parseZkGeoStructuredData(row);
    return (parts.geo || parts.text || "").trim();
  }
  return String(row.text || "").trim();
}

function truncateOutlinePreview(value: string, maxLength = 44): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Пустой блок";
  }
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function revisionDiffFieldLabel(value: string): string {
  switch (value) {
    case "title":
      return "Название";
    case "rubric":
      return "Рубрика";
    case "planned_duration":
      return "Хронометраж";
    case "block_type":
      return "Блок";
    case "text":
      return "Текст";
    case "speaker_text":
      return "Спикер";
    case "file_name":
      return "Имя файла";
    case "tc_in":
      return "TC IN";
    case "tc_out":
      return "TC OUT";
    case "additional_comment":
      return "В кадре";
    case "content_json":
      return "Структура";
    case "formatting_json":
      return "Форматирование";
    case "rich_text_json":
      return "Rich text";
    default:
      return value;
  }
}

function revisionChangeTypeLabel(value: string): string {
  switch (value) {
    case "added":
      return "Добавлена";
    case "removed":
      return "Удалена";
    case "changed":
      return "Изменена";
    case "moved":
      return "Перемещена";
    default:
      return value;
  }
}

function summarizeRevisionRow(row?: ScriptElementRow | null): string {
  if (!row) {
    return "";
  }
  const parts = [blockTypeLabel(String(row.block_type || ""))];
  const speakerText = String(row.speaker_text || "").trim();
  const text = String(row.text || "").trim();
  const additionalComment = String(row.additional_comment || "").trim();
  if (speakerText) {
    parts.push(speakerText);
  }
  if (text) {
    parts.push(text);
  }
  if (additionalComment) {
    parts.push(`В кадре: ${additionalComment}`);
  }
  return parts.filter(Boolean).join(" · ");
}

function isRevisionPreviewTargetChanged(
  row: ScriptElementRow,
  target: FormatTargetKey,
  changedFields: string[]
): boolean {
  const normalized = new Set(changedFields);
  if (normalized.has("block_type") || normalized.has("formatting_json") || normalized.has("rich_text_json")) {
    return true;
  }
  if (target === "text") {
    return normalized.has("text") || (isZkGeoBlock(row.block_type) && normalized.has("content_json"));
  }
  if (target === "speaker_fio" || target === "speaker_position") {
    return normalized.has("speaker_text");
  }
  if (target === "geo") {
    return normalized.has("content_json");
  }
  return false;
}

function RevisionRowDiffPreview({
  row,
  changedFields,
  tone,
}: {
  row?: ScriptElementRow | null;
  changedFields: string[];
  tone: "before" | "after";
}): JSX.Element {
  if (!row) {
    return <p className="muted">-</p>;
  }

  const previewLines: Array<{
    key: string;
    html: string;
    style: CSSProperties;
    changed: boolean;
    className?: string;
  }> = [];

  if (isSnhBlock(row.block_type)) {
    const snhParts = parseSnhSpeakerText(row.speaker_text);
    const fioTarget = getRichTextTarget(row, "speaker_fio", snhParts.fio);
    const positionTarget = getRichTextTarget(row, "speaker_position", snhParts.position);
    const textTarget = getRichTextTarget(row, "text", row.text);

    if (fioTarget?.html || fioTarget?.text) {
      previewLines.push({
        key: "speaker_fio",
        html: fioTarget?.html || buildRichTextHtmlFromPlainText(snhParts.fio),
        style: buildFormattingStyle(getFormattingTarget(row, "speaker_fio")),
        changed: isRevisionPreviewTargetChanged(row, "speaker_fio", changedFields),
        className: "revision-row-preview-line-emphasis",
      });
    }
    if (positionTarget?.html || positionTarget?.text) {
      previewLines.push({
        key: "speaker_position",
        html: positionTarget?.html || buildRichTextHtmlFromPlainText(snhParts.position),
        style: buildFormattingStyle(getFormattingTarget(row, "speaker_position")),
        changed: isRevisionPreviewTargetChanged(row, "speaker_position", changedFields),
        className: "revision-row-preview-line-emphasis",
      });
    }
    if (textTarget?.html || textTarget?.text) {
      previewLines.push({
        key: "text",
        html: textTarget?.html || buildRichTextHtmlFromPlainText(row.text),
        style: buildFormattingStyle(getFormattingTarget(row, "text")),
        changed: isRevisionPreviewTargetChanged(row, "text", changedFields),
      });
    }
  } else if (isZkGeoBlock(row.block_type)) {
    const zkGeoParts = parseZkGeoStructuredData(row);
    const geoTarget = getRichTextTarget(row, "geo", zkGeoParts.geo);
    const textTarget = getRichTextTarget(row, "text", zkGeoParts.text);

    if (geoTarget?.html || geoTarget?.text) {
      previewLines.push({
        key: "geo",
        html: geoTarget?.html || buildRichTextHtmlFromPlainText(zkGeoParts.geo),
        style: buildFormattingStyle(getFormattingTarget(row, "geo")),
        changed: isRevisionPreviewTargetChanged(row, "geo", changedFields),
      });
    }
    if (textTarget?.html || textTarget?.text) {
      previewLines.push({
        key: "text",
        html: textTarget?.html || buildRichTextHtmlFromPlainText(zkGeoParts.text),
        style: buildFormattingStyle(getFormattingTarget(row, "text")),
        changed: isRevisionPreviewTargetChanged(row, "text", changedFields),
      });
    }
  } else {
    const textTarget = getRichTextTarget(row, "text", row.text);
    previewLines.push({
      key: "text",
      html: textTarget?.html || buildRichTextHtmlFromPlainText(row.text),
      style: buildFormattingStyle(getFormattingTarget(row, "text")),
      changed: isRevisionPreviewTargetChanged(row, "text", changedFields),
    });
  }

  const hasMetaChange =
    changedFields.includes("file_name") ||
    changedFields.includes("tc_in") ||
    changedFields.includes("tc_out") ||
    changedFields.includes("content_json");
  const hasCommentChange = changedFields.includes("additional_comment");

  return (
    <div className={`revision-row-preview revision-row-preview-${tone}`}>
      {previewLines.length === 0 ? <p className="muted">-</p> : null}
      {previewLines.map((line) => (
        <div
          key={line.key}
          className={`revision-row-preview-line${line.className ? ` ${line.className}` : ""}${
            line.changed ? " revision-row-preview-line-changed" : ""
          }`}
          style={line.style}
          dangerouslySetInnerHTML={{ __html: line.html }}
        />
      ))}
      {(row.file_name || row.tc_in || row.tc_out) && (
        <div
          className={`revision-row-preview-meta${hasMetaChange ? " revision-row-preview-line-changed" : ""}`}
        >
          {row.file_name || "-"} · {row.tc_in || "-"} → {row.tc_out || "-"}
        </div>
      )}
      {row.additional_comment ? (
        <div
          className={`revision-row-preview-meta revision-row-preview-note${
            hasCommentChange ? " revision-row-preview-line-changed" : ""
          }`}
        >
          В кадре: {row.additional_comment}
        </div>
      ) : null}
    </div>
  );
}

function revisionDiffRowTitle(item: ProjectRevisionRowDiffItem): string {
  const row = item.after_row || item.before_row;
  const order = item.order_after ?? item.order_before;
  const prefix = order ? `Строка ${order}` : "Строка";
  return `${prefix} · ${blockTypeLabel(String(row?.block_type || ""))}`;
}

function primaryRevisionChangeType(item: ProjectRevisionRowDiffItem): string {
  const priority = ["added", "removed", "changed", "moved"];
  return priority.find((type) => item.change_types.includes(type)) || item.change_types[0] || "changed";
}

function revisionDiffSectionTitle(value: string): string {
  switch (value) {
    case "added":
      return "Добавлено";
    case "removed":
      return "Удалено";
    case "changed":
      return "Изменено";
    case "moved":
      return "Перемещено";
    default:
      return value;
  }
}

function isRevisionSubmittable(value?: string | null): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return normalized === "draft" || normalized === "rejected";
}

function isRevisionReviewable(value?: string | null): boolean {
  return (value || "").trim().toLowerCase() === "submitted";
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("ru-RU");
}

function formatTimeShort(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function AutoSizeTextarea({
  minHeight = 64,
  onChange,
  onInput,
  style,
  ...props
}: AutoSizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, minHeight)}px`;
  }, [minHeight, props.value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      style={{
        overflow: "hidden",
        resize: "none",
        ...style,
      }}
      onInput={(event) => {
        const element = event.currentTarget;
        element.style.height = "auto";
        element.style.height = `${Math.max(element.scrollHeight, minHeight)}px`;
        onInput?.(event);
      }}
      onChange={onChange}
    />
  );
}

export default function EditorPage({
  token,
  projectId,
  user,
  onBackToMain,
}: EditorPageProps) {
  const [project, setProject] = useState<ProjectListItem | null>(null);
  const [rows, setRows] = useState<ScriptElementRow[]>([]);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<number[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [history, setHistory] = useState<ProjectHistoryItem[]>([]);
  const [revisions, setRevisions] = useState<ProjectRevisionItem[]>([]);
  const [activeRevision, setActiveRevision] = useState<ProjectRevisionItem | null>(null);
  const [activeRevisionRows, setActiveRevisionRows] = useState<ScriptElementRow[]>([]);
  const [activeRevisionDiff, setActiveRevisionDiff] = useState<ProjectRevisionDiffResponse | null>(null);
  const [revisionDiffAgainstId, setRevisionDiffAgainstId] = useState("");
  const [revisionDiffLoading, setRevisionDiffLoading] = useState(false);
  const [revisionTitle, setRevisionTitle] = useState("");
  const [revisionComment, setRevisionComment] = useState("");
  const [revisionBranchKey, setRevisionBranchKey] = useState("main");
  const [newBranchKey, setNewBranchKey] = useState("");
  const [isRevisionPanelOpen, setRevisionPanelOpen] = useState(false);
  const [isRevisionComposerOpen, setRevisionComposerOpen] = useState(false);
  const [revisionNotice, setRevisionNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [revisionListLoading, setRevisionListLoading] = useState(false);
  const [revisionDetailLoading, setRevisionDetailLoading] = useState(false);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaRubric, setMetaRubric] = useState("");
  const [metaDuration, setMetaDuration] = useState("");
  const [metaStatus, setMetaStatus] = useState<ProjectStatusValue | string>("draft");
  const [metaAuthorUserId, setMetaAuthorUserId] = useState("");
  const [metaExecutorUserIds, setMetaExecutorUserIds] = useState<string[]>([]);
  const [metaProofreaderUserId, setMetaProofreaderUserId] = useState("");
  const [workspaceFileRoots, setWorkspaceFileRoots] = useState<string[]>([]);
  const [workspaceNote, setWorkspaceNote] = useState("");
  const [comments, setComments] = useState<ProjectCommentItem[]>([]);
  const [files, setFiles] = useState<ProjectFileItem[]>([]);
  const [newComment, setNewComment] = useState("");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tableAutosaveState, setTableAutosaveState] = useState<AutosaveState>("idle");
  const [workflowAutosaveState, setWorkflowAutosaveState] = useState<AutosaveState>("idle");
  const [workspaceAutosaveState, setWorkspaceAutosaveState] = useState<AutosaveState>("idle");
  const [lastSuccessfulSaveAt, setLastSuccessfulSaveAt] = useState<string | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);
  const [busyFileId, setBusyFileId] = useState<number | null>(null);
  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const [revisionAction, setRevisionAction] = useState<RevisionActionKind | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"" | "docx" | "pdf">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>("edit");
  const [columnWidths, setColumnWidths] =
    useState<Record<EditorColumnKey, number>>(loadEditorColumnWidths);
  const [activeFormatScope, setActiveFormatScope] = useState<ActiveFormatScope | null>(null);
  const [dragRowIndex, setDragRowIndex] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<{ rowIndex: number; position: RowDropPosition } | null>(
    null
  );
  const [fileBundleDrafts, setFileBundleDrafts] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileBundleInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const outlineItemRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pendingFileBundleFocusRef = useRef<{ rowIndex: number; bundleIndex: number } | null>(null);
  const pendingEditorFocusRef = useRef<ActiveFormatScope | null>(null);
  const tiptapEditorRefs = useRef<Record<string, TiptapEditor | null>>({});
  const lastSavedTableRef = useRef("");
  const lastSavedWorkflowRef = useRef("");
  const lastSavedWorkspaceRef = useRef("");
  const tableSaveRequestIdRef = useRef(0);
  const workflowSaveRequestIdRef = useRef(0);
  const workspaceSaveRequestIdRef = useRef(0);
  const reviewMode = editorViewMode === "review";

  function applyProjectMeta(projectItem: ProjectListItem): void {
    setProject(projectItem);
    setMetaTitle(projectItem.title || "");
    setMetaRubric(projectItem.rubric || "");
    setMetaDuration(projectItem.planned_duration || "");
    setMetaStatus((projectItem.status || "draft") as ProjectStatusValue | string);
    setMetaAuthorUserId(projectItem.author_user_id ? String(projectItem.author_user_id) : "");
    setMetaExecutorUserIds(
      (projectItem.executor_user_ids || [])
        .map((item) => String(item))
        .filter(Boolean)
    );
    setMetaProofreaderUserId(
      projectItem.proofreader_user_id ? String(projectItem.proofreader_user_id) : ""
    );
  }

  function markSuccessfulSave(): void {
    setLastSuccessfulSaveAt(new Date().toISOString());
  }

  async function refreshWorkspaceSection(): Promise<void> {
    const payload = await fetchProjectWorkspace(token, projectId);
    setWorkspaceFileRoots(payload.workspace.file_roots || []);
    setWorkspaceNote(payload.workspace.project_note || "");
    setComments(payload.comments || []);
    setFiles(payload.files || []);
    lastSavedWorkspaceRef.current = createWorkspaceSignature(
      payload.workspace.file_roots || [],
      payload.workspace.project_note || ""
    );
    markSuccessfulSave();
  }

  async function refreshHistorySection(): Promise<void> {
    const payload = await fetchProjectHistory(token, projectId);
    setHistory(payload.items || []);
  }

  async function refreshRevisionsSection(): Promise<void> {
    const payload = await fetchProjectRevisions(token, projectId);
    const items = payload.items || [];
    setRevisions(items);
    if (activeRevision) {
      const nextActive = items.find((item) => item.id === activeRevision.id) || null;
      setActiveRevision(nextActive);
      if (!nextActive) {
        setActiveRevisionRows([]);
        setActiveRevisionDiff(null);
        setRevisionDiffAgainstId("");
      } else if (!items.some((item) => item.id === revisionDiffAgainstId)) {
        setActiveRevisionDiff(null);
        setRevisionDiffAgainstId("");
      }
    }
  }

  function showRevisionNotice(kind: "success" | "error", message: string): void {
    setRevisionNotice({ kind, message });
  }

  function clearRevisionNotice(): void {
    setRevisionNotice(null);
  }

  function closeRevisionPanel(): void {
    setRevisionPanelOpen(false);
    setRevisionComposerOpen(false);
    clearRevisionNotice();
  }

  async function openRevisionPanel(options?: { composer?: boolean }): Promise<void> {
    setRevisionPanelOpen(true);
    setRevisionComposerOpen(Boolean(options?.composer));
    clearRevisionNotice();
    if (!activeRevision && sortedRevisions.length > 0) {
      const preferred = sortedRevisions.find((item) => item.is_current) || sortedRevisions[0];
      await handleOpenRevision(preferred.id);
    }
  }

  async function handleRefreshRevisionHistory(): Promise<void> {
    setRevisionListLoading(true);
    clearRevisionNotice();
    try {
      await refreshRevisionsSection();
      showRevisionNotice("success", "История версий обновлена");
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error ? requestError.message : "Не удалось обновить историю версий"
      );
    } finally {
      setRevisionListLoading(false);
    }
  }

  function getPreferredDiffAgainstId(
    targetRevision: ProjectRevisionItem,
    items: ProjectRevisionItem[]
  ): string {
    if (
      targetRevision.parent_revision_id &&
      items.some((item) => item.id === targetRevision.parent_revision_id)
    ) {
      return targetRevision.parent_revision_id;
    }
    const currentOther = items.find((item) => item.is_current && item.id !== targetRevision.id);
    if (currentOther) {
      return currentOther.id;
    }
    return items.find((item) => item.id !== targetRevision.id)?.id || "";
  }

  async function loadRevisionDiff(
    revisionId: string,
    againstRevisionId: string,
    options?: { silent?: boolean }
  ): Promise<void> {
    const normalizedAgainstId = againstRevisionId.trim();
    setRevisionDiffAgainstId(normalizedAgainstId);

    if (!normalizedAgainstId || normalizedAgainstId === revisionId) {
      setActiveRevisionDiff(null);
      return;
    }

    setRevisionDiffLoading(true);
    if (!options?.silent) {
      clearRevisionNotice();
    }
    try {
      const payload = await fetchProjectRevisionDiff(
        token,
        projectId,
        revisionId,
        normalizedAgainstId
      );
      setActiveRevisionDiff(payload);
    } catch (requestError) {
      setActiveRevisionDiff(null);
      if (!options?.silent) {
        showRevisionNotice(
          "error",
          requestError instanceof Error
            ? requestError.message
            : "Не удалось загрузить diff версии"
        );
      }
    } finally {
      setRevisionDiffLoading(false);
    }
  }

  async function loadEditorPayload(options?: { preserveSuccess?: boolean }): Promise<void> {
    const preserveSuccess = Boolean(options?.preserveSuccess);
    setLoading(true);
    setError("");
    if (!preserveSuccess) {
      setSuccess("");
    }
    try {
      const [editorPayload, workspacePayload, usersPayload, historyPayload, revisionsPayload] = await Promise.all([
        fetchProjectEditor(token, projectId),
        fetchProjectWorkspace(token, projectId),
        fetchUsers(token),
        fetchProjectHistory(token, projectId),
        fetchProjectRevisions(token, projectId),
      ]);

      applyProjectMeta(editorPayload.project);

      const loadedRows = toEditableRows(editorPayload.elements);
      setRows(loadedRows);
      setSelectedRowIndexes([]);
      setActiveFormatScope(null);
      setFileBundleDrafts({});
      setWorkspaceFileRoots(workspacePayload.workspace.file_roots || []);
      setWorkspaceNote(workspacePayload.workspace.project_note || "");
      setComments(workspacePayload.comments || []);
      setFiles(workspacePayload.files || []);
      setUsers(usersPayload.items || []);
      setHistory(historyPayload.items || []);
      setRevisions(revisionsPayload.items || []);
      setActiveRevision((previous) =>
        (revisionsPayload.items || []).find((item) => item.id === previous?.id) || null
      );
      if (!(revisionsPayload.items || []).some((item) => item.id === activeRevision?.id)) {
        setActiveRevisionRows([]);
      }

      lastSavedTableRef.current = createTableSignature(
        loadedRows,
        editorPayload.project.title || "",
        editorPayload.project.rubric || "",
        editorPayload.project.planned_duration || ""
      );
      lastSavedWorkflowRef.current = createWorkflowSignature(
        editorPayload.project.status || "draft",
        editorPayload.project.author_user_id ? String(editorPayload.project.author_user_id) : "",
        (editorPayload.project.executor_user_ids || []).map((item) => String(item)),
        editorPayload.project.proofreader_user_id
          ? String(editorPayload.project.proofreader_user_id)
          : ""
      );
      lastSavedWorkspaceRef.current = createWorkspaceSignature(
        workspacePayload.workspace.file_roots || [],
        workspacePayload.workspace.project_note || ""
      );
      markSuccessfulSave();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Не удалось загрузить данные редактора"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEditorPayload();
  }, [projectId, token]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EDITOR_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    const pending = pendingFileBundleFocusRef.current;
    if (!pending) {
      return;
    }
    const input = fileBundleInputRefs.current[`${pending.rowIndex}:${pending.bundleIndex}`];
    if (!input) {
      return;
    }
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
    pendingFileBundleFocusRef.current = null;
  }, [rows]);

  useEffect(() => {
    const pending = pendingEditorFocusRef.current;
    if (!pending) {
      return;
    }
    const editorId = getRichTextEditorId(pending.rowIndex, pending.target);
    const editor = tiptapEditorRefs.current[editorId];
    if (!editor) {
      return;
    }

    editor.commands.focus();
    setActiveFormatScope(pending);
    setSelectedRowIndexes([pending.rowIndex]);
    pendingEditorFocusRef.current = null;
  }, [rows]);

  useEffect(() => {
    if (selectedRowIndexes.length === 0) {
      return;
    }
    const currentIndex = selectedRowIndexes[selectedRowIndexes.length - 1];
    const outlineButton = outlineItemRefs.current[currentIndex];
    if (!outlineButton) {
      return;
    }
    outlineButton.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [selectedRowIndexes]);

  const projectStatus = project?.status || "";
  const archivedProject = normalizeProjectStatus(projectStatus) === "archived";
  const rowsEditable = useMemo(
    () => canEditProjectRows(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const metaEditable = useMemo(
    () => canEditProjectMeta(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const assignmentEditable = useMemo(
    () => canAssignProject(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const statusEditable = useMemo(
    () => canChangeProjectStatus(user.role, projectStatus),
    [projectStatus, user.role]
  );

  const tableSignature = useMemo(
    () => createTableSignature(rows, metaTitle, metaRubric, metaDuration),
    [rows, metaDuration, metaRubric, metaTitle]
  );
  const workflowSignature = useMemo(
    () =>
      createWorkflowSignature(
        String(metaStatus || "draft"),
        metaAuthorUserId,
        metaExecutorUserIds,
        metaProofreaderUserId
      ),
    [metaAuthorUserId, metaExecutorUserIds, metaProofreaderUserId, metaStatus]
  );
  const workspaceSignature = useMemo(
    () => createWorkspaceSignature(workspaceFileRoots, workspaceNote),
    [workspaceFileRoots, workspaceNote]
  );
  const hasPendingTableChanges = tableSignature !== lastSavedTableRef.current;
  const hasPendingWorkflowChanges = workflowSignature !== lastSavedWorkflowRef.current;
  const hasPendingWorkspaceChanges = workspaceSignature !== lastSavedWorkspaceRef.current;
  const hasPendingEditorChanges =
    hasPendingTableChanges || hasPendingWorkflowChanges || hasPendingWorkspaceChanges;
  const isEditorSaving =
    saving ||
    tableAutosaveState === "saving" ||
    workflowAutosaveState === "saving" ||
    workspaceAutosaveState === "saving";
  const hasEditorSaveError =
    tableAutosaveState === "error" ||
    workflowAutosaveState === "error" ||
    workspaceAutosaveState === "error";

  function buildNextRowWithRichFieldValue(
    row: ScriptElementRow,
    target: FormatTargetKey,
    payload: RichTextChangePayload
  ): ScriptElementRow {
    const { text, html } = payload;
    const nextFormatting = updateFormattingHtml(row, target, html);
    const nextRichText = updateRichTextTarget(row, target, payload);

    if (target === "speaker_fio" || target === "speaker_position") {
      const currentSnh = parseSnhSpeakerText(row.speaker_text);
      const nextFio = target === "speaker_fio" ? text : currentSnh.fio;
      const nextPosition = target === "speaker_position" ? text : currentSnh.position;
      return {
        ...row,
        speaker_text: buildSnhSpeakerText(nextFio, nextPosition),
        formatting: nextFormatting,
        rich_text: nextRichText,
      };
    }

    if (target === "geo") {
      const current = parseZkGeoStructuredData(row);
      return {
        ...row,
        structured_data: buildStructuredDataWithFileBundles(
          buildZkGeoStructuredData(text, current.text),
          parseRowFileBundles(row)
        ),
        formatting: nextFormatting,
        rich_text: nextRichText,
      };
    }

    if (isZkGeoBlock(row.block_type)) {
      const current = parseZkGeoStructuredData(row);
      return {
        ...row,
        text,
        structured_data: buildStructuredDataWithFileBundles(
          buildZkGeoStructuredData(current.geo, text),
          parseRowFileBundles(row)
        ),
        formatting: nextFormatting,
        rich_text: nextRichText,
      };
    }

    return {
      ...row,
      text,
      formatting: nextFormatting,
      rich_text: nextRichText,
    };
  }

  function applyRichFieldValue(
    rowIndex: number,
    target: FormatTargetKey,
    payload: RichTextChangePayload
  ): void {
    setRows((previousRows) =>
      previousRows.map((row, currentIndex) =>
        currentIndex === rowIndex
          ? buildNextRowWithRichFieldValue(row, target, payload)
          : row
      )
    );
  }

  function updateRow(index: number, patch: Partial<ScriptElementRow>): void {
    setRows((previousRows) =>
      previousRows.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              ...patch,
            }
          : row
      )
    );
  }

  function updateSnhRow(index: number, patch: { fio?: string; position?: string; text?: string }): void {
    setRows((previousRows) =>
      previousRows.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }
        const currentSnh = parseSnhSpeakerText(row.speaker_text);
        const nextText = patch.text ?? row.text;
        const nextFio = patch.fio ?? currentSnh.fio;
        const nextPosition = patch.position ?? currentSnh.position;

        return {
          ...row,
          text: nextText,
          speaker_text: buildSnhSpeakerText(nextFio, nextPosition),
        };
      })
    );
  }

  function updateZkGeoRow(index: number, patch: { geo?: string; text?: string }): void {
    setRows((previousRows) =>
      previousRows.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }
        const current = parseZkGeoStructuredData(row);
        const nextGeo = patch.geo ?? current.geo;
        const nextText = patch.text ?? current.text;

        return {
          ...row,
          text: nextText,
          structured_data: buildStructuredDataWithFileBundles(
            buildZkGeoStructuredData(nextGeo, nextText),
            parseRowFileBundles(row)
          ),
        };
      })
    );
  }

  function updateFileBundle(
    rowIndex: number,
    bundleIndex: number,
    patch: Partial<FileBundleItem>
  ): void {
    setRows((previousRows) =>
      previousRows.map((row, currentIndex) => {
        if (currentIndex !== rowIndex) {
          return row;
        }
        const bundles = parseRowFileBundles(row);
        const nextBundles = bundles.map((item, currentBundleIndex) =>
          currentBundleIndex === bundleIndex ? normalizeFileBundleItem({ ...item, ...patch }) : item
        );
        return updateRowFileBundles(row, nextBundles);
      })
    );
  }

  function handleFileBundleTimecodeBlur(
    rowIndex: number,
    bundleIndex: number,
    field: "tc_in" | "tc_out",
    rawValue: string
  ): void {
    const normalized = normalizeTimecodeInputValue(rawValue);
    if (normalized === String(rawValue || "").trim()) {
      return;
    }
    updateFileBundle(rowIndex, bundleIndex, {
      [field]: normalized,
    });
  }

  function registerFileBundleInput(
    rowIndex: number,
    bundleIndex: number,
    element: HTMLInputElement | null
  ): void {
    fileBundleInputRefs.current[`${rowIndex}:${bundleIndex}`] = element;
  }

  function registerRowRef(rowIndex: number, element: HTMLTableRowElement | null): void {
    rowRefs.current[rowIndex] = element;
  }

  function registerOutlineItemRef(rowIndex: number, element: HTMLButtonElement | null): void {
    outlineItemRefs.current[rowIndex] = element;
  }

  function removeFileBundle(rowIndex: number, bundleIndex: number): void {
    setRows((previousRows) =>
      previousRows.map((row, currentIndex) => {
        if (currentIndex !== rowIndex) {
          return row;
        }
        const currentBundles = parseRowFileBundles(row);
        const nextBundles = currentBundles.filter((_item, index) => index !== bundleIndex);
        return updateRowFileBundles(
          row,
          nextBundles.length > 0 ? nextBundles : [normalizeFileBundleItem(null)]
        );
      })
    );
  }

  function handleExistingFileBundleInputChange(
    rowIndex: number,
    bundleIndex: number,
    rawValue: string
  ): void {
    setRows((previousRows) =>
      previousRows.map((row, currentIndex) => {
        if (currentIndex !== rowIndex) {
          return row;
        }
        const bundles = parseRowFileBundles(row);
        const currentBundle = bundles[bundleIndex];
        if (!currentBundle) {
          return row;
        }
        const previousFileName = bundleIndex > 0 ? bundles[bundleIndex - 1]?.file_name || "" : "";
        const parsed = parseFileBundleInputValue(rawValue, previousFileName);
        const nextBundle =
          parsed.normalized === ""
            ? normalizeFileBundleItem({
                ...currentBundle,
                file_name: "",
              })
            : normalizeFileBundleItem({
                ...currentBundle,
                file_name: parsed.resolved_file_name,
              });

        const nextBundles = bundles.map((item, currentBundleIndex) =>
          currentBundleIndex === bundleIndex ? nextBundle : item
        );
        const filteredBundles = nextBundles.filter(
          (item, currentBundleIndex) =>
            currentBundleIndex !== bundleIndex || isMeaningfulFileBundle(item)
        );
        return updateRowFileBundles(row, filteredBundles);
      })
    );
  }

  function handleDraftFileBundleInputChange(rowIndex: number, rawValue: string): void {
    setFileBundleDrafts((previous) => ({
      ...previous,
      [rowIndex]: rawValue,
    }));

    const row = rows[rowIndex];
    if (!row) {
      return;
    }
    const bundles = parseRowFileBundles(row);
    const previousFileName = bundles.length > 0 ? bundles[bundles.length - 1].file_name : "";
    const parsed = parseFileBundleInputValue(rawValue, previousFileName);
    if (!parsed.is_committable) {
      return;
    }

    pendingFileBundleFocusRef.current = {
      rowIndex,
      bundleIndex: bundles.length,
    };
    setRows((previousRows) =>
      previousRows.map((currentRow, currentIndex) =>
        currentIndex === rowIndex
          ? updateRowFileBundles(currentRow, [
              ...parseRowFileBundles(currentRow),
              normalizeFileBundleItem({
                file_name: parsed.resolved_file_name,
                tc_in: "",
                tc_out: "",
              }),
            ])
          : currentRow
      )
    );
    setFileBundleDrafts((previous) => ({
      ...previous,
      [rowIndex]: "",
    }));
  }

  function registerTiptapEditor(editorId: string, editor: TiptapEditor | null): void {
    tiptapEditorRefs.current[editorId] = editor;
  }

  function handleTiptapSelectionChange(editorId: RichTextEditorId): void {
    const binding = parseRichTextEditorId(editorId);
    if (!binding) {
      return;
    }
    setActiveFormatScope({
      rowIndex: binding.rowIndex,
      target: binding.target,
    });
  }

  function executeSelectionFormatting(
    command: (editor: TiptapEditor) => void,
    options?: { collapseSelection?: boolean }
  ): boolean {
    if (!activeFormatScope) {
      return false;
    }
    const editorId = getRichTextEditorId(activeFormatScope.rowIndex, activeFormatScope.target);
    const tiptapEditor = tiptapEditorRefs.current[editorId];
    if (!tiptapEditor) {
      return false;
    }
    tiptapEditor.commands.focus();
    const { from, to } = tiptapEditor.state.selection;
    if (from === to) {
      return false;
    }
    command(tiptapEditor);
    if (options?.collapseSelection) {
      tiptapEditor.chain().focus().setTextSelection(to).run();
    }
    handleTiptapSelectionChange(editorId);
    return true;
  }

  function updateRowFormatting(
    row: ScriptElementRow,
    target: FormatTargetKey,
    patch: Partial<ScriptElementFormattingTarget>
  ): ScriptElementFormatting {
    const normalized = normalizeFormatting(row.block_type, row.formatting);
    const currentTarget = normalized.targets?.[target];
    if (!currentTarget) {
      return normalized;
    }
    return {
      targets: {
        ...normalized.targets,
        [target]: {
          ...currentTarget,
          ...patch,
        },
      },
      html_by_target: {
        ...(normalized.html_by_target || {}),
      },
    };
  }

  function applyFormattingPatch(
    target: FormatTargetKey,
    patch: Partial<ScriptElementFormattingTarget>
  ): void {
    const targetIndexes =
      selectedRowIndexes.length > 0
        ? selectedRowIndexes
        : activeFormatScope
          ? [activeFormatScope.rowIndex]
          : [];
    if (targetIndexes.length === 0) {
      return;
    }

    setRows((previousRows) =>
      previousRows.map((row, rowIndex) => {
        if (!targetIndexes.includes(rowIndex)) {
          return row;
        }
        const formattingTarget = getFormattingTarget(row, target);
        if (!formattingTarget) {
          return row;
        }
        return {
          ...row,
          formatting: updateRowFormatting(row, target, patch),
        };
      })
    );
  }

  function applyFormattingChange(
    target: FormatTargetKey,
    patch: Partial<ScriptElementFormattingTarget>,
    richCommand?: (editor: TiptapEditor) => void,
    options?: { collapseSelection?: boolean }
  ): void {
    if (richCommand && executeSelectionFormatting(richCommand, options)) {
      return;
    }
    applyFormattingPatch(target, patch);
  }

  function handleFieldFocus(index: number, target: FormatTargetKey): void {
    setActiveFormatScope({ rowIndex: index, target });
    setSelectedRowIndexes((previousIndexes) =>
      previousIndexes.length === 1 && previousIndexes[0] === index ? previousIndexes : [index]
    );
  }

  function focusPrimaryField(rowIndex: number, blockType: string, target?: FormatTargetKey): void {
    const nextScope =
      typeof target === "string"
        ? {
            rowIndex,
            target,
          }
        : primaryFocusScopeForBlock(rowIndex, blockType);
    pendingEditorFocusRef.current = nextScope;
    setSelectedRowIndexes([rowIndex]);
    setActiveFormatScope(nextScope);
  }

  function handleBlockTypeChange(index: number, nextBlockType: string): void {
    focusPrimaryField(index, nextBlockType);
    setRows((previousRows) =>
      previousRows.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }
        const nextText = isZkGeoBlock(nextBlockType) ? parseZkGeoStructuredData(row).text : row.text;
        const nextSpeakerText = isSnhBlock(nextBlockType) ? row.speaker_text : "";
        const currentFileBundles = parseRowFileBundles(row);
        const nextStructuredData = isZkGeoBlock(nextBlockType)
          ? buildStructuredDataWithFileBundles(
              buildZkGeoStructuredData("", row.text),
              currentFileBundles
            )
          : buildStructuredDataWithFileBundles({}, currentFileBundles);
        return {
          ...row,
          block_type: nextBlockType,
          text: nextText,
          speaker_text: nextSpeakerText,
          structured_data: nextStructuredData,
          formatting: normalizeFormatting(nextBlockType, row.formatting),
          rich_text: normalizeRichTextForBlockChange(
            row,
            nextBlockType,
            nextText,
            nextSpeakerText,
            nextStructuredData
          ),
        };
      })
    );
  }

  function insertRow(blockType: string, insertAfterIndex?: number): void {
    const insertionIndex =
      typeof insertAfterIndex === "number" ? Math.max(0, insertAfterIndex + 1) : rows.length;
    focusPrimaryField(insertionIndex, blockType);
    setRows((previousRows) => {
      const nextInsertionIndex =
        typeof insertAfterIndex === "number"
          ? Math.max(0, Math.min(insertAfterIndex + 1, previousRows.length))
          : previousRows.length;
      const nextRows = [...previousRows];
      nextRows.splice(nextInsertionIndex, 0, buildEmptyRow(blockType, nextInsertionIndex + 1));
      return toEditableRows(nextRows);
    });
  }

  function duplicateRow(index: number): void {
    const sourceRow = rows[index];
    if (!sourceRow) {
      return;
    }

    const insertionIndex = index + 1;
    focusPrimaryField(insertionIndex, String(sourceRow.block_type || "zk"));
    setRows((previousRows) => {
      const rowToClone = previousRows[index];
      if (!rowToClone) {
        return previousRows;
      }
      const nextRows = [...previousRows];
      nextRows.splice(insertionIndex, 0, cloneRowDraftForInsert(rowToClone));
      return toEditableRows(nextRows);
    });
  }

  function moveRow(index: number, direction: -1 | 1): void {
    const sourceRow = rows[index];
    const nextIndex = index + direction;
    if (!sourceRow || nextIndex < 0 || nextIndex >= rows.length) {
      return;
    }

    const nextTarget =
      activeFormatScope?.rowIndex === index
        ? activeFormatScope.target
        : preferredFocusTargetForBlock(String(sourceRow.block_type || "zk"));
    focusPrimaryField(nextIndex, String(sourceRow.block_type || "zk"), nextTarget);
    setRows((previousRows) => {
      if (nextIndex < 0 || nextIndex >= previousRows.length) {
        return previousRows;
      }
      const nextRows = [...previousRows];
      const [movedRow] = nextRows.splice(index, 1);
      nextRows.splice(nextIndex, 0, movedRow);
      return toEditableRows(nextRows);
    });
  }

  function reorderRow(fromIndex: number, targetIndex: number): void {
    const sourceRow = rows[fromIndex];
    if (!sourceRow || fromIndex === targetIndex || targetIndex < 0 || targetIndex >= rows.length) {
      return;
    }

    const nextTarget =
      activeFormatScope?.rowIndex === fromIndex
        ? activeFormatScope.target
        : preferredFocusTargetForBlock(String(sourceRow.block_type || "zk"));
    focusPrimaryField(targetIndex, String(sourceRow.block_type || "zk"), nextTarget);
    setRows((previousRows) => {
      if (fromIndex === targetIndex || targetIndex < 0 || targetIndex >= previousRows.length) {
        return previousRows;
      }
      const nextRows = [...previousRows];
      const [movedRow] = nextRows.splice(fromIndex, 1);
      nextRows.splice(targetIndex, 0, movedRow);
      return toEditableRows(nextRows);
    });
  }

  function handleRowDragStart(index: number, event: ReactDragEvent<HTMLButtonElement>): void {
    if (!rowsEditable || reviewMode) {
      event.preventDefault();
      return;
    }

    setDragRowIndex(index);
    setDragTarget(null);
    setSelectedRowIndexes([index]);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function handleRowDragOver(index: number, event: ReactDragEvent<HTMLTableRowElement>): void {
    if (!rowsEditable || reviewMode || dragRowIndex === null) {
      return;
    }

    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const position: RowDropPosition =
      event.clientY - bounds.top < bounds.height / 2 ? "before" : "after";
    setDragTarget((previous) =>
      previous?.rowIndex === index && previous.position === position
        ? previous
        : {
            rowIndex: index,
            position,
          }
    );
  }

  function handleRowDrop(index: number, event: ReactDragEvent<HTMLTableRowElement>): void {
    if (!rowsEditable || reviewMode || dragRowIndex === null) {
      return;
    }

    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const position: RowDropPosition =
      event.clientY - bounds.top < bounds.height / 2 ? "before" : "after";
    let nextIndex = position === "before" ? index : index + 1;
    if (dragRowIndex < nextIndex) {
      nextIndex -= 1;
    }

    if (nextIndex >= 0 && nextIndex < rows.length) {
      reorderRow(dragRowIndex, nextIndex);
    }
    setDragRowIndex(null);
    setDragTarget(null);
  }

  function handleRowDragEnd(): void {
    setDragRowIndex(null);
    setDragTarget(null);
  }

  function deleteRow(index: number): void {
    if (!rows[index]) {
      return;
    }

    const previewRows = toEditableRows(rows.filter((_row, rowIndex) => rowIndex !== index));
    const nextIndex = Math.min(index, previewRows.length - 1);
    const nextRow = previewRows[nextIndex];
    if (nextRow) {
      focusPrimaryField(nextIndex, String(nextRow.block_type || "zk"));
    } else {
      setSelectedRowIndexes([]);
      setActiveFormatScope(null);
      pendingEditorFocusRef.current = null;
    }

    setRows((previousRows) =>
      toEditableRows(previousRows.filter((_row, rowIndex) => rowIndex !== index))
    );
  }

  function handleAddRowSelection(blockType: string): void {
    if (!blockType) {
      return;
    }
    const insertAfterIndex =
      selectedRowIndexes.length > 0 ? selectedRowIndexes[selectedRowIndexes.length - 1] : undefined;
    insertRow(blockType, insertAfterIndex);
  }

  function jumpToRow(index: number): void {
    const targetRow = rows[index];
    if (!targetRow) {
      return;
    }

    focusPrimaryField(index, String(targetRow.block_type || "zk"));
    const rowElement = rowRefs.current[index];
    if (rowElement) {
      rowElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }

  function toggleRowSelection(index: number, multi: boolean): void {
    setSelectedRowIndexes((previousIndexes) => {
      if (!multi) {
        return previousIndexes[0] === index && previousIndexes.length === 1 ? [] : [index];
      }
      return previousIndexes.includes(index)
        ? previousIndexes.filter((item) => item !== index)
        : [...previousIndexes, index].sort((a, b) => a - b);
    });
  }

  function deleteSelectedRows(): void {
    if (selectedRowIndexes.length === 0) {
      return;
    }
    const selectedSet = new Set(selectedRowIndexes);
    const previewRows = toEditableRows(rows.filter((_row, index) => !selectedSet.has(index)));
    const nextIndex = Math.min(selectedRowIndexes[0], previewRows.length - 1);
    const nextRow = previewRows[nextIndex];

    if (nextRow) {
      focusPrimaryField(nextIndex, String(nextRow.block_type || "zk"));
    } else {
      setSelectedRowIndexes([]);
      setActiveFormatScope(null);
      pendingEditorFocusRef.current = null;
    }

    setRows((previousRows) =>
      toEditableRows(previousRows.filter((_row, index) => !selectedSet.has(index)))
    );
  }

  async function handleManualTableSave(): Promise<void> {
    if (!rowsEditable || saving) {
      return;
    }
    await persistTable({ showSuccess: true, refreshFromServer: true });
  }

  async function persistTable({
    showSuccess,
    refreshFromServer,
    throwOnError = false,
  }: {
    showSuccess: boolean;
    refreshFromServer: boolean;
    throwOnError?: boolean;
  }): Promise<void> {
    const requestId = ++tableSaveRequestIdRef.current;
    const normalizedRows = normalizeOrder(rows);
    const titleSnapshot = metaTitle;
    const rubricSnapshot = metaRubric;
    const durationSnapshot = metaDuration;

    setSaving(true);
    setTableAutosaveState("saving");
    setError("");
    if (showSuccess) {
      setSuccess("");
    }

    try {
      let updatedProject = project;
      if (metaEditable) {
        const metaResponse = await updateProjectMeta(token, projectId, {
          title: titleSnapshot,
          rubric: rubricSnapshot,
          planned_duration: durationSnapshot,
        });
        updatedProject = metaResponse.project;
      }

      const payload = await saveProjectEditor(token, projectId, normalizedRows);
      if (requestId !== tableSaveRequestIdRef.current) {
        return;
      }

      const persistedRows = toEditableRows(payload.elements || normalizedRows);
      if (updatedProject) {
        applyProjectMeta(updatedProject);
      }
      setRows(persistedRows);
      lastSavedTableRef.current = createTableSignature(
        persistedRows,
        updatedProject?.title || titleSnapshot,
        updatedProject?.rubric || rubricSnapshot,
        updatedProject?.planned_duration || durationSnapshot
      );
      setTableAutosaveState("idle");
      markSuccessfulSave();
      if (showSuccess) {
        setSuccess(
          `${payload.message}: обновлено ${payload.updated}, добавлено ${payload.inserted}, удалено ${payload.removed}.`
        );
      }
      if (refreshFromServer) {
        await refreshHistorySection();
      }
    } catch (requestError) {
      if (requestId !== tableSaveRequestIdRef.current) {
        return;
      }
      setTableAutosaveState("error");
      setError(requestError instanceof Error ? requestError.message : "Ошибка сохранения таблицы");
      if (throwOnError) {
        throw requestError instanceof Error ? requestError : new Error("Ошибка сохранения таблицы");
      }
    } finally {
      if (requestId === tableSaveRequestIdRef.current) {
        setSaving(false);
      }
    }
  }

  async function persistWorkflow({ showSuccess }: { showSuccess: boolean }): Promise<void> {
    if (!assignmentEditable && !statusEditable) {
      return;
    }
    const requestId = ++workflowSaveRequestIdRef.current;
    setWorkflowAutosaveState("saving");
    setError("");
    if (showSuccess) {
      setSuccess("");
    }

    try {
      const response = await updateProjectMeta(token, projectId, {
        status: statusEditable ? String(metaStatus) : undefined,
        author_user_id: assignmentEditable
          ? metaAuthorUserId
            ? Number(metaAuthorUserId)
            : null
          : undefined,
        executor_user_ids: assignmentEditable
          ? normalizeIdList(metaExecutorUserIds).map((item) => Number(item))
          : undefined,
        proofreader_user_id: assignmentEditable
          ? metaProofreaderUserId
            ? Number(metaProofreaderUserId)
            : null
          : undefined,
      });
      if (requestId !== workflowSaveRequestIdRef.current) {
        return;
      }
      applyProjectMeta(response.project);
      lastSavedWorkflowRef.current = createWorkflowSignature(
        response.project.status || "draft",
        response.project.author_user_id ? String(response.project.author_user_id) : "",
        (response.project.executor_user_ids || []).map((item) => String(item)),
        response.project.proofreader_user_id ? String(response.project.proofreader_user_id) : ""
      );
      setWorkflowAutosaveState("idle");
      markSuccessfulSave();
      await refreshHistorySection();
      if (showSuccess) {
        setSuccess(response.message);
      }
    } catch (requestError) {
      if (requestId !== workflowSaveRequestIdRef.current) {
        return;
      }
      setWorkflowAutosaveState("error");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка сохранения workflow проекта"
      );
    }
  }

  async function persistWorkspace({ showSuccess }: { showSuccess: boolean }): Promise<void> {
    const requestId = ++workspaceSaveRequestIdRef.current;
    const fileRootsSnapshot = workspaceFileRoots.map((item) => item.trim()).filter(Boolean);

    setWorkspaceAutosaveState("saving");
    setError("");
    if (showSuccess) {
      setSuccess("");
    }

    try {
      const payload = await updateProjectWorkspace(token, projectId, {
        file_roots: fileRootsSnapshot,
        project_note: workspaceNote,
      });
      if (requestId !== workspaceSaveRequestIdRef.current) {
        return;
      }
      setWorkspaceFileRoots(fileRootsSnapshot);
      lastSavedWorkspaceRef.current = createWorkspaceSignature(fileRootsSnapshot, workspaceNote);
      setWorkspaceAutosaveState("idle");
      markSuccessfulSave();
      if (showSuccess) {
        setSuccess(payload.message);
      }
    } catch (requestError) {
      if (requestId !== workspaceSaveRequestIdRef.current) {
        return;
      }
      setWorkspaceAutosaveState("error");
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка сохранения путей к файлам"
      );
    }
  }

  async function handleOpenRevision(revisionId: string): Promise<void> {
    if (activeRevision?.id === revisionId && activeRevisionRows.length > 0) {
      setRevisionPanelOpen(true);
      return;
    }

    setBusyRevisionId(revisionId);
    setRevisionAction("open");
    clearRevisionNotice();
    setRevisionPanelOpen(true);
    setRevisionDetailLoading(true);
    try {
      const payload = await fetchProjectRevisionElements(token, projectId, revisionId);
      setActiveRevision(payload.revision);
      setActiveRevisionRows(toEditableRows(payload.elements || []));
      setRevisionBranchKey(payload.revision.branch_key || "main");
      const againstId = getPreferredDiffAgainstId(payload.revision, revisions);
      if (againstId) {
        await loadRevisionDiff(payload.revision.id, againstId, { silent: true });
      } else {
        setActiveRevisionDiff(null);
        setRevisionDiffAgainstId("");
      }
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error ? requestError.message : "Не удалось загрузить версию текста"
      );
    } finally {
      setRevisionDetailLoading(false);
      setBusyRevisionId(null);
      setRevisionAction(null);
    }
  }

  async function handleCreateRevision(): Promise<void> {
    setRevisionAction("create");
    setBusyRevisionId(null);
    clearRevisionNotice();
    setRevisionPanelOpen(true);

    try {
      await persistTable({ showSuccess: false, refreshFromServer: false, throwOnError: true });
      const payload = await createProjectRevision(token, projectId, {
        title: revisionTitle.trim(),
        comment: revisionComment.trim(),
        branch_key: revisionBranchKey.trim() || "main",
        parent_revision_id: activeRevision?.id || undefined,
      });
      setRevisionTitle("");
      setRevisionComment("");
      setRevisionComposerOpen(false);
      await refreshRevisionsSection();
      await refreshHistorySection();
      await handleOpenRevision(payload.revision.id);
      showRevisionNotice("success", payload.message);
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error ? requestError.message : "Не удалось создать версию текста"
      );
    } finally {
      setRevisionAction(null);
      setBusyRevisionId(null);
    }
  }

  async function handleCreateBranch(revisionId: string): Promise<void> {
    const normalizedBranchKey = newBranchKey.trim();
    if (!normalizedBranchKey) {
      showRevisionNotice("error", "Укажи имя новой ветки");
      return;
    }

    setBusyRevisionId(revisionId);
    setRevisionAction("branch");
    clearRevisionNotice();
    setRevisionPanelOpen(true);

    try {
      const payload = await branchProjectRevision(token, projectId, revisionId, {
        branch_key: normalizedBranchKey,
      });
      setNewBranchKey("");
      await refreshRevisionsSection();
      await refreshHistorySection();
      await handleOpenRevision(payload.revision.id);
      showRevisionNotice("success", payload.message);
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error ? requestError.message : "Не удалось создать ветку"
      );
    } finally {
      setBusyRevisionId(null);
      setRevisionAction(null);
    }
  }

  async function handleSubmitRevision(revisionId: string): Promise<void> {
    setBusyRevisionId(revisionId);
    setRevisionAction("submit");
    clearRevisionNotice();
    setRevisionPanelOpen(true);

    try {
      const payload = await submitProjectRevision(token, projectId, revisionId);
      await refreshRevisionsSection();
      await refreshHistorySection();
      setActiveRevision((previous) =>
        previous && previous.id === payload.revision.id ? payload.revision : previous
      );
      showRevisionNotice("success", payload.message);
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error
          ? requestError.message
          : "Не удалось отправить версию на согласование"
      );
    } finally {
      setBusyRevisionId(null);
      setRevisionAction(null);
    }
  }

  async function handleApproveRevision(revisionId: string): Promise<void> {
    setBusyRevisionId(revisionId);
    setRevisionAction("approve");
    clearRevisionNotice();
    setRevisionPanelOpen(true);

    try {
      const payload = await approveProjectRevision(token, projectId, revisionId);
      await refreshRevisionsSection();
      await refreshHistorySection();
      setActiveRevision((previous) =>
        previous && previous.id === payload.revision.id ? payload.revision : previous
      );
      showRevisionNotice("success", payload.message);
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error ? requestError.message : "Не удалось утвердить версию"
      );
    } finally {
      setBusyRevisionId(null);
      setRevisionAction(null);
    }
  }

  async function handleMergeRevision(revisionId: string): Promise<void> {
    setBusyRevisionId(revisionId);
    setRevisionAction("merge");
    clearRevisionNotice();
    setRevisionPanelOpen(true);

    try {
      const payload = await mergeProjectRevisionToMain(token, projectId, revisionId);
      await loadEditorPayload({ preserveSuccess: true });
      setActiveRevision(payload.revision);
      setRevisionBranchKey(payload.revision.branch_key || "main");
      showRevisionNotice("success", payload.message);
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error ? requestError.message : "Не удалось слить ветку в main"
      );
    } finally {
      setBusyRevisionId(null);
      setRevisionAction(null);
    }
  }

  async function handleRejectRevision(revisionId: string): Promise<void> {
    setBusyRevisionId(revisionId);
    setRevisionAction("reject");
    clearRevisionNotice();
    setRevisionPanelOpen(true);

    try {
      const payload = await rejectProjectRevision(token, projectId, revisionId);
      await refreshRevisionsSection();
      await refreshHistorySection();
      setActiveRevision((previous) =>
        previous && previous.id === payload.revision.id ? payload.revision : previous
      );
      showRevisionNotice("success", payload.message);
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error ? requestError.message : "Не удалось отклонить версию"
      );
    } finally {
      setBusyRevisionId(null);
      setRevisionAction(null);
    }
  }

  async function handleRestoreRevision(revisionId: string): Promise<void> {
    setBusyRevisionId(revisionId);
    setRevisionAction("restore");
    clearRevisionNotice();
    setRevisionPanelOpen(true);

    try {
      const payload = await restoreProjectRevisionToWorkspace(token, projectId, revisionId);
      await loadEditorPayload({ preserveSuccess: true });
      showRevisionNotice("success", payload.message);
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error
          ? requestError.message
          : "Не удалось восстановить workspace из версии"
      );
    } finally {
      setBusyRevisionId(null);
      setRevisionAction(null);
    }
  }

  async function handleMarkRevisionCurrent(revisionId: string): Promise<void> {
    setBusyRevisionId(revisionId);
    setRevisionAction("current");
    clearRevisionNotice();
    setRevisionPanelOpen(true);

    try {
      const payload = await markProjectRevisionCurrent(token, projectId, revisionId);
      await refreshRevisionsSection();
      await refreshHistorySection();
      setActiveRevision((previous) =>
        previous && previous.id === payload.revision.id ? payload.revision : previous
      );
      showRevisionNotice("success", payload.message);
    } catch (requestError) {
      showRevisionNotice(
        "error",
        requestError instanceof Error
          ? requestError.message
          : "Не удалось отметить версию как текущую"
      );
    } finally {
      setBusyRevisionId(null);
      setRevisionAction(null);
    }
  }

  useEffect(() => {
    if (loading || !project) {
      return;
    }
    if (tableSignature === lastSavedTableRef.current) {
      return;
    }
    if (!rowsEditable && !metaEditable) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistTable({ showSuccess: false, refreshFromServer: false });
    }, 800);

    return () => window.clearTimeout(timeoutId);
  }, [loading, metaEditable, project, rowsEditable, tableSignature]);

  useEffect(() => {
    if (loading || !project) {
      return;
    }
    if (workflowSignature === lastSavedWorkflowRef.current) {
      return;
    }
    if (!assignmentEditable && !statusEditable) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistWorkflow({ showSuccess: false });
    }, 800);

    return () => window.clearTimeout(timeoutId);
  }, [assignmentEditable, loading, project, statusEditable, workflowSignature]);

  useEffect(() => {
    if (loading || !project) {
      return;
    }
    if (workspaceSignature === lastSavedWorkspaceRef.current) {
      return;
    }
    if (!rowsEditable) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistWorkspace({ showSuccess: false });
    }, 800);

    return () => window.clearTimeout(timeoutId);
  }, [loading, project, rowsEditable, workspaceSignature]);

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent): void {
      const activeElement = document.activeElement as HTMLElement | null;
      const editableTarget = isEditableKeyboardTarget(activeElement);
      const selectedIndex =
        selectedRowIndexes.length > 0 ? selectedRowIndexes[selectedRowIndexes.length - 1] : -1;
      const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null;
      const key = event.key.toLowerCase();

      if (isRevisionPanelOpen) {
        return;
      }

      if (
        reviewMode &&
        event.altKey &&
        !event.shiftKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        selectedIndex >= 0
      ) {
        event.preventDefault();
        const delta = event.key === "ArrowUp" ? -1 : 1;
        const nextIndex = selectedIndex + delta;
        const nextRow = rows[nextIndex];
        if (nextRow) {
          focusPrimaryField(nextIndex, String(nextRow.block_type || "zk"));
        }
        return;
      }

      if (reviewMode) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        void handleManualTableSave();
        return;
      }

      if (!rowsEditable || selectedRowIndexes.length === 0 || editableTarget) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === "d" && selectedRow) {
        event.preventDefault();
        duplicateRow(selectedIndex);
        return;
      }

      if (event.altKey && event.shiftKey && event.key === "ArrowUp" && selectedRow) {
        event.preventDefault();
        moveRow(selectedIndex, -1);
        return;
      }

      if (event.altKey && event.shiftKey && event.key === "ArrowDown" && selectedRow) {
        event.preventDefault();
        moveRow(selectedIndex, 1);
        return;
      }

      if (event.altKey && !event.shiftKey && event.key === "ArrowUp" && selectedIndex > 0) {
        event.preventDefault();
        const previousRow = rows[selectedIndex - 1];
        if (previousRow) {
          focusPrimaryField(selectedIndex - 1, String(previousRow.block_type || "zk"));
        }
        return;
      }

      if (
        event.altKey &&
        !event.shiftKey &&
        event.key === "ArrowDown" &&
        selectedIndex < rows.length - 1
      ) {
        event.preventDefault();
        const nextRow = rows[selectedIndex + 1];
        if (nextRow) {
          focusPrimaryField(selectedIndex + 1, String(nextRow.block_type || "zk"));
        }
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedRowIndexes.length > 0) {
        event.preventDefault();
        deleteSelectedRows();
        return;
      }

      if (event.key !== "Enter" || !selectedRow) {
        return;
      }

      event.preventDefault();
      insertRow(String(selectedRow.block_type || "zk"), selectedIndex);
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [isRevisionPanelOpen, reviewMode, rows, rowsEditable, saving, selectedRowIndexes]);

  async function handleAddComment(): Promise<void> {
    const text = newComment.trim();
    if (!text) {
      return;
    }
    setCommentSaving(true);
    setError("");
    setSuccess("");
    try {
      await addProjectComment(token, projectId, text);
      setNewComment("");
      setSuccess("Комментарий добавлен");
      await refreshWorkspaceSection();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка добавления комментария"
      );
    } finally {
      setCommentSaving(false);
    }
  }

  async function handleDeleteComment(commentId: number): Promise<void> {
    setBusyCommentId(commentId);
    setError("");
    setSuccess("");
    try {
      const payload = await deleteProjectComment(token, projectId, commentId);
      setSuccess(payload.message);
      await refreshWorkspaceSection();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка удаления комментария"
      );
    } finally {
      setBusyCommentId(null);
    }
  }

  async function handleUploadProjectFile(): Promise<void> {
    if (!selectedUploadFile) {
      return;
    }
    setFileUploading(true);
    setError("");
    setSuccess("");
    try {
      await uploadProjectFile(token, projectId, selectedUploadFile);
      setSuccess("Файл загружен");
      setSelectedUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await refreshWorkspaceSection();
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка загрузки файла"
      );
    } finally {
      setFileUploading(false);
    }
  }

  async function handleDeleteProjectFile(fileId: number): Promise<void> {
    setBusyFileId(fileId);
    setError("");
    setSuccess("");
    try {
      const payload = await deleteProjectFile(token, projectId, fileId);
      setSuccess(payload.message);
      await refreshWorkspaceSection();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка удаления файла"
      );
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleDownloadFile(fileId: number): Promise<void> {
    setBusyFileId(fileId);
    setError("");
    setSuccess("");
    try {
      const payload = await downloadProjectFile(token, projectId, fileId);
      triggerBlobDownload(payload.blob, payload.fileName);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка скачивания файла"
      );
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleExport(format: "docx" | "pdf"): Promise<void> {
    setExportingFormat(format);
    setError("");
    setSuccess("");
    try {
      const payload = await downloadProjectExport(token, projectId, format);
      triggerBlobDownload(payload.blob, payload.fileName);
      setSuccess(`Экспорт ${format.toUpperCase()} успешно сформирован`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка экспорта");
    } finally {
      setExportingFormat("");
    }
  }

  function handleColumnResizeStart(
    columnKey: EditorColumnKey,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidths[columnKey];

    function cleanup(): void {
      window.document.body.style.removeProperty("cursor");
      window.document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    }

    function handlePointerMove(moveEvent: PointerEvent): void {
      const delta = moveEvent.clientX - startX;
      const nextWidth = clampEditorColumnWidth(columnKey, startWidth + delta);
      setColumnWidths((previousWidths) => {
        if (previousWidths[columnKey] === nextWidth) {
          return previousWidths;
        }
        return {
          ...previousWidths,
          [columnKey]: nextWidth,
        };
      });
    }

    function handlePointerUp(): void {
      cleanup();
    }

    window.document.body.style.cursor = "col-resize";
    window.document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  const activeFormatConfig = useMemo(() => {
    if (!activeFormatScope) {
      return null;
    }
    const row = rows[activeFormatScope.rowIndex];
    if (!row) {
      return null;
    }
    return getFormattingTarget(row, activeFormatScope.target);
  }, [activeFormatScope, rows]);

  const canCreateRevision = rowsEditable || metaEditable;
  const canManageRevisionState = user.role === "admin" || user.role === "editor";
  const sortedRevisions = useMemo(
    () =>
      [...revisions].sort((left, right) => {
        if (right.revision_no !== left.revision_no) {
          return right.revision_no - left.revision_no;
        }
        return (right.created_at || "").localeCompare(left.created_at || "");
      }),
    [revisions]
  );
  const availableDiffTargets = useMemo(
    () =>
      activeRevision
        ? sortedRevisions.filter((item) => item.id !== activeRevision.id)
        : [],
    [activeRevision, sortedRevisions]
  );
  const quickSubmittableRevision = useMemo(() => {
    const canSubmit = (item: ProjectRevisionItem | null | undefined) =>
      Boolean(item) && isRevisionSubmittable(item?.status);
    if (canSubmit(activeRevision)) {
      return activeRevision;
    }
    return sortedRevisions.find((item) => canSubmit(item)) || null;
  }, [activeRevision, sortedRevisions]);
  const canSubmitActiveRevision = Boolean(activeRevision && canCreateRevision && isRevisionSubmittable(activeRevision.status));
  const canApproveActiveRevision = Boolean(activeRevision && canManageRevisionState && isRevisionReviewable(activeRevision.status));
  const canRejectActiveRevision = Boolean(activeRevision && canManageRevisionState && isRevisionReviewable(activeRevision.status));
  const canRestoreActiveRevision = Boolean(activeRevision && canManageRevisionState);
  const canMakeActiveRevisionCurrent = Boolean(
    activeRevision &&
      canManageRevisionState &&
      activeRevision.status === "approved" &&
      !activeRevision.is_current
  );
  const canCreateBranchFromActive = Boolean(
    activeRevision && canManageRevisionState && activeRevision.branch_key === "main"
  );
  const canMergeActiveBranch = Boolean(
    activeRevision &&
      canManageRevisionState &&
      activeRevision.branch_key !== "main" &&
      activeRevision.status === "approved"
  );
  const showRevisionAdvancedPanel = canCreateBranchFromActive || canMergeActiveBranch;
  const currentProjectRevision = useMemo(
    () => sortedRevisions.find((item) => item.is_current) || null,
    [sortedRevisions]
  );
  const editorSaveStatus = useMemo(() => {
    if (hasEditorSaveError) {
      return {
        tone: "error",
        label: "Ошибка сохранения",
        detail: "Проверь последние изменения и попробуй сохранить вручную.",
      };
    }
    if (isEditorSaving) {
      return {
        tone: "saving",
        label: "Сохранение...",
        detail: "Изменения записываются автоматически.",
      };
    }
    if (hasPendingEditorChanges) {
      return {
        tone: "pending",
        label: "Изменения ждут сохранения",
        detail: "Автосохранение сработает автоматически.",
      };
    }
    if (lastSuccessfulSaveAt) {
      return {
        tone: "saved",
        label: "Сохранено",
        detail: `Последнее сохранение: ${formatTimeShort(lastSuccessfulSaveAt)}`,
      };
    }
    return {
      tone: "saved",
      label: "Готово",
      detail: "Редактор синхронизирован.",
    };
  }, [hasEditorSaveError, hasPendingEditorChanges, isEditorSaving, lastSuccessfulSaveAt]);
  const addBlockInsertionLabel = useMemo(() => {
    if (selectedRowIndexes.length === 0) {
      return "Новый блок будет добавлен в конец материала.";
    }
    const targetIndex = selectedRowIndexes[selectedRowIndexes.length - 1];
    return `Новый блок будет добавлен после строки ${targetIndex + 1}.`;
  }, [selectedRowIndexes]);
  const revisionDiffGroups = useMemo(() => {
    const groups: Array<{ key: string; title: string; items: ProjectRevisionRowDiffItem[] }> = [
      { key: "added", title: revisionDiffSectionTitle("added"), items: [] },
      { key: "changed", title: revisionDiffSectionTitle("changed"), items: [] },
      { key: "moved", title: revisionDiffSectionTitle("moved"), items: [] },
      { key: "removed", title: revisionDiffSectionTitle("removed"), items: [] },
    ];
    if (!activeRevisionDiff) {
      return groups;
    }
    for (const item of activeRevisionDiff.row_changes) {
      const bucket = groups.find((group) => group.key === primaryRevisionChangeType(item));
      if (bucket) {
        bucket.items.push(item);
      }
    }
    return groups.filter((group) => group.items.length > 0);
  }, [activeRevisionDiff]);

  useEffect(() => {
    if (!isRevisionPanelOpen) {
      return;
    }

    function handleWindowKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeRevisionPanel();
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [isRevisionPanelOpen]);

  if (loading) {
    return (
      <section className="card">
        <p className="muted">Загрузка EDITOR...</p>
      </section>
    );
  }

  return (
    <section className={`card editor-page${reviewMode ? " editor-review-mode" : ""}`}>
      <div className="row between wrap">
        <div>
          <h2>EDITOR (Web)</h2>
          <p className="muted">
            Проект: <strong>{project ? `#${project.id} ${project.title}` : "-"}</strong>
          </p>
          <p className="muted">
            Статус: <strong>{statusLabel(project?.status)}</strong> | Роль:{" "}
            <strong>{user.role}</strong>
          </p>
          <p className="muted">
            Источник: <strong>{project?.source_project_id ? `#${project.source_project_id}` : "-"}</strong>{" "}
            | Последнее изменение статуса:{" "}
            <strong>{formatDateTime(project?.status_changed_at)}</strong>
          </p>
        </div>
        <button type="button" className="secondary" onClick={onBackToMain}>
          Назад в MAIN
        </button>
      </div>

      <div className="editor-view-toggle" role="tablist" aria-label="Режим просмотра редактора">
        <button
          type="button"
          className={`editor-view-toggle-button${!reviewMode ? " active" : ""}`}
          onClick={() => setEditorViewMode("edit")}
        >
          Редактирование
        </button>
        <button
          type="button"
          className={`editor-view-toggle-button${reviewMode ? " active" : ""}`}
          onClick={() => setEditorViewMode("review")}
        >
          Проверка
        </button>
      </div>
      {reviewMode ? (
        <p className="small muted editor-view-toggle-note">
          Режим проверки скрывает часть шумных действий, оставляет навигацию, версии, комментарии и
          чтение материала как единого потока.
        </p>
      ) : null}

      {!rowsEditable ? <p className="muted">{rowEditRestrictionMessage(user.role, projectStatus)}</p> : null}

      <div className="editor-dashboard-grid">
        <div className="card editor-comments-card">
          <h3>Комментарии проекта</h3>
          <div className="workspace-column workspace-column-plain">
            <div className="row controls">
              <AutoSizeTextarea
                className="workspace-comment-input"
                value={newComment}
                disabled={!rowsEditable || commentSaving}
                onChange={(event) => setNewComment(event.target.value)}
                minHeight={84}
                placeholder="Новый комментарий в ленту"
              />
            </div>
            <div className="row controls">
              <button
                type="button"
                onClick={() => void handleAddComment()}
                disabled={!rowsEditable || commentSaving || !newComment.trim()}
              >
                {commentSaving ? "Добавление..." : "Добавить комментарий"}
              </button>
            </div>
            <div className="workspace-list">
              {comments.length === 0 ? <p className="muted">Комментариев пока нет</p> : null}
              {comments.map((item) => (
                <div key={item.id} className="workspace-item">
                  <p>
                    <strong>{item.author_username}</strong> · {formatDateTime(item.created_at)}
                  </p>
                  <p>{item.text}</p>
                  <button
                    type="button"
                    className="danger"
                    disabled={!rowsEditable || busyCommentId === item.id}
                    onClick={() => void handleDeleteComment(item.id)}
                  >
                    {busyCommentId === item.id ? "Удаление..." : "Удалить"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card editor-combined-card">
          <div className="editor-combined-grid">
            <div>
              <div className="row between wrap editor-section-head">
                <h3>Workflow проекта</h3>
              </div>
              <div className="editor-meta-grid editor-meta-grid-wide">
                <label>
                  Статус
                  <select
                    value={metaStatus}
                    disabled={!statusEditable}
                    onChange={(event) => setMetaStatus(event.target.value)}
                  >
                    {ACTIVE_PROJECT_STATUSES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Автор
                  <select
                    value={metaAuthorUserId}
                    disabled={!assignmentEditable}
                    onChange={(event) => setMetaAuthorUserId(event.target.value)}
                  >
                    <option value="">Не назначен</option>
                    {users.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.username} ({item.role})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Исполнители
                  <select
                    multiple
                    className="multi-select"
                    value={metaExecutorUserIds}
                    disabled={!assignmentEditable}
                    onChange={(event) =>
                      setMetaExecutorUserIds(
                        Array.from(event.currentTarget.selectedOptions).map((item) => item.value)
                      )
                    }
                  >
                    {users.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.username} ({item.role})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Корректор
                  <select
                    value={metaProofreaderUserId}
                    disabled={!assignmentEditable}
                    onChange={(event) => setMetaProofreaderUserId(event.target.value)}
                  >
                    <option value="">Не назначен</option>
                    {users.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.username} ({item.role})
                      </option>
                    ))}
                  </select>
                </label>
                {archivedProject ? (
                  <div className="project-summary">
                    <p className="muted">
                      Архивирован: <strong>{formatDateTime(project?.archived_at)}</strong>
                    </p>
                    <p className="muted">
                      Кто архивировал: <strong>{project?.archived_by_username || "-"}</strong>
                    </p>
                    <p className="muted">
                      Автор в системе: <strong>{project?.author_username || "-"}</strong>
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="row between wrap editor-section-head">
                <h3>Файлы проекта</h3>
              </div>

              <div className="workspace-path-list">
                {workspaceFileRoots.length === 0 ? (
                  <p className="muted">Пути еще не добавлены</p>
                ) : null}
                {workspaceFileRoots.map((pathValue, index) => (
                  <div key={`path-${index}`} className="workspace-path-item">
                    <AutoSizeTextarea
                      className="workspace-path-input"
                      value={pathValue}
                      disabled={!rowsEditable}
                      minHeight={72}
                      placeholder="Путь к папке проекта"
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setWorkspaceFileRoots((previous) =>
                          previous.map((item, itemIndex) => (itemIndex === index ? nextValue : item))
                        );
                      }}
                    />
                    <button
                      type="button"
                      className="secondary"
                      disabled={!rowsEditable}
                      onClick={() =>
                        setWorkspaceFileRoots((previous) =>
                          previous.filter((_item, itemIndex) => itemIndex !== index)
                        )
                      }
                    >
                      Удалить
                    </button>
                  </div>
                ))}
              </div>

              <div className="row controls wrap">
                <button
                  type="button"
                  className="secondary"
                  disabled={!rowsEditable}
                  onClick={() => setWorkspaceFileRoots((previous) => [...previous, ""])}
                >
                  Добавить путь
                </button>
              </div>

              <p className="small muted">MASTER</p>
              <div className="row controls wrap">
                <input
                  ref={fileInputRef}
                  type="file"
                  disabled={!rowsEditable || fileUploading}
                  onChange={(event) => {
                    const selected = event.target.files?.[0] || null;
                    setSelectedUploadFile(selected);
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleUploadProjectFile()}
                  disabled={!rowsEditable || fileUploading || !selectedUploadFile}
                >
                  {fileUploading ? "Загрузка..." : "Загрузить файл"}
                </button>
              </div>

              <div className="workspace-list">
                {files.length === 0 ? <p className="muted">Файлов пока нет</p> : null}
                {files.map((item) => (
                  <div key={item.id} className="workspace-item">
                    <p>
                      <strong>{item.original_name}</strong> ({formatFileSize(item.file_size)})
                    </p>
                    <p className="muted">
                      Загрузил: {item.uploaded_by_username} · {formatDateTime(item.uploaded_at)}
                    </p>
                    <p className="muted">
                      На диске: {item.exists_on_disk ? "есть" : "отсутствует"}
                    </p>
                    <div className="row controls">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleDownloadFile(item.id)}
                        disabled={busyFileId === item.id}
                      >
                        {busyFileId === item.id ? "..." : "Скачать"}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => void handleDeleteProjectFile(item.id)}
                        disabled={!rowsEditable || busyFileId === item.id}
                      >
                        {busyFileId === item.id ? "Удаление..." : "Удалить"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="editor-toolbar-sticky">
        <div className="card editor-toolbar-card">
          <div className="row controls wrap editor-table-toolbar">
            {!reviewMode ? (
              <>
                <div className="editor-add-block-group">
                  <div className="editor-add-block-head">
                    <span className="editor-add-block-title">Добавить блок</span>
                    <span className="editor-add-block-hint muted">{addBlockInsertionLabel}</span>
                  </div>
                  <div className="editor-add-block-buttons">
                    {BLOCK_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`editor-add-block-button editor-add-block-button-${blockTypeTone(option.value)}`}
                        disabled={!rowsEditable || saving}
                        onClick={() => handleAddRowSelection(option.value)}
                      >
                        + {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="danger"
                  onClick={deleteSelectedRows}
                  disabled={!rowsEditable || saving || selectedRowIndexes.length === 0}
                >
                  Удалить выбранные
                </button>
                <button
                  type="button"
                  onClick={() => void handleManualTableSave()}
                  disabled={!rowsEditable || saving}
                >
                  {saving ? "Сохранение..." : "Сохранить таблицу"}
                </button>
              </>
            ) : null}
            {canCreateRevision ? (
              <button
                type="button"
                className="secondary"
                disabled={revisionAction !== null}
                onClick={() => void openRevisionPanel({ composer: true })}
              >
                {revisionAction === "create" ? "Сохранение версии..." : "Сохранить версию"}
              </button>
            ) : null}
            {canCreateRevision && quickSubmittableRevision ? (
              <button
                type="button"
                className="secondary"
                disabled={revisionAction !== null}
                onClick={() => void handleSubmitRevision(quickSubmittableRevision.id)}
              >
                {revisionAction === "submit" ? "Отправка..." : "Отправить на согласование"}
              </button>
            ) : null}
            <button
              type="button"
              className="secondary"
              onClick={() => void openRevisionPanel({ composer: false })}
            >
              История версий
            </button>
            <button type="button" className="secondary" onClick={() => void loadEditorPayload()}>
              Обновить
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void handleExport("docx")}
              disabled={exportingFormat !== ""}
            >
              {exportingFormat === "docx" ? "Экспорт DOCX..." : "Экспорт DOCX"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void handleExport("pdf")}
              disabled={exportingFormat !== ""}
            >
              {exportingFormat === "pdf" ? "Экспорт PDF..." : "Экспорт PDF"}
            </button>
          </div>
          {!reviewMode ? (
            <p className="editor-keyboard-hint muted">
              Enter — новый блок того же типа · Ctrl/Cmd+S — сохранить · Ctrl/Cmd+D — копия ·
              Alt+↑/↓ — перейти по блокам · Alt+Shift+↑/↓ — переместить · Delete / Backspace —
              удалить
            </p>
          ) : (
            <p className="editor-keyboard-hint muted">
              Режим проверки: Alt+↑/↓ — перейти по блокам · История версий и комментарии остаются
              доступны без перехода на другой экран
            </p>
          )}

          <div className="editor-revision-toolbar-meta">
            <div className="editor-revision-toolbar-meta-group">
              <span className="small muted">Рабочая версия:</span>
              {currentProjectRevision ? (
                <>
                  <strong>
                    v{currentProjectRevision.revision_no} ·{" "}
                    {currentProjectRevision.title || `Версия ${currentProjectRevision.revision_no}`}
                  </strong>
                  <span
                    className={`revision-status-chip revision-status-chip-${revisionStatusTone(
                      currentProjectRevision.status
                    )}`}
                  >
                    {revisionStatusLabel(currentProjectRevision.status)}
                  </span>
                </>
              ) : (
                <span className="small muted">еще не сохранена</span>
              )}
            </div>
            <div className={`editor-save-status editor-save-status-${editorSaveStatus.tone}`}>
              <strong>{editorSaveStatus.label}</strong>
              <span>{editorSaveStatus.detail}</span>
            </div>
          </div>

          {!reviewMode ? (
            <div className="editor-format-toolbar">
              <div className="editor-format-toolbar-head">
                <strong>Форматирование</strong>
                <span className="small muted">
                  {activeFormatScope
                    ? `Строка ${activeFormatScope.rowIndex + 1}: ${formatTargetLabel(
                        activeFormatScope.target
                      )}`
                    : "Выбери строку и активное поле"}
                </span>
              </div>

              <div className="row controls wrap">
                <label className="editor-format-label">
                  Шрифт
                  <select
                    value={activeFormatConfig?.font_family || DEFAULT_FONT_FAMILY}
                    disabled={!activeFormatScope || !activeFormatConfig}
                    onChange={(event) =>
                      activeFormatScope
                        ? applyFormattingChange(
                            activeFormatScope.target,
                            {
                              font_family: event.target.value,
                            },
                            (editor) => {
                              editor.chain().focus().setFontFamily(event.target.value).run();
                            }
                          )
                        : undefined
                    }
                  >
                    {FONT_OPTIONS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="editor-format-buttons">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!activeFormatScope || !activeFormatConfig}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      activeFormatScope
                        ? applyFormattingChange(
                            activeFormatScope.target,
                            {
                              bold: false,
                              italic: false,
                              strikethrough: false,
                            },
                            (editor) => {
                              editor
                                .chain()
                                .focus()
                                .unsetBold()
                                .unsetItalic()
                                .unsetStrike()
                                .unsetHighlight()
                                .unsetFontFamily()
                                .run();
                            }
                          )
                        : undefined
                    }
                  >
                    Regular
                  </button>
                  <button
                    type="button"
                    className={activeFormatConfig?.bold ? "" : "secondary"}
                    disabled={!activeFormatScope || !activeFormatConfig}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      activeFormatScope
                        ? applyFormattingChange(
                            activeFormatScope.target,
                            {
                              bold: !Boolean(activeFormatConfig?.bold),
                            },
                            (editor) => {
                              editor.chain().focus().toggleBold().run();
                            }
                          )
                        : undefined
                    }
                  >
                    Bold
                  </button>
                  <button
                    type="button"
                    className={activeFormatConfig?.italic ? "" : "secondary"}
                    disabled={!activeFormatScope || !activeFormatConfig}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      activeFormatScope
                        ? applyFormattingChange(
                            activeFormatScope.target,
                            {
                              italic: !Boolean(activeFormatConfig?.italic),
                            },
                            (editor) => {
                              editor.chain().focus().toggleItalic().run();
                            }
                          )
                        : undefined
                    }
                  >
                    Italic
                  </button>
                  <button
                    type="button"
                    className={activeFormatConfig?.strikethrough ? "" : "secondary"}
                    disabled={!activeFormatScope || !activeFormatConfig}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      activeFormatScope
                        ? applyFormattingChange(
                            activeFormatScope.target,
                            {
                              strikethrough: !Boolean(activeFormatConfig?.strikethrough),
                            },
                            (editor) => {
                              editor.chain().focus().toggleStrike().run();
                            }
                          )
                        : undefined
                    }
                  >
                    Strike
                  </button>
                </div>

                <div className="editor-color-palette">
                  {FILL_COLOR_OPTIONS.map((colorOption) => (
                    <button
                      key={colorOption.value}
                      type="button"
                      className={`editor-color-swatch${
                        activeFormatConfig?.fill_color === colorOption.value ? " active" : ""
                      }`}
                      style={{ backgroundColor: colorOption.value }}
                      title={colorOption.label}
                      aria-label={colorOption.label}
                      disabled={!activeFormatScope || !activeFormatConfig}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        activeFormatScope
                          ? applyFormattingChange(
                              activeFormatScope.target,
                              {
                                fill_color: colorOption.value,
                              },
                              (editor) => {
                                editor
                                  .chain()
                                  .focus()
                                  .setHighlight({ color: colorOption.value })
                                  .run();
                              },
                              { collapseSelection: true }
                            )
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="editor-meta-grid editor-table-header-grid editor-table-header-panel">
          <label className="table-header-field-title">
            Название
            <input
              value={metaTitle}
              disabled={!metaEditable || saving}
              onChange={(event) => setMetaTitle(event.target.value)}
            />
          </label>
          <label className="table-header-field-rubric">
            Рубрика
            <input
              value={metaRubric}
              disabled={!metaEditable || saving}
              onChange={(event) => setMetaRubric(event.target.value)}
            />
          </label>
          <label className="table-header-field-duration">
            Хронометраж
            <input
              value={metaDuration}
              disabled={!metaEditable || saving}
              onChange={(event) => setMetaDuration(event.target.value)}
              placeholder="02:30"
            />
          </label>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {success ? <p className="success">{success}</p> : null}

        <div className="editor-outline-panel">
          <div className="editor-outline-head">
            <div>
              <strong>Навигация по материалу</strong>
              <span className="small muted"> Быстрый переход к нужному блоку</span>
            </div>
            <span className="small muted">
              {selectedRowIndexes.length > 0
                ? `Текущий блок: ${selectedRowIndexes[selectedRowIndexes.length - 1] + 1}`
                : "Блок не выбран"}
            </span>
          </div>
          <div className="editor-outline-list" role="navigation" aria-label="Навигация по блокам">
            {rows.map((row, index) => {
              const blockTone = blockTypeTone(row.block_type);
              const blockLabel = blockTypeLabel(String(row.block_type || ""));
              const preview = truncateOutlinePreview(buildRowOutlinePreview(row));
              const active = selectedRowIndexes.includes(index);

              return (
                <button
                  key={`outline-${row.id ?? "new"}-${index}`}
                  type="button"
                  ref={(element) => registerOutlineItemRef(index, element)}
                  className={`editor-outline-item${active ? " active" : ""}`}
                  onClick={() => jumpToRow(index)}
                >
                  <span className="editor-outline-item-top">
                    <span className="editor-outline-index">{index + 1}</span>
                    <span className={`editor-block-type-chip editor-block-type-chip-${blockTone}`}>
                      {blockLabel}
                    </span>
                  </span>
                  <span className="editor-outline-preview">{preview}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="table-wrap">
          <table className="editor-table">
            <colgroup>
              {EDITOR_COLUMNS.map((column) => (
                <col
                  key={column.key}
                  style={{
                    width: `${columnWidths[column.key]}px`,
                  }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                {EDITOR_COLUMNS.map((column) => (
                  <th key={column.key}>
                    <div className="editor-header-cell">
                      <span>{column.label}</span>
                      <button
                        type="button"
                        className="editor-column-resizer"
                        aria-label={`Изменить ширину столбца ${column.label}`}
                        onPointerDown={(event) => handleColumnResizeStart(column.key, event)}
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const snhMode = isSnhBlock(row.block_type);
                const zkGeoMode = isZkGeoBlock(row.block_type);
                const snhParts = parseSnhSpeakerText(row.speaker_text);
                const zkGeoParts = parseZkGeoStructuredData(row);
                const fileBundles = parseRowFileBundles(row);
                const textFormat = getFormattingTarget(row, "text");
                const fioFormat = getFormattingTarget(row, "speaker_fio");
                const positionFormat = getFormattingTarget(row, "speaker_position");
                const geoFormat = getFormattingTarget(row, "geo");
                const blockLabel = blockTypeLabel(String(row.block_type || ""));
                const blockTone = blockTypeTone(row.block_type);
                const rowIsSelected = selectedRowIndexes.includes(index);
                const dragTargetBefore =
                  dragTarget?.rowIndex === index && dragTarget.position === "before";
                const dragTargetAfter =
                  dragTarget?.rowIndex === index && dragTarget.position === "after";
                const dragSource = dragRowIndex === index;

                return (
                  <tr
                    key={`${row.id ?? "new"}-${index}`}
                    ref={(element) => registerRowRef(index, element)}
                    className={[
                      rowIsSelected ? "selected-row" : "",
                      dragTargetBefore ? "drag-target-before" : "",
                      dragTargetAfter ? "drag-target-after" : "",
                      dragSource ? "drag-source-row" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(event) => toggleRowSelection(index, event.ctrlKey || event.metaKey)}
                    onDragOver={(event) => handleRowDragOver(index, event)}
                    onDrop={(event) => handleRowDrop(index, event)}
                  >
                    <td className="editor-order-cell">
                      {!reviewMode ? (
                        <button
                          type="button"
                          className="editor-row-drag-handle"
                          draggable={rowsEditable}
                          disabled={!rowsEditable}
                          aria-label="Перетащить блок"
                          title="Перетащить блок"
                          onClick={(event) => event.stopPropagation()}
                          onDragStart={(event) => handleRowDragStart(index, event)}
                          onDragEnd={handleRowDragEnd}
                        >
                          ::
                        </button>
                      ) : null}
                      <span>{index + 1}</span>
                    </td>
                    <td>
                      {reviewMode ? (
                        <div className="editor-review-block-type-cell">
                          <span className={`editor-block-type-chip editor-block-type-chip-${blockTone}`}>
                            {blockLabel}
                          </span>
                        </div>
                      ) : (
                        <select
                          className="editor-cell-select"
                          value={row.block_type}
                          disabled={!rowsEditable}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => handleBlockTypeChange(index, event.target.value)}
                        >
                          {BLOCK_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td
                      className={
                        snhMode || zkGeoMode ? "editor-text-cell editor-text-cell-structured" : "editor-text-cell"
                      }
                    >
                      <div className="editor-block-shell" onClick={(event) => event.stopPropagation()}>
                        <div className="editor-block-head">
                          <div className="editor-block-head-meta">
                            <span className={`editor-block-type-chip editor-block-type-chip-${blockTone}`}>
                              {blockLabel}
                            </span>
                            <span className="editor-block-head-caption">Основной текст</span>
                          </div>
                          {!reviewMode ? (
                            <div className="editor-block-actions">
                              <button
                                type="button"
                                className="editor-row-action"
                                disabled={!rowsEditable}
                                aria-label="Дублировать блок"
                                title="Дублировать блок"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  duplicateRow(index);
                                }}
                              >
                                Копия
                              </button>
                              <button
                                type="button"
                                className="editor-row-action"
                                disabled={!rowsEditable || index === 0}
                                aria-label="Поднять блок вверх"
                                title="Поднять блок вверх"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  moveRow(index, -1);
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="editor-row-action"
                                disabled={!rowsEditable || index === rows.length - 1}
                                aria-label="Опустить блок вниз"
                                title="Опустить блок вниз"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  moveRow(index, 1);
                                }}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="editor-row-action editor-row-action-danger"
                                disabled={!rowsEditable}
                                aria-label="Удалить блок"
                                title="Удалить блок"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  deleteRow(index);
                                }}
                              >
                                ×
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {snhMode ? (
                          <div className="editor-text-flow">
                            <div className="structured-editor">
                              <EditorCoreField
                                editorId={getRichTextEditorId(index, "speaker_fio")}
                                className="structured-editor-line structured-editor-line-emphasis rich-text-field-compact"
                                richTextTarget={getRichTextTarget(row, "speaker_fio", snhParts.fio)}
                                plainTextValue={snhParts.fio}
                                disabled={!rowsEditable}
                                placeholder="ФИО"
                                style={buildFormattingStyle(fioFormat)}
                                onRegister={registerTiptapEditor}
                                onSelectionChange={handleTiptapSelectionChange}
                                onFocusField={() => handleFieldFocus(index, "speaker_fio")}
                                onChangeValue={(payload: EditorCoreFieldChangePayload) =>
                                  applyRichFieldValue(index, "speaker_fio", payload)
                                }
                              />
                              <EditorCoreField
                                editorId={getRichTextEditorId(index, "speaker_position")}
                                className="structured-editor-line structured-editor-line-emphasis rich-text-field-compact"
                                richTextTarget={getRichTextTarget(
                                  row,
                                  "speaker_position",
                                  snhParts.position
                                )}
                                plainTextValue={snhParts.position}
                                disabled={!rowsEditable}
                                placeholder="Должность"
                                style={buildFormattingStyle(positionFormat)}
                                onRegister={registerTiptapEditor}
                                onSelectionChange={handleTiptapSelectionChange}
                                onFocusField={() => handleFieldFocus(index, "speaker_position")}
                                onChangeValue={(payload: EditorCoreFieldChangePayload) =>
                                  applyRichFieldValue(index, "speaker_position", payload)
                                }
                              />
                              <EditorCoreField
                                editorId={getRichTextEditorId(index, "text")}
                                className="structured-editor-text"
                                richTextTarget={getRichTextTarget(row, "text", row.text)}
                                plainTextValue={row.text}
                                disabled={!rowsEditable}
                                placeholder="Текст"
                                style={buildFormattingStyle(textFormat)}
                                onRegister={registerTiptapEditor}
                                onSelectionChange={handleTiptapSelectionChange}
                                onFocusField={() => handleFieldFocus(index, "text")}
                                onChangeValue={(payload: EditorCoreFieldChangePayload) =>
                                  applyRichFieldValue(index, "text", payload)
                                }
                              />
                            </div>
                          </div>
                        ) : zkGeoMode ? (
                          <div className="editor-text-flow">
                            <div className="structured-editor">
                              <EditorCoreField
                                editorId={getRichTextEditorId(index, "geo")}
                                className="structured-editor-line rich-text-field-compact"
                                richTextTarget={getRichTextTarget(row, "geo", zkGeoParts.geo)}
                                plainTextValue={zkGeoParts.geo}
                                disabled={!rowsEditable}
                                placeholder="Гео"
                                style={buildFormattingStyle(geoFormat)}
                                onRegister={registerTiptapEditor}
                                onSelectionChange={handleTiptapSelectionChange}
                                onFocusField={() => handleFieldFocus(index, "geo")}
                                onChangeValue={(payload: EditorCoreFieldChangePayload) =>
                                  applyRichFieldValue(index, "geo", payload)
                                }
                              />
                              <EditorCoreField
                                editorId={getRichTextEditorId(index, "text")}
                                className="structured-editor-text"
                                richTextTarget={getRichTextTarget(row, "text", zkGeoParts.text)}
                                plainTextValue={zkGeoParts.text}
                                disabled={!rowsEditable}
                                placeholder="Текст"
                                style={buildFormattingStyle(textFormat)}
                                onRegister={registerTiptapEditor}
                                onSelectionChange={handleTiptapSelectionChange}
                                onFocusField={() => handleFieldFocus(index, "text")}
                                onChangeValue={(payload: EditorCoreFieldChangePayload) =>
                                  applyRichFieldValue(index, "text", payload)
                                }
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="editor-text-flow">
                            <EditorCoreField
                              editorId={getRichTextEditorId(index, "text")}
                              className="editor-cell-textarea"
                              richTextTarget={getRichTextTarget(row, "text", row.text)}
                              plainTextValue={row.text}
                              disabled={!rowsEditable}
                              placeholder="Текст"
                              style={buildFormattingStyle(textFormat)}
                              onRegister={registerTiptapEditor}
                              onSelectionChange={handleTiptapSelectionChange}
                              onFocusField={() => handleFieldFocus(index, "text")}
                              onChangeValue={(payload: EditorCoreFieldChangePayload) =>
                                applyRichFieldValue(index, "text", payload)
                              }
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="editor-file-cell">
                      <div className="editor-tech-shell" onClick={(event) => event.stopPropagation()}>
                        <div className="editor-tech-shell-spacer">
                          <span className="editor-tech-shell-caption">Файл / TC</span>
                        </div>
                        <div className="editor-file-stack">
                          {fileBundles.map((bundle, bundleIndex) => (
                            <div key={`${index}-${bundleIndex}`} className="editor-file-bundle">
                              <div className="editor-file-bundle-fields">
                                <div className="editor-file-bundle-row editor-file-bundle-primary-row">
                                  <span className="editor-file-bundle-label">Файл</span>
                                  <input
                                    className="editor-cell-input"
                                    ref={(element) => registerFileBundleInput(index, bundleIndex, element)}
                                    value={buildFileBundleInputValue(fileBundles, bundleIndex)}
                                    disabled={!rowsEditable}
                                    placeholder="Имя файла / +"
                                    onFocus={() => setSelectedRowIndexes([index])}
                                    onChange={(event) =>
                                      handleExistingFileBundleInputChange(
                                        index,
                                        bundleIndex,
                                        event.target.value
                                      )
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="editor-file-bundle-remove"
                                    disabled={!rowsEditable}
                                    aria-label="Удалить файл и таймкоды"
                                    title="Удалить"
                                    onClick={() => removeFileBundle(index, bundleIndex)}
                                  >
                                    ×
                                  </button>
                                </div>
                                <div className="editor-file-bundle-row">
                                  <span className="editor-file-bundle-label">IN</span>
                                  <input
                                    className="editor-cell-input"
                                    value={bundle.tc_in}
                                    disabled={!rowsEditable}
                                    placeholder="TC IN"
                                    onFocus={() => setSelectedRowIndexes([index])}
                                    onBlur={(event) =>
                                      handleFileBundleTimecodeBlur(
                                        index,
                                        bundleIndex,
                                        "tc_in",
                                        event.target.value
                                      )
                                    }
                                    onChange={(event) =>
                                      updateFileBundle(index, bundleIndex, {
                                        tc_in: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                                <div className="editor-file-bundle-row">
                                  <span className="editor-file-bundle-label">OUT</span>
                                  <input
                                    className="editor-cell-input"
                                    value={bundle.tc_out}
                                    disabled={!rowsEditable}
                                    placeholder="TC OUT"
                                    onFocus={() => setSelectedRowIndexes([index])}
                                    onBlur={(event) =>
                                      handleFileBundleTimecodeBlur(
                                        index,
                                        bundleIndex,
                                        "tc_out",
                                        event.target.value
                                      )
                                    }
                                    onChange={(event) =>
                                      updateFileBundle(index, bundleIndex, {
                                        tc_out: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                          <div className="editor-file-bundle editor-file-bundle-draft">
                            <div className="editor-file-bundle-fields">
                              <div className="editor-file-bundle-row editor-file-bundle-primary-row editor-file-bundle-draft-row">
                                <span className="editor-file-bundle-label">Файл</span>
                                <input
                                  className="editor-cell-input"
                                  value={fileBundleDrafts[index] || ""}
                                  disabled={!rowsEditable}
                                  placeholder="Имя файла / +"
                                  onFocus={() => setSelectedRowIndexes([index])}
                                  onChange={(event) =>
                                    handleDraftFileBundleInputChange(index, event.target.value)
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="editor-comment-cell">
                      <div className="editor-tech-shell" onClick={(event) => event.stopPropagation()}>
                        <div className="editor-tech-shell-spacer">
                          <span className="editor-tech-shell-caption">В кадре</span>
                        </div>
                        <AutoSizeTextarea
                          className="editor-cell-textarea editor-cell-textarea-compact"
                          value={row.additional_comment}
                          disabled={!rowsEditable}
                          minHeight={42}
                          placeholder="текст"
                          onFocus={() => handleFieldFocus(index, "text")}
                          onChange={(event) =>
                            updateRow(index, {
                              additional_comment: event.target.value,
                            })
                          }
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
          <h3>История проекта</h3>
          <div className="history-list">
            {history.length === 0 ? <p className="muted">История проекта пока пуста</p> : null}
            {history.map((item) => (
              <div key={item.id} className="history-item">
                <p>
                  <strong>{eventTypeLabel(item.event_type)}</strong> · {item.actor_username} ·{" "}
                  {formatDateTime(item.created_at)}
                </p>
                <p className="muted">
                  {item.old_value || "-"} → {item.new_value || "-"}
                </p>
              </div>
            ))}
          </div>
        </div>

      {isRevisionPanelOpen ? (
        <div className="revision-history-overlay" role="presentation">
          <button
            type="button"
            className="revision-history-backdrop"
            aria-label="Закрыть историю версий"
            onClick={closeRevisionPanel}
          />
          <aside className="revision-history-drawer" aria-label="История версий">
            <div className="revision-history-drawer-head">
              <div>
                <h3>История версий</h3>
                <p className="small muted">
                  Рабочая таблица редактируется отдельно. Здесь сохраняются зафиксированные версии.
                </p>
              </div>
              <div className="row controls wrap">
                {canCreateRevision ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={revisionAction !== null}
                  onClick={() => setRevisionComposerOpen((previous) => !previous)}
                  >
                    {isRevisionComposerOpen ? "Скрыть форму" : "Сохранить версию"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary"
                  disabled={revisionAction !== null || revisionListLoading}
                  onClick={() => void handleRefreshRevisionHistory()}
                >
                  {revisionListLoading ? "Обновление..." : "Обновить историю"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={closeRevisionPanel}
                >
                  Закрыть
                </button>
              </div>
            </div>

            {revisionNotice ? (
              <div className={`revision-notice revision-notice-${revisionNotice.kind}`}>
                {revisionNotice.message}
              </div>
            ) : null}

            <div className="revision-history-drawer-body">
              <div className="revision-history-column revision-history-column-list">
                {canCreateRevision && isRevisionComposerOpen ? (
                  <div className="revision-composer-card">
                    <h4>Сохранить версию</h4>
                    <div className="editor-revision-form">
                      <label>
                        Название версии
                        <input
                          value={revisionTitle}
                          maxLength={255}
                          disabled={!canCreateRevision || revisionAction !== null}
                          onChange={(event) => setRevisionTitle(event.target.value)}
                          placeholder="Например: после правок шефа"
                        />
                      </label>
                      <label>
                        Комментарий
                        <AutoSizeTextarea
                          value={revisionComment}
                          minHeight={72}
                          disabled={!canCreateRevision || revisionAction !== null}
                          onChange={(event) => setRevisionComment(event.target.value)}
                          placeholder="Что именно зафиксировано в версии"
                        />
                      </label>
                      {activeRevision ? (
                        <p className="small muted">
                          Версия будет сохранена после v{activeRevision.revision_no} в текущей линии
                          правок.
                        </p>
                      ) : null}
                      <div className="row controls wrap">
                        <button
                          type="button"
                          disabled={!canCreateRevision || revisionAction !== null}
                          onClick={() => void handleCreateRevision()}
                        >
                          {revisionAction === "create" ? "Сохранение..." : "Сохранить версию"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="revision-history-list">
                  {revisionListLoading && sortedRevisions.length === 0 ? (
                    <p className="muted">Загружаю историю версий...</p>
                  ) : null}
                  {!revisionListLoading && sortedRevisions.length === 0 ? (
                    <p className="muted">История версий пока пуста</p>
                  ) : null}
                  {sortedRevisions.map((item) => {
                    const isBusy = busyRevisionId === item.id;
                    const isActive = activeRevision?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`revision-history-item${isActive ? " active" : ""}${
                          item.is_current ? " current" : ""
                        }`}
                        disabled={revisionAction !== null && !isBusy}
                        onClick={() => void handleOpenRevision(item.id)}
                      >
                        <div className="revision-history-item-top">
                          <strong>v{item.revision_no}</strong>
                          <div className="revision-history-pill-row">
                            <span
                              className={`revision-status-chip revision-status-chip-${revisionStatusTone(
                                item.status
                              )}`}
                            >
                              {revisionStatusLabel(item.status)}
                            </span>
                            {item.is_current ? (
                              <span className="revision-status-chip revision-status-chip-current">
                                Текущая
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p>{item.title || `Версия ${item.revision_no}`}</p>
                        <p className="muted">
                          {item.created_by_username || "-"} · {formatDateTime(item.created_at)}
                        </p>
                        <p className="muted">{item.comment || "Комментарий не указан"}</p>
                        {isBusy && revisionAction === "open" ? (
                          <span className="small muted">Открытие...</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="revision-history-column revision-history-column-detail">
                {revisionDetailLoading ? (
                  <div className="revision-history-empty-state">
                    <h4>Загружаю версию</h4>
                    <p className="muted">
                      Подготавливаю состав версии и сравнение, это может занять пару секунд.
                    </p>
                  </div>
                ) : activeRevision ? (
                  <div className="revision-preview revision-preview-drawer">
                    <div className="row between wrap">
                      <div>
                        <h4>
                          v{activeRevision.revision_no} ·{" "}
                          {activeRevision.title || `Версия ${activeRevision.revision_no}`}
                        </h4>
                        <p className="muted">
                          {activeRevision.created_by_username || "-"} ·{" "}
                          {formatDateTime(activeRevision.created_at)}
                        </p>
                      </div>
                      <div className="revision-history-pill-row">
                        <span
                          className={`revision-status-chip revision-status-chip-${revisionStatusTone(
                            activeRevision.status
                          )}`}
                        >
                          {revisionStatusLabel(activeRevision.status)}
                        </span>
                        {activeRevision.is_current ? (
                          <span className="revision-status-chip revision-status-chip-current">
                            Текущая
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="muted">{activeRevision.comment || "Комментарий не указан"}</p>
                    <div className="revision-header-summary">
                      <span>
                        <strong>Название:</strong> {activeRevision.project_title || "-"}
                      </span>
                      <span>
                        <strong>Рубрика:</strong> {activeRevision.project_rubric || "-"}
                      </span>
                      <span>
                        <strong>Хронометраж:</strong> {activeRevision.project_planned_duration || "-"}
                      </span>
                    </div>
                    {canSubmitActiveRevision ||
                    canApproveActiveRevision ||
                    canRejectActiveRevision ||
                    canRestoreActiveRevision ||
                    canMakeActiveRevisionCurrent ? (
                      <div className="row controls wrap">
                        {canSubmitActiveRevision ? (
                          <button
                            type="button"
                            className="secondary"
                            disabled={revisionAction !== null && busyRevisionId !== activeRevision.id}
                            onClick={() => void handleSubmitRevision(activeRevision.id)}
                          >
                            {busyRevisionId === activeRevision.id && revisionAction === "submit"
                              ? "Отправка..."
                              : "Отправить на согласование"}
                          </button>
                        ) : null}
                        {canApproveActiveRevision ? (
                          <button
                            type="button"
                            className="secondary"
                            disabled={revisionAction !== null && busyRevisionId !== activeRevision.id}
                            onClick={() => void handleApproveRevision(activeRevision.id)}
                          >
                            {busyRevisionId === activeRevision.id && revisionAction === "approve"
                              ? "Утверждение..."
                              : "Утвердить"}
                          </button>
                        ) : null}
                        {canRejectActiveRevision ? (
                          <button
                            type="button"
                            className="secondary"
                            disabled={revisionAction !== null && busyRevisionId !== activeRevision.id}
                            onClick={() => void handleRejectRevision(activeRevision.id)}
                          >
                            {busyRevisionId === activeRevision.id && revisionAction === "reject"
                              ? "Отклонение..."
                              : "Отклонить"}
                          </button>
                        ) : null}
                        {canRestoreActiveRevision ? (
                          <button
                            type="button"
                            className="secondary"
                            disabled={revisionAction !== null && busyRevisionId !== activeRevision.id}
                            onClick={() => void handleRestoreRevision(activeRevision.id)}
                          >
                            {busyRevisionId === activeRevision.id && revisionAction === "restore"
                              ? "Открытие..."
                              : "Открыть как рабочую"}
                          </button>
                        ) : null}
                        {canMakeActiveRevisionCurrent ? (
                          <button
                            type="button"
                            className="secondary"
                            disabled={revisionAction !== null && busyRevisionId !== activeRevision.id}
                            onClick={() => void handleMarkRevisionCurrent(activeRevision.id)}
                          >
                            {busyRevisionId === activeRevision.id && revisionAction === "current"
                              ? "Обновление..."
                              : "Сделать текущей"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {showRevisionAdvancedPanel ? (
                      <details className="revision-advanced-panel">
                        <summary>Дополнительно</summary>
                        <div className="revision-advanced-content">
                          <p className="small muted">
                            Продвинутые действия для branch/merge. Они не нужны для обычного
                            сценария согласования.
                          </p>
                          <div className="row controls wrap">
                            {canCreateBranchFromActive ? (
                              <>
                                <label className="revision-branch-label">
                                  Новая линия правок
                                  <input
                                    value={newBranchKey}
                                    maxLength={64}
                                    disabled={revisionAction !== null}
                                    onChange={(event) => setNewBranchKey(event.target.value)}
                                    placeholder="chief / proof"
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="secondary"
                                  disabled={revisionAction !== null}
                                  onClick={() => void handleCreateBranch(activeRevision.id)}
                                >
                                  {busyRevisionId === activeRevision.id && revisionAction === "branch"
                                    ? "Создание..."
                                    : "Создать ветку"}
                                </button>
                              </>
                            ) : null}
                            {canMergeActiveBranch ? (
                              <button
                                type="button"
                                className="secondary"
                                disabled={revisionAction !== null}
                                onClick={() => void handleMergeRevision(activeRevision.id)}
                              >
                                {busyRevisionId === activeRevision.id && revisionAction === "merge"
                                  ? "Слияние..."
                                  : "Слить в основную"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </details>
                    ) : null}

                    <div className="revision-diff-toolbar">
                      <label className="revision-diff-label">
                        Сравнить с
                        <select
                          value={revisionDiffAgainstId}
                          disabled={availableDiffTargets.length === 0 || revisionDiffLoading}
                          onChange={(event) =>
                            void loadRevisionDiff(activeRevision.id, event.target.value)
                          }
                        >
                          {availableDiffTargets.length === 0 ? (
                            <option value="">Нет других версий</option>
                          ) : null}
                          {availableDiffTargets.map((item) => (
                            <option key={item.id} value={item.id}>
                              v{item.revision_no} · {item.title || `Версия ${item.revision_no}`}
                            </option>
                          ))}
                        </select>
                      </label>
                      {revisionDiffLoading ? (
                        <span className="small muted">Считаю diff...</span>
                      ) : activeRevisionDiff ? (
                        <span className="small muted">
                          Сравнение с v{activeRevisionDiff.against_revision.revision_no}
                        </span>
                      ) : (
                        <span className="small muted">Выбери версию для сравнения</span>
                      )}
                    </div>
                    {activeRevisionDiff ? (
                      <div className="revision-diff-block">
                        <div className="revision-diff-summary">
                          <span className="revision-diff-pill revision-diff-pill-added">
                            +{activeRevisionDiff.summary.added} добавлено
                          </span>
                          <span className="revision-diff-pill revision-diff-pill-removed">
                            {activeRevisionDiff.summary.removed} удалено
                          </span>
                          <span className="revision-diff-pill revision-diff-pill-changed">
                            {activeRevisionDiff.summary.changed} изменено
                          </span>
                          <span className="revision-diff-pill revision-diff-pill-moved">
                            {activeRevisionDiff.summary.moved} перемещено
                          </span>
                        </div>
                        <div className="revision-diff-list">
                          <div className="revision-diff-section">
                            <h5>Шапка</h5>
                            {activeRevisionDiff.header_changes.length === 0 ? (
                              <p className="muted">Изменений в шапке нет</p>
                            ) : (
                              activeRevisionDiff.header_changes.map((item) => (
                                <div
                                  key={`${activeRevisionDiff.revision.id}-${item.field}`}
                                  className="revision-diff-item"
                                >
                                  <p>
                                    <strong>{revisionDiffFieldLabel(item.field)}</strong>
                                  </p>
                                  <div className="revision-diff-compare-grid">
                                    <div className="revision-diff-compare-cell revision-diff-compare-cell-before">
                                      <span className="revision-diff-compare-label">Было</span>
                                      <div className="revision-diff-compare-value">
                                        {item.before || "-"}
                                      </div>
                                    </div>
                                    <div className="revision-diff-compare-cell revision-diff-compare-cell-after">
                                      <span className="revision-diff-compare-label">Стало</span>
                                      <div className="revision-diff-compare-value">
                                        {item.after || "-"}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                          <div className="revision-diff-section">
                            <h5>Строки</h5>
                            {activeRevisionDiff.row_changes.length === 0 ? (
                              <p className="muted">Изменений по строкам нет</p>
                            ) : (
                              revisionDiffGroups.map((group) => (
                                <div key={group.key} className="revision-diff-group">
                                  <h6>
                                    {group.title} <span className="muted">({group.items.length})</span>
                                  </h6>
                                  <div className="revision-diff-group-list">
                                    {group.items.map((item) => (
                                      <div
                                        key={`${activeRevisionDiff.revision.id}:${item.segment_uid}`}
                                        className="revision-diff-item"
                                      >
                                        <div className="revision-diff-item-head">
                                          <strong>{revisionDiffRowTitle(item)}</strong>
                                          <div className="revision-diff-badges">
                                            {item.change_types.map((changeType) => (
                                              <span
                                                key={`${item.segment_uid}:${changeType}`}
                                                className={`revision-diff-badge revision-diff-badge-${changeType}`}
                                              >
                                                {revisionChangeTypeLabel(changeType)}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                        {item.changed_fields.length > 0 ? (
                                          <div className="revision-diff-field-list">
                                            <span className="small muted">Изменилось:</span>
                                            {item.changed_fields.map((field) => (
                                              <span
                                                key={`${item.segment_uid}:${field}`}
                                                className="revision-diff-field-chip"
                                              >
                                                {revisionDiffFieldLabel(field)}
                                              </span>
                                            ))}
                                          </div>
                                        ) : null}
                                        {item.order_before !== item.order_after ? (
                                          <p className="muted">
                                            Позиция в таблице: {item.order_before ?? "-"} →{" "}
                                            {item.order_after ?? "-"}
                                          </p>
                                        ) : null}
                                        {(item.before_row || item.after_row) ? (
                                          <div className="revision-diff-compare-grid">
                                            <div className="revision-diff-compare-cell revision-diff-compare-cell-before">
                                              <span className="revision-diff-compare-label">Было</span>
                                              <RevisionRowDiffPreview
                                                row={item.before_row}
                                                changedFields={item.changed_fields}
                                                tone="before"
                                              />
                                            </div>
                                            <div className="revision-diff-compare-cell revision-diff-compare-cell-after">
                                              <span className="revision-diff-compare-label">Стало</span>
                                              <RevisionRowDiffPreview
                                                row={item.after_row}
                                                changedFields={item.changed_fields}
                                                tone="after"
                                              />
                                            </div>
                                          </div>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="revision-history-empty-state">
                    <h4>Выбери версию</h4>
                    <p className="muted">
                      Открой нужную версию слева, чтобы посмотреть детали, сравнение и доступные
                      действия.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function formatTargetLabel(target: FormatTargetKey): string {
  switch (target) {
    case "speaker_fio":
      return "ФИО";
    case "speaker_position":
      return "Должность";
    case "geo":
      return "Гео";
    default:
      return "Текст";
  }
}
