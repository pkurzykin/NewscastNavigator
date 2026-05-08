import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type TextareaHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import {
  addProjectComment,
  addProjectMaterialLink,
  approveProjectRevision,
  branchProjectRevision,
  checkProjectCurrentText,
  createProjectRevision,
  deleteProjectComment,
  deleteProjectFile,
  deleteProjectMaterialLink,
  downloadProjectExport,
  downloadProjectFile,
  syncProjectEditText,
  syncProjectVoiceoverText,
  fetchProjectEditor,
  fetchProjectHistory,
  fetchProjectRevisionDiff,
  fetchProjectRevisionElements,
  fetchProjectRevisions,
  fetchProjectTextStateDiff,
  fetchProjectWorkspace,
  fetchUsers,
  markProjectRevisionCurrent,
  mergeProjectRevisionToMain,
  rejectProjectRevision,
  resolveProjectComment,
  restoreProjectRevisionToWorkspace,
  saveProjectEditor,
  setProjectCurrentText,
  syncProjectTitlesText,
  submitProjectRevision,
  proofreadProjectCurrentText,
  updateProjectEditStatus,
  updateProjectFinalReviewStatus,
  updateProjectCommentWorkflow,
  updateProjectMaterialLink,
  updateProjectTitlesStatus,
  updateProjectVoiceoverStatus,
  updateProjectMeta,
  updateProjectWorkspace,
  uploadProjectFile,
} from "../shared/api";
import type {
  ProjectCommentItem,
  ProjectFileItem,
  ProjectHistoryItem,
  ProjectListItem,
  ProjectMaterialLinkItem,
  ProjectMaterialLinkType,
  ProjectRevisionDiffResponse,
  ProjectRevisionItem,
  ProjectRevisionRowDiffItem,
  ProjectStatusValue,
  EditStatusValue,
  FinalReviewStatusValue,
  TitlesStatusValue,
  VoiceoverStatusValue,
  ProjectTextStateDiffRowItem,
  ProjectTextStateDiffResponse,
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
type EditorViewMode = "edit" | "review";

const TABLE_AUTOSAVE_DELAY_MS = 1400;
const WORKFLOW_AUTOSAVE_DELAY_MS = 1400;
const WORKSPACE_AUTOSAVE_DELAY_MS = 1400;
const SAVE_INDICATOR_DELAY_MS = 450;

const DEFAULT_EDITOR_COLUMN_WIDTHS: Record<EditorColumnKey, number> = {
  order_index: 36,
  block_type: 132,
  text: 540,
  file_bundle: 220,
  additional_comment: 180,
};

const MIN_EDITOR_COLUMN_WIDTHS: Record<EditorColumnKey, number> = {
  order_index: 30,
  block_type: 120,
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

const EDITOR_COLUMN_WIDTHS_STORAGE_KEY = "newscast-editor-column-widths-v3";

const ACTIVE_PROJECT_STATUSES: Array<{ value: ProjectStatusValue; label: string }> = [
  { value: "draft", label: "Черновик" },
  { value: "reviewed", label: "На проверке" },
  { value: "in_editing", label: "В работе" },
  { value: "in_proofreading", label: "На корректуре" },
  { value: "ready", label: "Готово" },
  { value: "delivered", label: "Сдано" },
];

const TITLES_STATUS_OPTIONS: Array<{ value: TitlesStatusValue; label: string }> = [
  { value: "not_started", label: "Не начато" },
  { value: "in_progress", label: "В работе" },
  { value: "review", label: "На проверке" },
  { value: "changes_requested", label: "Нужны правки" },
  { value: "done", label: "Готово" },
];

const EDIT_STATUS_OPTIONS: Array<{ value: EditStatusValue; label: string }> = [
  { value: "not_started", label: "Не начато" },
  { value: "in_progress", label: "В работе" },
  { value: "review", label: "На проверке" },
  { value: "changes_requested", label: "Нужны правки" },
  { value: "done", label: "Готово" },
];

const VOICEOVER_STATUS_OPTIONS: Array<{ value: VoiceoverStatusValue; label: string }> = [
  { value: "not_started", label: "Не начато" },
  { value: "in_progress", label: "В работе" },
  { value: "review", label: "На проверке" },
  { value: "changes_requested", label: "Нужны правки" },
  { value: "done", label: "Готово" },
];

const FINAL_REVIEW_STATUS_OPTIONS: Array<{ value: FinalReviewStatusValue; label: string }> = [
  { value: "not_started", label: "Не отправлено" },
  { value: "submitted", label: "Отправлено наверх" },
  { value: "changes_requested", label: "Вернулось с правками" },
  { value: "approved", label: "Утверждено" },
];

const MATERIAL_LINK_OPTIONS: Array<{ value: ProjectMaterialLinkType; label: string }> = [
  { value: "source_folder", label: "Исходники / папка" },
  { value: "voiceover_folder", label: "Диктор / папка" },
  { value: "master_file", label: "Мастер / файл" },
  { value: "master_folder", label: "Мастер / папка" },
  { value: "text_folder", label: "Тексты / папка" },
  { value: "reference_file", label: "Референс / файл" },
  { value: "reference_folder", label: "Референс / папка" },
  { value: "other", label: "Другое" },
];

const COMMENT_TARGET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "general", label: "Общее замечание" },
  { value: "text", label: "Правка по тексту" },
  { value: "edit", label: "Правка по монтажу" },
  { value: "titles", label: "Правка по титрам" },
  { value: "voiceover", label: "Правка по озвучке" },
  { value: "final_review", label: "Правка после сдачи" },
  { value: "materials", label: "Правка по материалам" },
];

const EVENT_LABELS: Record<string, string> = {
  project_created: "Проект создан",
  project_cloned: "Проект скопирован",
  status_changed: "Статус изменен",
  project_archived: "Проект отправлен в архив",
  project_restored: "Проект возвращен из архива",
  file_uploaded: "Файл загружен",
  material_link_added: "Привязка материала добавлена",
  material_link_updated: "Привязка материала изменена",
  material_link_deleted: "Привязка материала удалена",
  comment_added: "Комментарий добавлен",
  comment_deleted: "Комментарий удален",
  comment_assignee_changed: "Исполнитель правки изменен",
  comment_taken_in_work: "Правка взята в работу",
  comment_released: "Правка снята с работы",
  assignment_changed: "Назначение изменено",
  text_updated: "Текст обновлен",
  text_current_set: "Текущий текст назначен",
  text_checked: "Текст проверен",
  text_proofread: "Текст вычитан",
  titles_text_synced: "Титры синхронизированы с текстом",
  titles_status_changed: "Статус титров изменен",
  edit_text_synced: "Монтаж синхронизирован с текстом",
  edit_status_changed: "Статус монтажа изменен",
  voiceover_text_synced: "Озвучка синхронизирована с текстом",
  voiceover_status_changed: "Статус озвучки изменен",
  final_review_status_changed: "Статус внешней сдачи изменен",
  comment_resolved: "Правка закрыта",
  comment_reopened: "Правка возвращена в работу",
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

function normalizeTimecodeDisplayValue(rawValue: string): string {
  const normalized = normalizeTimecodeInputValue(rawValue);
  if (/^\d{4}$/.test(normalized)) {
    return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
  }
  if (/^\d{6}$/.test(normalized)) {
    return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}:${normalized.slice(4, 6)}`;
  }
  return normalized;
}

function isValidTimecodeValue(rawValue: string): boolean {
  const normalized = normalizeTimecodeDisplayValue(rawValue);
  return normalized === "" || /^\d{2}:\d{2}$/.test(normalized) || /^\d{2}:\d{2}:\d{2}$/.test(normalized);
}

function isSoftTimecodeDraftValue(rawValue: string): boolean {
  const normalized = String(rawValue || "").trim().replace(/[.;]/g, ":");
  const colonCount = (normalized.match(/:/g) || []).length;
  return (
    /^\d{1,6}$/.test(normalized) ||
    (/^[\d:]{1,8}$/.test(normalized) && colonCount <= 2)
  );
}

function timecodeValidationMessage(rawValue: string): string {
  if (isSoftTimecodeDraftValue(rawValue)) {
    return "";
  }
  return isValidTimecodeValue(rawValue) ? "" : "Формат: ММ:СС или ЧЧ:ММ:СС";
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

function canSetCurrentText(userRole: string, projectStatus: string): boolean {
  const normalizedRole = (userRole || "").trim().toLowerCase();
  return (
    ["admin", "editor", "author", "proofreader"].includes(normalizedRole) &&
    normalizeProjectStatus(projectStatus) !== "archived"
  );
}

function canCheckCurrentText(userRole: string, projectStatus: string): boolean {
  const normalizedRole = (userRole || "").trim().toLowerCase();
  return (
    ["admin", "editor", "proofreader"].includes(normalizedRole) &&
    normalizeProjectStatus(projectStatus) !== "archived"
  );
}

function canProofreadCurrentText(userRole: string, projectStatus: string): boolean {
  const normalizedRole = (userRole || "").trim().toLowerCase();
  return (
    ["admin", "proofreader"].includes(normalizedRole) &&
    normalizeProjectStatus(projectStatus) !== "archived"
  );
}

function canManageTitles(userRole: string, projectStatus: string): boolean {
  const normalizedRole = (userRole || "").trim().toLowerCase();
  return (
    ["admin", "editor", "designer"].includes(normalizedRole) &&
    normalizeProjectStatus(projectStatus) !== "archived"
  );
}

function canManageEditTrack(userRole: string, projectStatus: string): boolean {
  const normalizedRole = (userRole || "").trim().toLowerCase();
  return (
    ["admin", "editor", "montager"].includes(normalizedRole) &&
    normalizeProjectStatus(projectStatus) !== "archived"
  );
}

function canManageVoiceover(userRole: string, projectStatus: string): boolean {
  const normalizedRole = (userRole || "").trim().toLowerCase();
  return (
    ["admin", "editor", "proofreader"].includes(normalizedRole) &&
    normalizeProjectStatus(projectStatus) !== "archived"
  );
}

function canManageFinalReview(userRole: string, projectStatus: string): boolean {
  const normalizedRole = (userRole || "").trim().toLowerCase();
  return (
    ["admin", "editor", "proofreader"].includes(normalizedRole) &&
    normalizeProjectStatus(projectStatus) !== "archived"
  );
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
  proofreaderUserId: string,
  titlesAssigneeUserId: string,
  editAssigneeUserId: string
): string {
  return JSON.stringify({
    status,
    author_user_id: authorUserId || "",
    executor_user_ids: normalizeIdList(executorUserIds),
    proofreader_user_id: proofreaderUserId || "",
    titles_assignee_user_id: titlesAssigneeUserId || "",
    edit_assignee_user_id: editAssigneeUserId || "",
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

function materialLinkTypeLabel(value?: string | null): string {
  const lookup = MATERIAL_LINK_OPTIONS.find((item) => item.value === value);
  return lookup?.label || value || "-";
}

function externalPathHref(pathValue?: string | null): string {
  const value = (pathValue || "").trim();
  if (!value) {
    return "";
  }
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("file://") ||
    value.startsWith("smb://")
  ) {
    return value;
  }
  if (value.startsWith("\\\\")) {
    return `file:${value.replace(/\\/g, "/")}`;
  }
  if (value.startsWith("/")) {
    return `file://${value}`;
  }
  return "";
}

function commentTargetLabel(value?: string | null): string {
  const lookup = COMMENT_TARGET_OPTIONS.find((item) => item.value === value);
  return lookup?.label || value || "-";
}

function commentAssignableUsers(targetKind: string, users: UserListItem[]): UserListItem[] {
  const normalizedTarget = (targetKind || "").trim().toLowerCase();
  const roleMap: Record<string, string[]> = {
    text: ["admin", "editor", "author", "proofreader"],
    edit: ["admin", "editor", "montager"],
    titles: ["admin", "editor", "designer"],
    voiceover: ["admin", "editor", "proofreader"],
    final_review: ["admin", "editor", "proofreader"],
    materials: ["admin", "editor", "author", "proofreader", "montager", "designer"],
    general: ["admin", "editor", "author", "proofreader", "montager", "designer"],
  };
  const allowedRoles = new Set(roleMap[normalizedTarget] || roleMap.general);
  return users.filter((item) => item.is_active && allowedRoles.has((item.role || "").trim().toLowerCase()));
}

function defaultCommentAssigneeId(targetKind: string, project: ProjectListItem | null): number | null {
  if (!project) {
    return null;
  }
  const normalizedTarget = (targetKind || "").trim().toLowerCase();
  if (normalizedTarget === "edit") {
    return project.edit_assignee_user_id || null;
  }
  if (normalizedTarget === "titles") {
    return project.titles_assignee_user_id || null;
  }
  if (normalizedTarget === "text") {
    return project.proofreader_user_id || project.author_user_id || null;
  }
  if (normalizedTarget === "voiceover") {
    return project.proofreader_user_id || null;
  }
  if (normalizedTarget === "final_review") {
    return project.author_user_id || null;
  }
  return null;
}

function userDisplayName(item?: UserListItem | UserPublic | null): string {
  if (!item) {
    return "-";
  }
  const fullName = (item.full_name || "").trim();
  const jobTitle = (item.job_title || "").trim();
  if (fullName && jobTitle) {
    return `${fullName} (${jobTitle})`;
  }
  if (fullName) {
    return fullName;
  }
  if (jobTitle) {
    return `${item.username} (${jobTitle})`;
  }
  return item.username;
}

function commentWorkflowStatus(item: ProjectCommentItem): "resolved" | "in_progress" | "open" | "comment" {
  if (!item.requires_action) {
    return "comment";
  }
  if (item.is_resolved) {
    return "resolved";
  }
  if (item.taken_in_work_at) {
    return "in_progress";
  }
  return "open";
}

function commentWorkflowStatusLabel(item: ProjectCommentItem): string {
  const status = commentWorkflowStatus(item);
  if (status === "resolved") {
    return "Правка закрыта";
  }
  if (status === "in_progress") {
    return "Правка в работе";
  }
  if (status === "open") {
    return "Ждет исполнения";
  }
  return "Комментарий";
}

function isEditorLikeRole(role?: string | null): boolean {
  const normalized = (role || "").trim().toLowerCase();
  return normalized === "admin" || normalized === "editor";
}

function commentWorkflowHint(item: ProjectCommentItem): string {
  const status = commentWorkflowStatus(item);
  if (status === "resolved") {
    return "Правка закрыта. Если появились новые замечания, верните задачу в очередь.";
  }
  if (status === "in_progress") {
    return "Следующий шаг: внести правку и закрыть задачу.";
  }
  if (status === "open") {
    return "Следующий шаг: взять задачу в работу.";
  }
  return "Обычный комментарий без action workflow.";
}

function eventTypeLabel(value: string): string {
  return EVENT_LABELS[value] || value;
}

function parseHistoryMeta(rawValue?: string | null): Record<string, unknown> | null {
  if (!rawValue) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function historyFieldLabel(value?: string | null): string {
  switch ((value || "").trim()) {
    case "author_user_id":
      return "Автор";
    case "executor_user_ids":
      return "Исполнители";
    case "proofreader_user_id":
      return "Корректор";
    case "titles_assignee_user_id":
      return "Ответственный за титры";
    case "edit_assignee_user_id":
      return "Ответственный за монтаж";
    default:
      return value || "-";
  }
}

function historyEventTargetKind(item: ProjectHistoryItem): string {
  const meta = parseHistoryMeta(item.meta_json);
  const metaTargetKind = typeof meta?.target_kind === "string" ? meta.target_kind : "";
  if (metaTargetKind) {
    return metaTargetKind;
  }
  if (
    item.event_type.startsWith("text_") ||
    item.event_type.startsWith("revision_")
  ) {
    return "text";
  }
  if (item.event_type.startsWith("edit_")) {
    return "edit";
  }
  if (item.event_type.startsWith("titles_")) {
    return "titles";
  }
  if (item.event_type.startsWith("voiceover_")) {
    return "voiceover";
  }
  if (item.event_type.startsWith("material_link_") || item.event_type === "file_uploaded") {
    return "materials";
  }
  if (item.event_type === "final_review_status_changed") {
    return "final_review";
  }
  return "general";
}

function historyEventDetail(item: ProjectHistoryItem): string {
  const meta = parseHistoryMeta(item.meta_json);

  if (item.event_type === "comment_added") {
    const targetKind = typeof meta?.target_kind === "string" ? meta.target_kind : "general";
    const requiresAction = Boolean(meta?.requires_action);
    const snapshotKind =
      typeof meta?.created_text_snapshot_kind === "string" ? meta.created_text_snapshot_kind : "";
    const snapshotSeq =
      typeof meta?.created_text_seq === "number" ? meta.created_text_seq : null;
    const snapshotText =
      snapshotKind && snapshotSeq
        ? ` · ${textSnapshotKindLabel(snapshotKind)} ${formatTextSeq(snapshotSeq)}`
        : "";
    const revisionNo =
      typeof meta?.created_revision_no === "number" ? meta.created_revision_no : null;
    const revisionText = revisionNo ? ` · revision v${revisionNo}` : "";
    return requiresAction
      ? `${commentTargetLabel(targetKind)} · поставлена открытая правка${snapshotText}${revisionText}`
      : `${commentTargetLabel(targetKind)} · добавлен комментарий${snapshotText}${revisionText}`;
  }
  if (item.event_type === "comment_resolved" || item.event_type === "comment_reopened") {
    const targetKind = typeof meta?.target_kind === "string" ? meta.target_kind : "general";
    const snapshotKind =
      typeof meta?.resolved_text_snapshot_kind === "string" ? meta.resolved_text_snapshot_kind : "";
    const snapshotSeq =
      typeof meta?.resolved_text_seq === "number" ? meta.resolved_text_seq : null;
    const snapshotText =
      snapshotKind && snapshotSeq
        ? ` · ${textSnapshotKindLabel(snapshotKind)} ${formatTextSeq(snapshotSeq)}`
        : "";
    const revisionNo =
      typeof meta?.resolved_revision_no === "number" ? meta.resolved_revision_no : null;
    const revisionText = revisionNo ? ` · revision v${revisionNo}` : "";
    return `${commentTargetLabel(targetKind)}${snapshotText}${revisionText}`;
  }
  if (item.event_type === "comment_assignee_changed") {
    return `${commentTargetLabel(typeof meta?.target_kind === "string" ? meta.target_kind : "general")} · изменен исполнитель`;
  }
  if (item.event_type === "comment_taken_in_work") {
    return `${commentTargetLabel(typeof meta?.target_kind === "string" ? meta.target_kind : "general")} · правка взята в работу`;
  }
  if (item.event_type === "comment_released") {
    return `${commentTargetLabel(typeof meta?.target_kind === "string" ? meta.target_kind : "general")} · правка возвращена в очередь`;
  }
  if (item.event_type === "assignment_changed") {
    return `Поле: ${historyFieldLabel(typeof meta?.field === "string" ? meta.field : "")}`;
  }
  if (item.event_type === "text_updated") {
    return Boolean(meta?.auto_current_initialized)
      ? "Первая сохраненная версия сразу стала current"
      : "В workspace сохранены новые правки текста";
  }
  if (item.event_type === "text_current_set") {
    return `Назначен handoff ${formatTextSeq(Number(item.new_value || 0))}`;
  }
  if (item.event_type === "text_checked") {
    return `Проверена версия ${formatTextSeq(Number(item.new_value || 0))}`;
  }
  if (item.event_type === "text_proofread") {
    return `Вычитана версия ${formatTextSeq(Number(item.new_value || 0))}`;
  }
  if (item.event_type === "edit_text_synced") {
    return `Монтаж привязан к handoff ${formatTextSeq(Number(item.new_value || 0))}`;
  }
  if (item.event_type === "titles_text_synced") {
    return `Титры привязаны к вычитанной версии ${formatTextSeq(Number(item.new_value || 0))}`;
  }
  if (item.event_type === "voiceover_text_synced") {
    return `Озвучка привязана к вычитанной версии ${formatTextSeq(Number(item.new_value || 0))}`;
  }
  if (item.event_type === "edit_status_changed") {
    return `Статус: ${editStatusLabel(item.old_value)} -> ${editStatusLabel(item.new_value)}`;
  }
  if (item.event_type === "titles_status_changed") {
    return `Статус: ${titlesStatusLabel(item.old_value)} -> ${titlesStatusLabel(item.new_value)}`;
  }
  if (item.event_type === "voiceover_status_changed") {
    return `Статус: ${voiceoverStatusLabel(item.old_value)} -> ${voiceoverStatusLabel(item.new_value)}`;
  }
  if (item.event_type === "final_review_status_changed") {
    return `Статус: ${finalReviewStatusLabel(item.old_value)} -> ${finalReviewStatusLabel(item.new_value)}`;
  }
  if (
    item.event_type === "material_link_added" ||
    item.event_type === "material_link_updated" ||
    item.event_type === "material_link_deleted"
  ) {
    const linkType = typeof meta?.link_type === "string" ? meta.link_type : "other";
    return materialLinkTypeLabel(linkType);
  }
  if (item.event_type === "project_cloned" && typeof meta?.source_project_id === "number") {
    return `Источник: #${meta.source_project_id}`;
  }
  if (item.old_value || item.new_value) {
    return `${item.old_value || "-"} -> ${item.new_value || "-"}`;
  }
  return "Изменение зафиксировано в истории проекта";
}

function eventSupportsCommentLink(item: ProjectHistoryItem): boolean {
  return [
    "text_updated",
    "text_current_set",
    "text_checked",
    "text_proofread",
    "edit_text_synced",
    "edit_status_changed",
    "titles_text_synced",
    "titles_status_changed",
    "voiceover_text_synced",
    "voiceover_status_changed",
    "final_review_status_changed",
    "material_link_added",
    "material_link_updated",
    "material_link_deleted",
    "comment_assignee_changed",
    "comment_taken_in_work",
    "comment_released",
    "comment_resolved",
    "comment_reopened",
  ].includes(item.event_type);
}

function commentRelatedEventKinds(targetKind: string): string[] {
  if (targetKind === "text") {
    return ["text_updated", "text_current_set", "text_checked", "text_proofread", "revision_restored_to_workspace"];
  }
  if (targetKind === "edit") {
    return ["edit_text_synced", "edit_status_changed"];
  }
  if (targetKind === "titles") {
    return ["titles_text_synced", "titles_status_changed"];
  }
  if (targetKind === "voiceover") {
    return ["voiceover_text_synced", "voiceover_status_changed"];
  }
  if (targetKind === "materials") {
    return ["material_link_added", "material_link_updated", "material_link_deleted", "file_uploaded"];
  }
  if (targetKind === "final_review") {
    return ["final_review_status_changed", "comment_assignee_changed", "comment_taken_in_work", "comment_released"];
  }
  return ["status_changed", "assignment_changed", "comment_assignee_changed", "comment_taken_in_work", "comment_released"];
}

function preferredDiffActionForComment(
  comment: ProjectCommentItem,
  project: ProjectListItem | null
): { kind: "current" | "checked" | "proofread"; label: string } | null {
  if (!project) {
    return null;
  }
  if (comment.target_kind === "edit" && project.current_text_seq) {
    return { kind: "current", label: "Открыть diff handoff" };
  }
  if ((comment.target_kind === "titles" || comment.target_kind === "voiceover") && project.proofread_text_seq) {
    return { kind: "proofread", label: "Открыть diff вычитки" };
  }
  if (comment.target_kind === "text") {
    if (project.proofread_text_seq) {
      return { kind: "proofread", label: "Что изменилось после вычитки" };
    }
    if (project.current_text_seq) {
      return { kind: "current", label: "Что изменилось после handoff" };
    }
  }
  return null;
}

interface CommentTextFreshness {
  isOutdated: boolean;
  fromSeq: number | null;
  toSeq: number | null;
  basisLabel: string;
}

function latestTextSeqForComment(
  comment: ProjectCommentItem,
  project: ProjectListItem | null
): { seq: number | null; basisLabel: string } {
  if (!project) {
    return { seq: null, basisLabel: "workspace" };
  }
  const targetKind = (comment.target_kind || "").trim().toLowerCase();
  if (targetKind === "edit") {
    return {
      seq: project.current_text_seq || project.text_seq || null,
      basisLabel: "current handoff",
    };
  }
  if (targetKind === "titles" || targetKind === "voiceover") {
    return {
      seq: project.text_seq || null,
      basisLabel: "workspace",
    };
  }
  return {
    seq: project.text_seq || null,
    basisLabel: "workspace",
  };
}

function commentTextFreshness(
  comment: ProjectCommentItem,
  project: ProjectListItem | null
): CommentTextFreshness {
  const fromSeq = typeof comment.created_text_seq === "number" ? comment.created_text_seq : null;
  const { seq: toSeq, basisLabel } = latestTextSeqForComment(comment, project);
  const isOutdated = Boolean(fromSeq && toSeq && toSeq > fromSeq);
  return {
    isOutdated,
    fromSeq,
    toSeq,
    basisLabel,
  };
}

function commentOutdatedHint(targetKind?: string | null): string {
  const normalized = (targetKind || "").trim().toLowerCase();
  if (normalized === "titles") {
    return "Проверь diff и пересинхронизируй титры по актуальному тексту.";
  }
  if (normalized === "edit") {
    return "Проверь diff и обнови монтаж по актуальному handoff.";
  }
  if (normalized === "voiceover") {
    return "Проверь diff и обнови озвучку по актуальному тексту.";
  }
  return "Проверь diff и обнови задачу, если изменился смысл правки.";
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

function EditorRowReadPreview({ row }: { row: ScriptElementRow }): JSX.Element {
  const previewLines: Array<{
    key: string;
    html: string;
    style: CSSProperties;
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
        className: "editor-read-preview-line-emphasis",
      });
    }
    if (positionTarget?.html || positionTarget?.text) {
      previewLines.push({
        key: "speaker_position",
        html: positionTarget?.html || buildRichTextHtmlFromPlainText(snhParts.position),
        style: buildFormattingStyle(getFormattingTarget(row, "speaker_position")),
        className: "editor-read-preview-line-emphasis",
      });
    }
    if (textTarget?.html || textTarget?.text) {
      previewLines.push({
        key: "text",
        html: textTarget?.html || buildRichTextHtmlFromPlainText(row.text),
        style: buildFormattingStyle(getFormattingTarget(row, "text")),
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
      });
    }
    if (textTarget?.html || textTarget?.text) {
      previewLines.push({
        key: "text",
        html: textTarget?.html || buildRichTextHtmlFromPlainText(zkGeoParts.text),
        style: buildFormattingStyle(getFormattingTarget(row, "text")),
      });
    }
  } else {
    const textTarget = getRichTextTarget(row, "text", row.text);
    previewLines.push({
      key: "text",
      html: textTarget?.html || buildRichTextHtmlFromPlainText(row.text),
      style: buildFormattingStyle(getFormattingTarget(row, "text")),
    });
  }

  return (
    <div className="editor-read-preview">
      {previewLines.length === 0 ? <p className="muted">Пустой блок</p> : null}
      {previewLines.map((line) => (
        <div
          key={line.key}
          className={`editor-read-preview-line${line.className ? ` ${line.className}` : ""}`}
          style={line.style}
          dangerouslySetInnerHTML={{ __html: line.html }}
        />
      ))}
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

function textStateDiffRowTitle(item: ProjectTextStateDiffRowItem): string {
  const row = item.after_row || item.before_row;
  const order = item.order_after ?? item.order_before;
  const prefix = order ? `Строка ${order}` : "Строка";
  return `${prefix} · ${blockTypeLabel(String(row?.block_type || ""))}`;
}

function primaryTextStateChangeType(item: ProjectTextStateDiffRowItem): string {
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

function formatTextSeq(value?: number | null): string {
  if (!value || value < 1) {
    return "-";
  }
  return `#${value}`;
}

function textStateTone(active: boolean, stale: boolean): "fresh" | "stale" | "empty" {
  if (!active) {
    return "empty";
  }
  return stale ? "stale" : "fresh";
}

function textStateLabel(active: boolean, stale: boolean, positiveLabel: string): string {
  if (!active) {
    return "Нет";
  }
  return stale ? `${positiveLabel}, но устарело` : positiveLabel;
}

function textSnapshotKindLabel(value: string): string {
  if (value === "workspace") {
    return "workspace-версия";
  }
  if (value === "current") {
    return "текущий handoff";
  }
  if (value === "checked") {
    return "проверенный текст";
  }
  if (value === "proofread") {
    return "вычитанный текст";
  }
  return value || "-";
}

function commentSnapshotLabel(kind?: string | null, seq?: number | null): string {
  if (!kind || !seq) {
    return "";
  }
  return `${textSnapshotKindLabel(kind)} ${formatTextSeq(seq)}`;
}

function commentRevisionLabel(revisionNo?: number | null): string {
  if (!revisionNo) {
    return "";
  }
  return `v${revisionNo}`;
}

function titlesStatusLabel(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  const match = TITLES_STATUS_OPTIONS.find((item) => item.value === normalized);
  return match?.label || value || "-";
}

function titlesStatusTone(value?: string | null, needsAttention = false): "fresh" | "stale" | "empty" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "not_started" || !normalized) {
    return "empty";
  }
  if (needsAttention || normalized === "changes_requested") {
    return "stale";
  }
  return "fresh";
}

function editStatusLabel(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  const match = EDIT_STATUS_OPTIONS.find((item) => item.value === normalized);
  return match?.label || value || "-";
}

function editStatusTone(value?: string | null, needsAttention = false): "fresh" | "stale" | "empty" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "not_started" || !normalized) {
    return "empty";
  }
  if (needsAttention || normalized === "changes_requested") {
    return "stale";
  }
  return "fresh";
}

function voiceoverStatusLabel(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  const match = VOICEOVER_STATUS_OPTIONS.find((item) => item.value === normalized);
  return match?.label || value || "-";
}

function voiceoverStatusTone(value?: string | null, needsAttention = false): "fresh" | "stale" | "empty" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "not_started" || !normalized) {
    return "empty";
  }
  if (needsAttention || normalized === "changes_requested") {
    return "stale";
  }
  return "fresh";
}

function finalReviewStatusLabel(value?: string | null): string {
  const normalized = (value || "").trim().toLowerCase();
  const match = FINAL_REVIEW_STATUS_OPTIONS.find((item) => item.value === normalized);
  return match?.label || value || "-";
}

function finalReviewStatusTone(value?: string | null): "fresh" | "stale" | "empty" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "not_started" || !normalized) {
    return "empty";
  }
  if (normalized === "changes_requested") {
    return "stale";
  }
  return "fresh";
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
  const [metaTitlesAssigneeUserId, setMetaTitlesAssigneeUserId] = useState("");
  const [metaEditAssigneeUserId, setMetaEditAssigneeUserId] = useState("");
  const [workspaceFileRoots, setWorkspaceFileRoots] = useState<string[]>([]);
  const [workspaceNote, setWorkspaceNote] = useState("");
  const [comments, setComments] = useState<ProjectCommentItem[]>([]);
  const [materialLinks, setMaterialLinks] = useState<ProjectMaterialLinkItem[]>([]);
  const [files, setFiles] = useState<ProjectFileItem[]>([]);
  const [newComment, setNewComment] = useState("");
  const [newCommentTargetKind, setNewCommentTargetKind] = useState("general");
  const [newCommentRequiresAction, setNewCommentRequiresAction] = useState(false);
  const [newCommentAssigneeUserId, setNewCommentAssigneeUserId] = useState("");
  const [newMaterialLinkType, setNewMaterialLinkType] =
    useState<ProjectMaterialLinkType | string>("source_folder");
  const [newMaterialLinkPath, setNewMaterialLinkPath] = useState("");
  const [newMaterialLinkComment, setNewMaterialLinkComment] = useState("");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [textStateAction, setTextStateAction] = useState<"" | "current" | "check" | "proofread">(
    ""
  );
  const [voiceoverAction, setVoiceoverAction] = useState<"" | "sync" | "status">("");
  const [voiceoverStatusDraft, setVoiceoverStatusDraft] =
    useState<VoiceoverStatusValue | string>("not_started");
  const [finalReviewAction, setFinalReviewAction] = useState(false);
  const [finalReviewStatusDraft, setFinalReviewStatusDraft] =
    useState<FinalReviewStatusValue | string>("not_started");
  const [editAction, setEditAction] = useState<"" | "sync" | "status">("");
  const [editStatusDraft, setEditStatusDraft] = useState<EditStatusValue | string>("not_started");
  const [titlesAction, setTitlesAction] = useState<"" | "sync" | "status">("");
  const [titlesStatusDraft, setTitlesStatusDraft] = useState<TitlesStatusValue | string>("not_started");
  const [showSavingIndicator, setShowSavingIndicator] = useState(false);
  const [tableAutosaveState, setTableAutosaveState] = useState<AutosaveState>("idle");
  const [workflowAutosaveState, setWorkflowAutosaveState] = useState<AutosaveState>("idle");
  const [workspaceAutosaveState, setWorkspaceAutosaveState] = useState<AutosaveState>("idle");
  const [lastSuccessfulSaveAt, setLastSuccessfulSaveAt] = useState<string | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [materialLinkAction, setMaterialLinkAction] = useState<"add" | "update" | "delete" | "">("");
  const [fileUploading, setFileUploading] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);
  const [commentResolutionAction, setCommentResolutionAction] = useState<"" | "resolve" | "reopen">("");
  const [commentWorkflowAction, setCommentWorkflowAction] =
    useState<"" | "assign" | "take" | "release">("");
  const [busyMaterialLinkId, setBusyMaterialLinkId] = useState<number | null>(null);
  const [busyFileId, setBusyFileId] = useState<number | null>(null);
  const [busyRevisionId, setBusyRevisionId] = useState<string | null>(null);
  const [revisionAction, setRevisionAction] = useState<RevisionActionKind | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"" | "docx" | "pdf">("");
  const [textStateDiff, setTextStateDiff] = useState<ProjectTextStateDiffResponse | null>(null);
  const [textStateDiffLoading, setTextStateDiffLoading] = useState(false);
  const [textStateDiffKind, setTextStateDiffKind] = useState<"" | "current" | "checked" | "proofread">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>("edit");
  const [activeTimecodeFieldKey, setActiveTimecodeFieldKey] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] =
    useState<Record<EditorColumnKey, number>>(loadEditorColumnWidths);
  const [activeFormatScope, setActiveFormatScope] = useState<ActiveFormatScope | null>(null);
  const [fileBundleDrafts, setFileBundleDrafts] = useState<Record<number, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const commentComposerRef = useRef<HTMLDivElement | null>(null);
  const fileBundleInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
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

  function clearTextStateDiff(): void {
    setTextStateDiff(null);
    setTextStateDiffKind("");
  }

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
    setMetaTitlesAssigneeUserId(
      projectItem.titles_assignee_user_id ? String(projectItem.titles_assignee_user_id) : ""
    );
    setMetaEditAssigneeUserId(
      projectItem.edit_assignee_user_id ? String(projectItem.edit_assignee_user_id) : ""
    );
    setFinalReviewStatusDraft(projectItem.final_review_status || "not_started");
    setVoiceoverStatusDraft(projectItem.voiceover_status || "not_started");
    setEditStatusDraft(projectItem.edit_status || "not_started");
    setTitlesStatusDraft(projectItem.titles_status || "not_started");
  }

  function markSuccessfulSave(): void {
    setLastSuccessfulSaveAt(new Date().toISOString());
  }

  async function refreshWorkspaceSection(): Promise<void> {
    const payload = await fetchProjectWorkspace(token, projectId);
    setWorkspaceFileRoots(payload.workspace.file_roots || []);
    setWorkspaceNote(payload.workspace.project_note || "");
    setComments(payload.comments || []);
    setMaterialLinks(payload.material_links || []);
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
      setMaterialLinks(workspacePayload.material_links || []);
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
          : "",
        editorPayload.project.titles_assignee_user_id
          ? String(editorPayload.project.titles_assignee_user_id)
          : "",
        editorPayload.project.edit_assignee_user_id
          ? String(editorPayload.project.edit_assignee_user_id)
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
  const canSetCurrentTextState = useMemo(
    () => canSetCurrentText(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const canCheckCurrentTextState = useMemo(
    () => canCheckCurrentText(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const canProofreadCurrentTextState = useMemo(
    () => canProofreadCurrentText(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const canManageTitlesState = useMemo(
    () => canManageTitles(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const canManageEditState = useMemo(
    () => canManageEditTrack(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const canManageVoiceoverState = useMemo(
    () => canManageVoiceover(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const canManageFinalReviewState = useMemo(
    () => canManageFinalReview(user.role, projectStatus),
    [projectStatus, user.role]
  );
  const hasLatestText = (project?.text_seq || 0) > 0;
  const hasCurrentText = Boolean(project?.current_text_seq);
  const currentTextOutdated = Boolean(project && !project.current_text_is_latest && hasCurrentText);
  const checkedOutdated = Boolean(project?.checked_text_seq && !project?.latest_text_is_checked);
  const proofreadOutdated = Boolean(
    project?.proofread_text_seq && !project?.latest_text_is_proofread
  );
  const titlesStatus = String(project?.titles_status || "not_started");
  const titlesCanSync = Boolean(project?.latest_text_is_proofread);
  const titlesHasSource = Boolean(project?.titles_text_seq);
  const titlesRequiresResync = Boolean(project?.titles_requires_resync);
  const editStatus = String(project?.edit_status || "not_started");
  const editCanSync = Boolean(project?.current_text_seq);
  const editHasSource = Boolean(project?.edit_text_seq);
  const editRequiresResync = Boolean(project?.edit_requires_resync);
  const voiceoverStatus = String(project?.voiceover_status || "not_started");
  const voiceoverCanSync = Boolean(project?.latest_text_is_proofread);
  const voiceoverHasSource = Boolean(project?.voiceover_text_seq);
  const voiceoverRequiresResync = Boolean(project?.voiceover_requires_resync);
  const finalReviewStatus = String(project?.final_review_status || "not_started");
  const usersById = useMemo(() => {
    const result = new Map<number, UserListItem>();
    for (const item of users) {
      result.set(item.id, item);
    }
    return result;
  }, [users]);
  const newCommentAssigneeCandidates = useMemo(
    () => commentAssignableUsers(newCommentTargetKind, users),
    [newCommentTargetKind, users]
  );
  const designerUsers = useMemo(
    () =>
      users.filter((item) =>
        ["admin", "editor", "designer"].includes((item.role || "").trim().toLowerCase())
      ),
    [users]
  );
  const montagerUsers = useMemo(
    () =>
      users.filter((item) =>
        ["admin", "editor", "montager"].includes((item.role || "").trim().toLowerCase())
      ),
    [users]
  );
  const titlesAssigneeName = project?.titles_assignee_user_id
    ? userDisplayName(usersById.get(project.titles_assignee_user_id))
    : "-";
  const editAssigneeName = project?.edit_assignee_user_id
    ? userDisplayName(usersById.get(project.edit_assignee_user_id))
    : "-";
  const isCurrentUserTitlesAssignee =
    Boolean(user.id) && project?.titles_assignee_user_id === user.id;
  const isCurrentUserEditAssignee =
    Boolean(user.id) && project?.edit_assignee_user_id === user.id;
  const openActionComments = useMemo(
    () => comments.filter((item) => item.requires_action && !item.is_resolved),
    [comments]
  );
  const openActionCommentsByTarget = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of openActionComments) {
      result[item.target_kind] = (result[item.target_kind] || 0) + 1;
    }
    return result;
  }, [openActionComments]);
  const myOpenActionComments = useMemo(
    () =>
      openActionComments.filter((item) => {
        if (item.assignee_user_id) {
          return item.assignee_user_id === user.id;
        }
        if (item.target_kind === "edit") {
          return isCurrentUserEditAssignee;
        }
        if (item.target_kind === "titles") {
          return isCurrentUserTitlesAssignee;
        }
        if (item.target_kind === "text") {
          return project?.author_user_id === user.id || project?.proofreader_user_id === user.id;
        }
        if (item.target_kind === "voiceover") {
          return project?.proofreader_user_id === user.id;
        }
        if (item.target_kind === "final_review") {
          return ["admin", "editor", "proofreader"].includes((user.role || "").trim().toLowerCase());
        }
        if (item.target_kind === "materials") {
          return ["admin", "editor", "author", "proofreader"].includes(
            (user.role || "").trim().toLowerCase()
          );
        }
        return ["admin", "editor"].includes((user.role || "").trim().toLowerCase());
      }),
    [
      isCurrentUserEditAssignee,
      isCurrentUserTitlesAssignee,
      openActionComments,
      project?.author_user_id,
      project?.proofreader_user_id,
      user.id,
      user.role,
    ]
  );
  const commentRelatedHistoryById = useMemo(() => {
    const result: Record<number, ProjectHistoryItem[]> = {};
    for (const comment of comments) {
      const commentCreatedAt = comment.created_at ? new Date(comment.created_at).getTime() : 0;
      const commentResolvedAt = comment.resolved_at ? new Date(comment.resolved_at).getTime() : Number.POSITIVE_INFINITY;
      const allowedEventKinds = new Set(commentRelatedEventKinds(comment.target_kind));
      result[comment.id] = history
        .filter((item) => {
          if (!eventSupportsCommentLink(item)) {
            return false;
          }
          const itemMeta = parseHistoryMeta(item.meta_json);
          const itemCreatedAt = item.created_at ? new Date(item.created_at).getTime() : 0;
          if (typeof itemMeta?.comment_id === "number" && itemMeta.comment_id === comment.id) {
            return true;
          }
          if (itemCreatedAt < commentCreatedAt || itemCreatedAt > commentResolvedAt) {
            return false;
          }
          if (!allowedEventKinds.has(item.event_type)) {
            return false;
          }
          return historyEventTargetKind(item) === comment.target_kind;
        })
        .slice(0, 4);
    }
    return result;
  }, [comments, history]);
  const materialLinkCountsByType = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of materialLinks) {
      result[item.link_type] = (result[item.link_type] || 0) + 1;
    }
    return result;
  }, [materialLinks]);
  const actionTrackCards = useMemo<
    Array<{
      key: string;
      title: string;
      count: number;
      tone: "warn" | "fresh" | "muted";
      detail: string;
      extra: string;
      diffAction: { kind: "current" | "checked" | "proofread"; label: string } | null;
    }>
  >(
    () => [
      {
        key: "text",
        title: "Текст",
        count: openActionCommentsByTarget.text || 0,
        tone:
          (openActionCommentsByTarget.text || 0) > 0 || currentTextOutdated || proofreadOutdated
            ? "warn"
            : hasCurrentText
              ? "fresh"
              : "muted",
        detail:
          (openActionCommentsByTarget.text || 0) > 0
            ? `Открытых правок: ${openActionCommentsByTarget.text || 0}.`
            : hasCurrentText
              ? "Открытых правок по тексту нет."
              : "Текущий handoff еще не назначен.",
        extra:
          currentTextOutdated || proofreadOutdated
            ? "После handoff или вычитки появились новые правки."
            : hasCurrentText
              ? `Current ${formatTextSeq(project?.current_text_seq)}.`
              : "Ждет назначения current.",
        diffAction: project?.current_text_seq
          ? {
              kind: (proofreadOutdated && project?.proofread_text_seq ? "proofread" : "current") as
                | "current"
                | "proofread",
              label:
                proofreadOutdated && project?.proofread_text_seq
                  ? "Открыть diff вычитки"
                  : "Открыть diff handoff",
            }
          : null,
      },
      {
        key: "edit",
        title: "Монтаж",
        count: openActionCommentsByTarget.edit || 0,
        tone:
          (openActionCommentsByTarget.edit || 0) > 0 || editRequiresResync
            ? "warn"
            : editHasSource
              ? "fresh"
              : "muted",
        detail:
          (openActionCommentsByTarget.edit || 0) > 0
            ? `Открытых правок: ${openActionCommentsByTarget.edit || 0}.`
            : editHasSource
              ? "Открытых правок по монтажу нет."
              : "Монтаж еще не брал текст в работу.",
        extra: editRequiresResync
          ? `Монтаж на ${formatTextSeq(project?.edit_text_seq)}, current уже ${formatTextSeq(project?.current_text_seq)}.`
          : `Источник монтажа: ${formatTextSeq(project?.edit_text_seq)}.`,
        diffAction: project?.current_text_seq
          ? { kind: "current" as const, label: "Открыть diff handoff" }
          : null,
      },
      {
        key: "titles",
        title: "Титры",
        count: openActionCommentsByTarget.titles || 0,
        tone:
          (openActionCommentsByTarget.titles || 0) > 0 || titlesRequiresResync
            ? "warn"
            : titlesHasSource
              ? "fresh"
              : "muted",
        detail:
          (openActionCommentsByTarget.titles || 0) > 0
            ? `Открытых правок: ${openActionCommentsByTarget.titles || 0}.`
            : titlesHasSource
              ? "Открытых правок по титрам нет."
              : "Титры еще не брали текст в работу.",
        extra: titlesRequiresResync
          ? `Титры на ${formatTextSeq(project?.titles_text_seq)}, вычитанный текст уже ${formatTextSeq(project?.proofread_text_seq)}.`
          : `Источник титров: ${formatTextSeq(project?.titles_text_seq)}.`,
        diffAction: project?.proofread_text_seq
          ? { kind: "proofread" as const, label: "Открыть diff вычитки" }
          : null,
      },
      {
        key: "voiceover",
        title: "Озвучка",
        count: openActionCommentsByTarget.voiceover || 0,
        tone:
          (openActionCommentsByTarget.voiceover || 0) > 0 || voiceoverRequiresResync
            ? "warn"
            : voiceoverHasSource
              ? "fresh"
              : "muted",
        detail:
          (openActionCommentsByTarget.voiceover || 0) > 0
            ? `Открытых правок: ${openActionCommentsByTarget.voiceover || 0}.`
            : voiceoverHasSource
              ? "Открытых правок по озвучке нет."
              : "Озвучка еще не брала текст в работу.",
        extra: voiceoverRequiresResync
          ? `Озвучка на ${formatTextSeq(project?.voiceover_text_seq)}, вычитанный текст уже ${formatTextSeq(project?.proofread_text_seq)}.`
          : `Источник озвучки: ${formatTextSeq(project?.voiceover_text_seq)}.`,
        diffAction: project?.proofread_text_seq
          ? { kind: "proofread" as const, label: "Открыть diff вычитки" }
          : null,
      },
    ],
    [
      currentTextOutdated,
      editHasSource,
      editRequiresResync,
      hasCurrentText,
      openActionCommentsByTarget.edit,
      openActionCommentsByTarget.text,
      openActionCommentsByTarget.titles,
      openActionCommentsByTarget.voiceover,
      project?.current_text_seq,
      project?.edit_text_seq,
      project?.proofread_text_seq,
      project?.titles_text_seq,
      project?.voiceover_text_seq,
      proofreadOutdated,
      titlesHasSource,
      titlesRequiresResync,
      voiceoverHasSource,
      voiceoverRequiresResync,
    ]
  );

  useEffect(() => {
    if (!newCommentRequiresAction) {
      if (newCommentAssigneeUserId) {
        setNewCommentAssigneeUserId("");
      }
      return;
    }
    const defaultAssigneeId = defaultCommentAssigneeId(newCommentTargetKind, project);
    const hasCurrentCandidate = newCommentAssigneeCandidates.some(
      (item) => String(item.id) === newCommentAssigneeUserId
    );
    if (newCommentAssigneeUserId && hasCurrentCandidate) {
      return;
    }
    if (defaultAssigneeId) {
      const allowedDefault = newCommentAssigneeCandidates.find((item) => item.id === defaultAssigneeId);
      if (allowedDefault) {
        setNewCommentAssigneeUserId(String(defaultAssigneeId));
        return;
      }
    }
    if (newCommentAssigneeUserId) {
      setNewCommentAssigneeUserId("");
    }
  }, [
    newCommentAssigneeCandidates,
    newCommentAssigneeUserId,
    newCommentRequiresAction,
    newCommentTargetKind,
    project,
  ]);

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
        metaProofreaderUserId,
        metaTitlesAssigneeUserId,
        metaEditAssigneeUserId
      ),
    [
      metaAuthorUserId,
      metaEditAssigneeUserId,
      metaExecutorUserIds,
      metaProofreaderUserId,
      metaStatus,
      metaTitlesAssigneeUserId,
    ]
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

  useEffect(() => {
    if (!isEditorSaving) {
      setShowSavingIndicator(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowSavingIndicator(true);
    }, SAVE_INDICATOR_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isEditorSaving]);

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
    const normalized = normalizeTimecodeDisplayValue(rawValue);
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

  function getTimecodeFieldKey(
    rowIndex: number,
    bundleIndex: number,
    field: "tc_in" | "tc_out"
  ): string {
    return `${rowIndex}:${bundleIndex}:${field}`;
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
      const resolvedProject = payload.project || updatedProject;
      if (resolvedProject) {
        applyProjectMeta(resolvedProject);
      }
      setRows(persistedRows);
      lastSavedTableRef.current = createTableSignature(
        persistedRows,
        resolvedProject?.title || titleSnapshot,
        resolvedProject?.rubric || rubricSnapshot,
        resolvedProject?.planned_duration || durationSnapshot
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
        titles_assignee_user_id: assignmentEditable
          ? metaTitlesAssigneeUserId
            ? Number(metaTitlesAssigneeUserId)
            : null
          : undefined,
        edit_assignee_user_id: assignmentEditable
          ? metaEditAssigneeUserId
            ? Number(metaEditAssigneeUserId)
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
        response.project.proofreader_user_id ? String(response.project.proofreader_user_id) : "",
        response.project.titles_assignee_user_id
          ? String(response.project.titles_assignee_user_id)
          : "",
        response.project.edit_assignee_user_id ? String(response.project.edit_assignee_user_id) : ""
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

  async function handleProjectTextStateAction(
    action: "current" | "check" | "proofread"
  ): Promise<void> {
    if (!project) {
      return;
    }

    setTextStateAction(action);
    setError("");
    setSuccess("");

    try {
      const payload =
        action === "current"
          ? { text_seq: project.text_seq || null }
          : { text_seq: project.current_text_seq || null };
      const response =
        action === "current"
          ? await setProjectCurrentText(token, projectId, payload)
          : action === "check"
            ? await checkProjectCurrentText(token, projectId, payload)
            : await proofreadProjectCurrentText(token, projectId, payload);
      applyProjectMeta(response.project);
      await refreshHistorySection();
      setSuccess(response.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось обновить состояние текста"
      );
    } finally {
      setTextStateAction("");
    }
  }

  async function handleLoadTextStateDiff(
    snapshotKind: "current" | "checked" | "proofread"
  ): Promise<void> {
    setTextStateDiffLoading(true);
    setTextStateDiffKind(snapshotKind);
    setError("");
    try {
      const payload = await fetchProjectTextStateDiff(token, projectId, snapshotKind);
      setTextStateDiff(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить diff состояния текста"
      );
    } finally {
      setTextStateDiffLoading(false);
    }
  }

  async function handleSyncTitlesText(): Promise<void> {
    if (!project) {
      return;
    }

    setTitlesAction("sync");
    setError("");
    setSuccess("");

    try {
      const response = await syncProjectTitlesText(token, projectId, {
        text_seq: project.proofread_text_seq || null,
      });
      applyProjectMeta(response.project);
      await refreshHistorySection();
      setSuccess(response.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось синхронизировать титры с текстом"
      );
    } finally {
      setTitlesAction("");
    }
  }

  async function handleUpdateTitlesStatus(): Promise<void> {
    setTitlesAction("status");
    setError("");
    setSuccess("");

    try {
      const response = await updateProjectTitlesStatus(token, projectId, {
        status: titlesStatusDraft,
      });
      applyProjectMeta(response.project);
      await refreshHistorySection();
      setSuccess(response.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Не удалось обновить статус титров"
      );
    } finally {
      setTitlesAction("");
    }
  }

  async function handleSyncEditText(): Promise<void> {
    if (!project) {
      return;
    }

    setEditAction("sync");
    setError("");
    setSuccess("");

    try {
      const response = await syncProjectEditText(token, projectId, {
        text_seq: project.current_text_seq || null,
      });
      applyProjectMeta(response.project);
      await refreshHistorySection();
      setSuccess(response.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось синхронизировать монтаж с текстом"
      );
    } finally {
      setEditAction("");
    }
  }

  async function handleUpdateEditStatus(): Promise<void> {
    setEditAction("status");
    setError("");
    setSuccess("");

    try {
      const response = await updateProjectEditStatus(token, projectId, {
        status: editStatusDraft,
      });
      applyProjectMeta(response.project);
      await refreshHistorySection();
      setSuccess(response.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Не удалось обновить статус монтажа"
      );
    } finally {
      setEditAction("");
    }
  }

  async function handleSyncVoiceoverText(): Promise<void> {
    if (!project) {
      return;
    }

    setVoiceoverAction("sync");
    setError("");
    setSuccess("");

    try {
      const response = await syncProjectVoiceoverText(token, projectId, {
        text_seq: project.proofread_text_seq || null,
      });
      applyProjectMeta(response.project);
      await refreshHistorySection();
      setSuccess(response.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось синхронизировать озвучку с текстом"
      );
    } finally {
      setVoiceoverAction("");
    }
  }

  async function handleUpdateVoiceoverStatus(): Promise<void> {
    setVoiceoverAction("status");
    setError("");
    setSuccess("");

    try {
      const response = await updateProjectVoiceoverStatus(token, projectId, {
        status: voiceoverStatusDraft,
      });
      applyProjectMeta(response.project);
      await refreshHistorySection();
      setSuccess(response.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Не удалось обновить статус озвучки"
      );
    } finally {
      setVoiceoverAction("");
    }
  }

  async function handleUpdateFinalReviewStatus(): Promise<void> {
    setFinalReviewAction(true);
    setError("");
    setSuccess("");

    try {
      const response = await updateProjectFinalReviewStatus(token, projectId, {
        status: finalReviewStatusDraft,
      });
      applyProjectMeta(response.project);
      await refreshHistorySection();
      setSuccess(response.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось обновить статус внешней сдачи"
      );
    } finally {
      setFinalReviewAction(false);
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
    }, TABLE_AUTOSAVE_DELAY_MS);

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
    }, WORKFLOW_AUTOSAVE_DELAY_MS);

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
    }, WORKSPACE_AUTOSAVE_DELAY_MS);

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
      await addProjectComment(token, projectId, {
        text,
        target_kind: newCommentTargetKind,
        requires_action: newCommentRequiresAction,
        assignee_user_id:
          newCommentRequiresAction && newCommentAssigneeUserId
            ? Number(newCommentAssigneeUserId)
            : null,
      });
      setNewComment("");
      setNewCommentTargetKind("general");
      setNewCommentRequiresAction(false);
      setNewCommentAssigneeUserId("");
      setSuccess("Комментарий добавлен");
      await refreshWorkspaceSection();
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка добавления комментария"
      );
    } finally {
      setCommentSaving(false);
    }
  }

  async function handleCopyText(value: string, successMessage: string): Promise<void> {
    const text = value.trim();
    if (!text) {
      return;
    }
    setError("");
    setSuccess("");
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(successMessage);
    } catch (_error) {
      setError("Не удалось скопировать значение в буфер обмена");
    }
  }

  function handlePrepareActionComment(targetKind: string, templateText: string): void {
    setNewCommentTargetKind(targetKind);
    setNewCommentRequiresAction(true);
    setNewComment((previous) => (previous.trim() ? previous : templateText));
    commentComposerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDeleteComment(commentId: number): Promise<void> {
    setBusyCommentId(commentId);
    setError("");
    setSuccess("");
    try {
      const payload = await deleteProjectComment(token, projectId, commentId);
      setSuccess(payload.message);
      await refreshWorkspaceSection();
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка удаления комментария"
      );
    } finally {
      setBusyCommentId(null);
    }
  }

  async function handleResolveComment(commentId: number, isResolved: boolean): Promise<void> {
    setBusyCommentId(commentId);
    setCommentResolutionAction(isResolved ? "resolve" : "reopen");
    setError("");
    setSuccess("");
    try {
      await resolveProjectComment(token, projectId, commentId, isResolved);
      setSuccess(isResolved ? "Правка отмечена как выполненная" : "Правка возвращена в работу");
      await refreshWorkspaceSection();
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Ошибка изменения статуса правки"
      );
    } finally {
      setBusyCommentId(null);
      setCommentResolutionAction("");
    }
  }

  async function handleUpdateCommentWorkflow(
    commentId: number,
    payload: {
      assigneeUserId?: string;
      clearAssignee?: boolean;
      takenInWork?: boolean | null;
      successMessage: string;
      action: "assign" | "take" | "release";
    }
  ): Promise<void> {
    setBusyCommentId(commentId);
    setCommentWorkflowAction(payload.action);
    setError("");
    setSuccess("");
    try {
      await updateProjectCommentWorkflow(token, projectId, commentId, {
        assignee_user_id: payload.assigneeUserId ? Number(payload.assigneeUserId) : null,
        clear_assignee: Boolean(payload.clearAssignee),
        taken_in_work: payload.takenInWork ?? null,
      });
      setSuccess(payload.successMessage);
      await refreshWorkspaceSection();
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка обновления статуса правки"
      );
    } finally {
      setBusyCommentId(null);
      setCommentWorkflowAction("");
    }
  }

  function updateMaterialLinkDraft(
    linkId: number,
    field: "link_type" | "path" | "comment",
    value: string
  ): void {
    setMaterialLinks((previous) =>
      previous.map((item) => (item.id === linkId ? { ...item, [field]: value } : item))
    );
  }

  async function handleAddMaterialLink(): Promise<void> {
    const pathValue = newMaterialLinkPath.trim();
    if (!pathValue) {
      return;
    }
    setMaterialLinkAction("add");
    setError("");
    setSuccess("");
    try {
      await addProjectMaterialLink(token, projectId, {
        link_type: String(newMaterialLinkType || "other"),
        path: pathValue,
        comment: newMaterialLinkComment.trim(),
      });
      setNewMaterialLinkType("source_folder");
      setNewMaterialLinkPath("");
      setNewMaterialLinkComment("");
      setSuccess("Привязка материала добавлена");
      await refreshWorkspaceSection();
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка добавления привязки материала"
      );
    } finally {
      setMaterialLinkAction("");
    }
  }

  async function handleUpdateMaterialLink(linkId: number): Promise<void> {
    const currentItem = materialLinks.find((item) => item.id === linkId);
    if (!currentItem || !currentItem.path.trim()) {
      return;
    }
    setBusyMaterialLinkId(linkId);
    setMaterialLinkAction("update");
    setError("");
    setSuccess("");
    try {
      const payload = await updateProjectMaterialLink(token, projectId, linkId, {
        link_type: currentItem.link_type,
        path: currentItem.path.trim(),
        comment: currentItem.comment.trim(),
      });
      setMaterialLinks((previous) =>
        previous.map((item) => (item.id === linkId ? payload : item))
      );
      setSuccess("Привязка материала обновлена");
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка обновления привязки материала"
      );
    } finally {
      setBusyMaterialLinkId(null);
      setMaterialLinkAction("");
    }
  }

  async function handleDeleteMaterialLink(linkId: number): Promise<void> {
    setBusyMaterialLinkId(linkId);
    setMaterialLinkAction("delete");
    setError("");
    setSuccess("");
    try {
      const payload = await deleteProjectMaterialLink(token, projectId, linkId);
      setSuccess(payload.message);
      await refreshWorkspaceSection();
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка удаления привязки материала"
      );
    } finally {
      setBusyMaterialLinkId(null);
      setMaterialLinkAction("");
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
    if (showSavingIndicator) {
      return {
        tone: "saving",
        label: "Автосохранение...",
        detail: "Черновик синхронизируется без изменения текущего handoff.",
      };
    }
    if (hasPendingEditorChanges) {
      return {
        tone: "pending",
        label: "Черновик изменен",
        detail: "Автосохранение сохранит workspace, но не поменяет текущий текст.",
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
  }, [hasEditorSaveError, hasPendingEditorChanges, lastSuccessfulSaveAt, showSavingIndicator]);
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
  const textStateDiffGroups = useMemo(() => {
    const groups: Array<{ key: string; title: string; items: ProjectTextStateDiffRowItem[] }> = [
      { key: "added", title: revisionDiffSectionTitle("added"), items: [] },
      { key: "changed", title: revisionDiffSectionTitle("changed"), items: [] },
      { key: "moved", title: revisionDiffSectionTitle("moved"), items: [] },
      { key: "removed", title: revisionDiffSectionTitle("removed"), items: [] },
    ];
    if (!textStateDiff) {
      return groups;
    }
    for (const item of textStateDiff.row_changes) {
      const bucket = groups.find((group) => group.key === primaryTextStateChangeType(item));
      if (bucket) {
        bucket.items.push(item);
      }
    }
    return groups.filter((group) => group.items.length > 0);
  }, [textStateDiff]);

  useEffect(() => {
    clearTextStateDiff();
  }, [
    project?.id,
    project?.text_seq,
    project?.current_text_seq,
    project?.checked_text_seq,
    project?.proofread_text_seq,
  ]);

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
      <section className="editor-loading-panel">
        <p className="muted">Загрузка EDITOR...</p>
      </section>
    );
  }

  return (
    <section className={`editor-page-shell${reviewMode ? " editor-review-mode" : ""}`}>
      <section className="editor-hero">
        <div className="editor-hero-main">
          <button type="button" className="secondary editor-back-button" onClick={onBackToMain}>
            Назад в MAIN
          </button>
          <div>
            <p className="muted small">карточка сюжета</p>
            <h2>{project?.title || "Без названия"}</h2>
            <div className="project-text-state-badges">
              <span className="project-text-state-badge project-text-state-badge-muted">
                #{project?.id || "-"}
              </span>
              <span className="project-text-state-badge project-text-state-badge-muted">
                {statusLabel(project?.status)}
              </span>
              <span
                className={`project-text-state-badge ${
                  currentTextOutdated || proofreadOutdated
                    ? "project-text-state-badge-warn"
                    : "project-text-state-badge-fresh"
                }`}
              >
                {currentTextOutdated || proofreadOutdated ? "Текст изменился" : "Handoff стабилен"}
              </span>
            </div>
          </div>
        </div>

        <div className="editor-hero-status">
          <div className={`editor-save-status editor-save-status-${editorSaveStatus.tone}`}>
            <strong>{editorSaveStatus.label}</strong>
            <span>{editorSaveStatus.detail}</span>
          </div>
          <p className="muted small">
            Роль: <strong>{user.role}</strong>
          </p>
        </div>
      </section>

      <section className="editor-context-strip" aria-label="Контекст карточки сюжета">
        <div>
          <span className="muted small">Источник</span>
          <strong>{project?.source_project_id ? `#${project.source_project_id}` : "-"}</strong>
        </div>
        <div>
          <span className="muted small">Статус изменен</span>
          <strong>{formatDateTime(project?.status_changed_at)}</strong>
        </div>
        <div>
          <span className="muted small">Workspace</span>
          <strong>{formatTextSeq(project?.text_seq)}</strong>
        </div>
        <div>
          <span className="muted small">Current</span>
          <strong>{formatTextSeq(project?.current_text_seq)}</strong>
        </div>
        <div>
          <span className="muted small">Proofread</span>
          <strong>{formatTextSeq(project?.proofread_text_seq)}</strong>
        </div>
      </section>

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
      {!rowsEditable ? <p className="muted">{rowEditRestrictionMessage(user.role, projectStatus)}</p> : null}

      <div className="card editor-text-state-card">
        <div className="row between wrap editor-section-head">
          <div>
            <h3>Состояние текста</h3>
            <p className="muted">
              Workspace: <strong>{formatTextSeq(project?.text_seq)}</strong> | Текущий handoff:{" "}
              <strong>{formatTextSeq(project?.current_text_seq)}</strong>
            </p>
          </div>
          <div className="row wrap">
            <button
              type="button"
              className="secondary"
              disabled={
                !canSetCurrentTextState ||
                !hasLatestText ||
                Boolean(project?.current_text_is_latest) ||
                textStateAction !== ""
              }
              onClick={() => void handleProjectTextStateAction("current")}
            >
              {textStateAction === "current"
                ? "Назначение..."
                : `Сделать текущим ${formatTextSeq(project?.text_seq)}`}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={
                !canCheckCurrentTextState ||
                !hasCurrentText ||
                Boolean(project?.checked_text_is_current) ||
                textStateAction !== ""
              }
              onClick={() => void handleProjectTextStateAction("check")}
            >
              {textStateAction === "check" ? "Отметка..." : "Проверено"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={
                !canProofreadCurrentTextState ||
                !hasCurrentText ||
                Boolean(project?.proofread_text_is_current) ||
                textStateAction !== ""
              }
              onClick={() => void handleProjectTextStateAction("proofread")}
            >
              {textStateAction === "proofread" ? "Отметка..." : "Вычитано"}
            </button>
          </div>
        </div>

        <div className="editor-text-state-grid">
          <div className="project-summary">
            <p className="muted">Последняя сохраненная версия текста</p>
            <p>
              <strong>{formatTextSeq(project?.text_seq)}</strong>
            </p>
            <p className="muted">
              {project?.current_text_is_latest
                ? "Текущий текст совпадает с последними правками."
                : "В workspace есть более новые правки, чем текущий handoff."}
            </p>
          </div>

          <div className="project-summary">
            <p className="muted">Текущая версия для handoff</p>
            <p>
              <strong>{formatTextSeq(project?.current_text_seq)}</strong>
            </p>
            <p className="muted">
              Назначено: <strong>{formatDateTime(project?.current_text_set_at)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.current_text_seq),
                currentTextOutdated
              )}`}
            >
              {textStateLabel(Boolean(project?.current_text_seq), currentTextOutdated, "Актуально")}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Проверка</p>
            <p>
              <strong>{formatTextSeq(project?.checked_text_seq)}</strong>
            </p>
            <p className="muted">
              Отметка: <strong>{formatDateTime(project?.checked_at)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.checked_text_seq),
                checkedOutdated
              )}`}
            >
              {textStateLabel(Boolean(project?.checked_text_seq), checkedOutdated, "Проверено")}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Корректура</p>
            <p>
              <strong>{formatTextSeq(project?.proofread_text_seq)}</strong>
            </p>
            <p className="muted">
              Отметка: <strong>{formatDateTime(project?.proofread_at)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.proofread_text_seq),
                proofreadOutdated
              )}`}
            >
              {textStateLabel(Boolean(project?.proofread_text_seq), proofreadOutdated, "Вычитано")}
            </span>
          </div>
        </div>

        {currentTextOutdated ? (
          <p className="editor-text-state-alert">
            После назначения текущей версии появились новые правки в workspace: сейчас последняя
            версия {formatTextSeq(project?.text_seq)}, а текущая для handoff{" "}
            {formatTextSeq(project?.current_text_seq)}.
          </p>
        ) : null}
        {proofreadOutdated ? (
          <p className="editor-text-state-alert">
            После корректуры текст менялся. Для титров и downstream нужно заново проверить
            актуальность текста.
          </p>
        ) : null}
        {currentTextOutdated || checkedOutdated || proofreadOutdated ? (
          <div className="row wrap">
            {currentTextOutdated ? (
              <button
                type="button"
                className="secondary"
                disabled={textStateDiffLoading}
                onClick={() => void handleLoadTextStateDiff("current")}
              >
                {textStateDiffLoading && textStateDiffKind === "current"
                  ? "Сравнение..."
                  : "Что изменилось после current"}
              </button>
            ) : null}
            {checkedOutdated ? (
              <button
                type="button"
                className="secondary"
                disabled={textStateDiffLoading}
                onClick={() => void handleLoadTextStateDiff("checked")}
              >
                {textStateDiffLoading && textStateDiffKind === "checked"
                  ? "Сравнение..."
                  : "Что изменилось после проверки"}
              </button>
            ) : null}
            {proofreadOutdated ? (
              <button
                type="button"
                className="secondary"
                disabled={textStateDiffLoading}
                onClick={() => void handleLoadTextStateDiff("proofread")}
              >
                {textStateDiffLoading && textStateDiffKind === "proofread"
                  ? "Сравнение..."
                  : "Что изменилось после корректуры"}
              </button>
            ) : null}
          </div>
        ) : null}
        {textStateDiff ? (
          <div className="text-state-diff-card">
            <div className="row between wrap">
              <div>
                <strong>Diff: {textSnapshotKindLabel(textStateDiff.snapshot_kind)}</strong>
                <p className="muted">
                  Снимок {formatTextSeq(textStateDiff.snapshot_text_seq)} против workspace{" "}
                  {formatTextSeq(textStateDiff.workspace_text_seq)}
                </p>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={clearTextStateDiff}
              >
                Скрыть diff
              </button>
            </div>

            <div className="text-state-diff-summary">
              <span>Всего: {textStateDiff.summary.total}</span>
              <span>Изменено: {textStateDiff.summary.changed}</span>
              <span>Добавлено: {textStateDiff.summary.added}</span>
              <span>Удалено: {textStateDiff.summary.removed}</span>
              <span>Перемещено: {textStateDiff.summary.moved}</span>
            </div>

            {textStateDiff.header_changes.length > 0 ? (
              <div className="revision-diff-section">
                <h5>Шапка</h5>
                {textStateDiff.header_changes.map((item) => (
                  <div key={`${textStateDiff.snapshot_kind}-${item.field}`} className="revision-diff-item">
                    <p>
                      <strong>{revisionDiffFieldLabel(item.field)}</strong>
                    </p>
                    <div className="revision-diff-compare-grid">
                      <div className="revision-diff-compare-cell revision-diff-compare-cell-before">
                        <span className="revision-diff-compare-label">Было</span>
                        <div className="revision-diff-compare-value">{item.before || "-"}</div>
                      </div>
                      <div className="revision-diff-compare-cell revision-diff-compare-cell-after">
                        <span className="revision-diff-compare-label">Стало</span>
                        <div className="revision-diff-compare-value">{item.after || "-"}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="revision-diff-section">
              <h5>Строки</h5>
              {textStateDiff.row_changes.length === 0 ? (
                <p className="muted">Различий по строкам нет</p>
              ) : (
                textStateDiffGroups.map((group) => (
                  <div key={`text-state-${group.key}`} className="revision-diff-group">
                    <h6>
                      {group.title} <span className="muted">({group.items.length})</span>
                    </h6>
                    <div className="revision-diff-group-list">
                      {group.items.map((item) => (
                        <div
                          key={`${textStateDiff.snapshot_kind}:${item.segment_uid}`}
                          className="revision-diff-item"
                        >
                          <div className="revision-diff-item-head">
                            <strong>{textStateDiffRowTitle(item)}</strong>
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
        ) : null}
      </div>

      <div className="card editor-text-state-card">
        <div className="row between wrap editor-section-head">
          <div>
            <h3>Озвучка</h3>
            <p className="muted">
              Текущий источник озвучки: <strong>{formatTextSeq(project?.voiceover_text_seq)}</strong> | Статус:{" "}
              <strong>{voiceoverStatusLabel(project?.voiceover_status)}</strong>
            </p>
          </div>
          <div className="row wrap">
            <button
              type="button"
              className="secondary"
              disabled={!canManageVoiceoverState || !voiceoverCanSync || voiceoverAction !== ""}
              onClick={() => void handleSyncVoiceoverText()}
            >
              {voiceoverAction === "sync"
                ? "Синхронизация..."
                : voiceoverHasSource
                  ? "Обновить текст для озвучки"
                  : "Взять вычитанный текст в озвучку"}
            </button>
            <select
              value={voiceoverStatusDraft}
              disabled={!canManageVoiceoverState || voiceoverAction !== ""}
              onChange={(event) => setVoiceoverStatusDraft(event.target.value as VoiceoverStatusValue)}
            >
              {VOICEOVER_STATUS_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary"
              disabled={
                !canManageVoiceoverState ||
                voiceoverAction !== "" ||
                String(voiceoverStatusDraft) === voiceoverStatus
              }
              onClick={() => void handleUpdateVoiceoverStatus()}
            >
              {voiceoverAction === "status" ? "Сохранение..." : "Обновить статус озвучки"}
            </button>
          </div>
        </div>

        <div className="editor-text-state-grid">
          <div className="project-summary">
            <p className="muted">Статус озвучки</p>
            <p>
              <strong>{voiceoverStatusLabel(project?.voiceover_status)}</strong>
            </p>
            <p className="muted">
              Последнее обновление: <strong>{formatDateTime(project?.voiceover_updated_at)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${voiceoverStatusTone(
                project?.voiceover_status,
                voiceoverRequiresResync
              )}`}
            >
              {voiceoverRequiresResync
                ? "Нужна пересинхронизация"
                : voiceoverStatusLabel(project?.voiceover_status)}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Текст, по которому делается озвучка</p>
            <p>
              <strong>{formatTextSeq(project?.voiceover_text_seq)}</strong>
            </p>
            <p className="muted">
              Последний вычитанный текст: <strong>{formatTextSeq(project?.proofread_text_seq)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.voiceover_text_seq),
                voiceoverRequiresResync
              )}`}
            >
              {textStateLabel(
                Boolean(project?.voiceover_text_seq),
                voiceoverRequiresResync,
                "Источник актуален"
              )}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Связь с корректурой</p>
            <p>
              <strong>
                voice {formatTextSeq(project?.voiceover_text_seq)} · proofread{" "}
                {formatTextSeq(project?.proofread_text_seq)}
              </strong>
            </p>
            <p className="muted">Озвучка синхронизируется только с текущим вычитанным текстом.</p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.voiceover_text_seq),
                !Boolean(project?.voiceover_text_is_proofread)
              )}`}
            >
              {project?.voiceover_text_seq
                ? project?.voiceover_text_is_proofread
                  ? "Привязано к proofread"
                  : "Озвучка на старом тексте"
                : "Источник еще не выбран"}
            </span>
          </div>
        </div>

        {!voiceoverCanSync ? (
          <p className="editor-text-state-alert">
            Озвучку можно синхронизировать только после того, как последняя версия текста вычитана.
          </p>
        ) : null}
        {voiceoverRequiresResync ? (
          <p className="editor-text-state-alert">
            После последней синхронизации озвучки текст изменился: озвучка сейчас на{" "}
            {formatTextSeq(project?.voiceover_text_seq)}, а workspace уже на {formatTextSeq(project?.text_seq)}.
          </p>
        ) : null}
      </div>

      <div className="card editor-text-state-card">
        <div className="row between wrap editor-section-head">
          <div>
            <h3>Монтаж</h3>
            <p className="muted">
              Текущий источник монтажа: <strong>{formatTextSeq(project?.edit_text_seq)}</strong> | Статус:{" "}
              <strong>{editStatusLabel(project?.edit_status)}</strong>
            </p>
            <p className="muted">
              Ответственный за монтаж: <strong>{editAssigneeName}</strong>
            </p>
          </div>
          <div className="row wrap">
            <button
              type="button"
              className="secondary"
              disabled={!canManageEditState || !editCanSync || editAction !== ""}
              onClick={() => void handleSyncEditText()}
            >
              {editAction === "sync"
                ? "Синхронизация..."
                : editHasSource
                  ? "Обновить текст для монтажа"
                  : "Взять current в монтаж"}
            </button>
            <select
              value={editStatusDraft}
              disabled={!canManageEditState || editAction !== ""}
              onChange={(event) => setEditStatusDraft(event.target.value as EditStatusValue)}
            >
              {EDIT_STATUS_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary"
              disabled={!canManageEditState || editAction !== "" || String(editStatusDraft) === editStatus}
              onClick={() => void handleUpdateEditStatus()}
            >
              {editAction === "status" ? "Сохранение..." : "Обновить статус монтажа"}
            </button>
          </div>
        </div>

        <div className="editor-text-state-grid">
          <div className="project-summary">
            <p className="muted">Статус монтажа</p>
            <p>
              <strong>{editStatusLabel(project?.edit_status)}</strong>
            </p>
            <p className="muted">
              Последнее обновление: <strong>{formatDateTime(project?.edit_updated_at)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${editStatusTone(
                project?.edit_status,
                editRequiresResync
              )}`}
            >
              {editRequiresResync ? "Нужна пересинхронизация" : editStatusLabel(project?.edit_status)}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Текст, по которому делается монтаж</p>
            <p>
              <strong>{formatTextSeq(project?.edit_text_seq)}</strong>
            </p>
            <p className="muted">
              Текущий handoff: <strong>{formatTextSeq(project?.current_text_seq)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.edit_text_seq),
                editRequiresResync
              )}`}
            >
              {textStateLabel(Boolean(project?.edit_text_seq), editRequiresResync, "Источник актуален")}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Связь с current</p>
            <p>
              <strong>
                montage {formatTextSeq(project?.edit_text_seq)} · current{" "}
                {formatTextSeq(project?.current_text_seq)}
              </strong>
            </p>
            <p className="muted">Монтаж синхронизируется с handoff, а не с каждым autosave.</p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.edit_text_seq),
                !Boolean(project?.edit_text_is_current)
              )}`}
            >
              {project?.edit_text_seq
                ? project?.edit_text_is_current
                  ? "Привязано к current"
                  : "Монтаж на старом handoff"
                : "Источник еще не выбран"}
            </span>
          </div>
        </div>

        {!editCanSync ? (
          <p className="editor-text-state-alert">
            Для монтажа пока нет handoff текста. Сначала назначьте текущую версию текста.
          </p>
        ) : null}
        {editRequiresResync ? (
          <div className="editor-text-state-alert">
            <p>
              После последней синхронизации монтажа handoff текста изменился: монтаж сейчас на{" "}
              {formatTextSeq(project?.edit_text_seq)}, а текущий текст уже {formatTextSeq(project?.current_text_seq)}.
            </p>
            <div className="row wrap">
              <button
                type="button"
                className="secondary"
                disabled={textStateDiffLoading}
                onClick={() => void handleLoadTextStateDiff("current")}
              >
                {textStateDiffLoading && textStateDiffKind === "current"
                  ? "Открываю diff..."
                  : "Открыть diff handoff"}
              </button>
              {isCurrentUserEditAssignee ? (
                <span className="text-state-chip text-state-chip-warn">Это ждет вашего действия</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="card editor-text-state-card">
        <div className="row between wrap editor-section-head">
          <div>
            <h3>Титры</h3>
            <p className="muted">
              Текущий источник титров: <strong>{formatTextSeq(project?.titles_text_seq)}</strong> | Статус:{" "}
              <strong>{titlesStatusLabel(project?.titles_status)}</strong>
            </p>
            <p className="muted">
              Ответственный за титры: <strong>{titlesAssigneeName}</strong>
            </p>
          </div>
          <div className="row wrap">
            <button
              type="button"
              className="secondary"
              disabled={!canManageTitlesState || !titlesCanSync || titlesAction !== ""}
              onClick={() => void handleSyncTitlesText()}
            >
              {titlesAction === "sync"
                ? "Синхронизация..."
                : titlesHasSource
                  ? "Обновить текст для титров"
                  : "Взять вычитанный текст в титры"}
            </button>
            <select
              value={titlesStatusDraft}
              disabled={!canManageTitlesState || titlesAction !== ""}
              onChange={(event) => setTitlesStatusDraft(event.target.value as TitlesStatusValue)}
            >
              {TITLES_STATUS_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary"
              disabled={
                !canManageTitlesState || titlesAction !== "" || String(titlesStatusDraft) === titlesStatus
              }
              onClick={() => void handleUpdateTitlesStatus()}
            >
              {titlesAction === "status" ? "Сохранение..." : "Обновить статус титров"}
            </button>
          </div>
        </div>

        <div className="editor-text-state-grid">
          <div className="project-summary">
            <p className="muted">Статус титров</p>
            <p>
              <strong>{titlesStatusLabel(project?.titles_status)}</strong>
            </p>
            <p className="muted">
              Последнее обновление: <strong>{formatDateTime(project?.titles_updated_at)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${titlesStatusTone(
                project?.titles_status,
                titlesRequiresResync
              )}`}
            >
              {titlesRequiresResync
                ? "Нужна пересинхронизация"
                : titlesStatusLabel(project?.titles_status)}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Текст, по которому делаются титры</p>
            <p>
              <strong>{formatTextSeq(project?.titles_text_seq)}</strong>
            </p>
            <p className="muted">
              Последний текст в workspace: <strong>{formatTextSeq(project?.text_seq)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.titles_text_seq),
                titlesRequiresResync
              )}`}
            >
              {textStateLabel(Boolean(project?.titles_text_seq), titlesRequiresResync, "Источник актуален")}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Связь с handoff и корректурой</p>
            <p>
              <strong>
                current {formatTextSeq(project?.current_text_seq)} · proofread{" "}
                {formatTextSeq(project?.proofread_text_seq)}
              </strong>
            </p>
            <p className="muted">
              Для безопасной синхронизации нужен последний текущий вычитанный текст.
            </p>
            <span
              className={`text-state-chip text-state-chip-${textStateTone(
                Boolean(project?.titles_text_seq),
                !Boolean(project?.titles_text_is_current) || !Boolean(project?.titles_text_is_proofread)
              )}`}
            >
              {project?.titles_text_seq
                ? project?.titles_text_is_current && project?.titles_text_is_proofread
                  ? "Привязано к current + proofread"
                  : "Связь с current/proofread устарела"
                : "Источник еще не выбран"}
            </span>
          </div>
        </div>

        {!titlesCanSync ? (
          <p className="editor-text-state-alert">
            Титры можно синхронизировать только после того, как последняя версия текста назначена
            текущей и вычитана корректором.
          </p>
        ) : null}
        {titlesRequiresResync ? (
          <div className="editor-text-state-alert">
            <p>
              После последней синхронизации титров текст изменился: титры сейчас на{" "}
              {formatTextSeq(project?.titles_text_seq)}, а workspace уже на {formatTextSeq(project?.text_seq)}.
              Перед финальной сдачей дизайнеру нужно открыть diff текста и пересинхронизировать титры
              по новой вычитанной версии.
            </p>
            <div className="row wrap">
              <button
                type="button"
                className="secondary"
                disabled={textStateDiffLoading}
                onClick={() => void handleLoadTextStateDiff("proofread")}
              >
                {textStateDiffLoading && textStateDiffKind === "proofread"
                  ? "Открываю diff..."
                  : "Открыть diff вычитки"}
              </button>
              {isCurrentUserTitlesAssignee ? (
                <span className="text-state-chip text-state-chip-warn">Это ждет вашего действия</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="card editor-text-state-card">
        <div className="row between wrap editor-section-head">
          <div>
            <h3>Внешняя Сдача</h3>
            <p className="muted">
              Статус отправки руководству: <strong>{finalReviewStatusLabel(project?.final_review_status)}</strong>
            </p>
          </div>
          <div className="row wrap">
            <select
              value={finalReviewStatusDraft}
              disabled={!canManageFinalReviewState || finalReviewAction}
              onChange={(event) => setFinalReviewStatusDraft(event.target.value as FinalReviewStatusValue)}
            >
              {FINAL_REVIEW_STATUS_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondary"
              disabled={
                !canManageFinalReviewState ||
                finalReviewAction ||
                String(finalReviewStatusDraft) === finalReviewStatus
              }
              onClick={() => void handleUpdateFinalReviewStatus()}
            >
              {finalReviewAction ? "Сохранение..." : "Обновить статус сдачи"}
            </button>
          </div>
        </div>

        <div className="editor-text-state-grid">
          <div className="project-summary">
            <p className="muted">Состояние внешней сдачи</p>
            <p>
              <strong>{finalReviewStatusLabel(project?.final_review_status)}</strong>
            </p>
            <p className="muted">
              Последнее обновление: <strong>{formatDateTime(project?.final_review_updated_at)}</strong>
            </p>
            <span
              className={`text-state-chip text-state-chip-${finalReviewStatusTone(
                project?.final_review_status
              )}`}
            >
              {finalReviewStatusLabel(project?.final_review_status)}
            </span>
          </div>

          <div className="project-summary">
            <p className="muted">Как это трактуется</p>
            <p>
              <strong>
                {finalReviewStatus === "submitted"
                  ? "Проект ушел наверх"
                  : finalReviewStatus === "changes_requested"
                    ? "Вернулся с правками"
                    : finalReviewStatus === "approved"
                      ? "Утвержден для сдачи"
                      : "Еще не отправлялся"}
              </strong>
            </p>
            <p className="muted">
              Правки сверху пока фиксируются через комментарии и события проекта.
            </p>
            {finalReviewStatus === "changes_requested" ? (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  handlePrepareActionComment(
                    "final_review",
                    "Правка сверху: перечислить замечания руководства по тексту, монтажу, титрам или материалам"
                  )
                }
              >
                Поставить правку по внешней сдаче
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="editor-workflow-board" aria-label="Рабочие панели карточки сюжета">
        <div ref={commentComposerRef} className="editor-workflow-panel editor-comments-card">
          <h3>Комментарии проекта</h3>
          <div className="workspace-column workspace-column-plain">
            <div className="project-summary">
              <p className="muted">Открытые правки по комментариям</p>
              <p>
                Всего открытых: <strong>{openActionComments.length}</strong>
              </p>
              <p className="muted">
                Текст {openActionCommentsByTarget.text || 0} · Монтаж {openActionCommentsByTarget.edit || 0}
                {" "}· Титры {openActionCommentsByTarget.titles || 0} · Озвучка{" "}
                {openActionCommentsByTarget.voiceover || 0}
              </p>
              <span
                className={`text-state-chip text-state-chip-${
                  myOpenActionComments.length > 0 ? "warn" : "fresh"
                }`}
              >
                {myOpenActionComments.length > 0
                  ? `На вас сейчас ${myOpenActionComments.length} открытых правок`
                  : "На вас открытых правок нет"}
              </span>
            </div>
            <div className="comment-track-grid">
              {actionTrackCards.map((item) => (
                <div
                  key={item.key}
                  className={`comment-track-card comment-track-card-${item.tone}`}
                >
                  <span className="comment-track-card-title">{item.title}</span>
                  <strong>{item.count}</strong>
                  <span>{item.detail}</span>
                  <span className="muted small">{item.extra}</span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      handlePrepareActionComment(
                        item.key,
                        item.key === "edit"
                          ? "Монтаж: 00:00:00-00:00:00 описать, какие кадры убрать, заменить или добавить"
                          : item.key === "titles"
                            ? "Титры: описать, что именно нужно поправить в титрах или субтитрах"
                            : item.key === "voiceover"
                              ? "Озвучка: описать, что именно нужно поправить в дикторском тексте или файле"
                              : "Текст: описать, какие фразы, слова или знаки нужно изменить"
                      )
                    }
                  >
                    Поставить правку
                  </button>
                  {item.diffAction ? (
                    <button
                      type="button"
                      className="secondary"
                      disabled={textStateDiffLoading}
                      onClick={() => void handleLoadTextStateDiff(item.diffAction.kind)}
                    >
                      {textStateDiffLoading && textStateDiffKind === item.diffAction.kind
                        ? "Открываю diff..."
                        : item.diffAction.label}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="row controls">
              <div className="workspace-comment-form">
                <label>
                  Тип комментария
                  <select
                    value={newCommentTargetKind}
                    disabled={!rowsEditable || commentSaving}
                    onChange={(event) => setNewCommentTargetKind(event.target.value)}
                  >
                    {COMMENT_TARGET_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="workspace-comment-checkbox">
                  <input
                    type="checkbox"
                    checked={newCommentRequiresAction}
                    disabled={!rowsEditable || commentSaving}
                    onChange={(event) => setNewCommentRequiresAction(event.target.checked)}
                  />
                  Это правка, требующая действия
                </label>
                {newCommentRequiresAction ? (
                  <label>
                    Исполнитель
                    <select
                      value={newCommentAssigneeUserId}
                      disabled={!rowsEditable || commentSaving}
                      onChange={(event) => setNewCommentAssigneeUserId(event.target.value)}
                    >
                      <option value="">Не назначен</option>
                      {newCommentAssigneeCandidates.map((item) => (
                        <option key={item.id} value={String(item.id)}>
                          {userDisplayName(item)} [{item.role}]
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <AutoSizeTextarea
                  className="workspace-comment-input"
                  value={newComment}
                  disabled={!rowsEditable || commentSaving}
                  onChange={(event) => setNewComment(event.target.value)}
                  minHeight={84}
                  placeholder="Например: Монтаж, 00:00:18-00:00:24 заменить кадры на общий план"
                />
              </div>
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
              {comments.map((item) => {
                const diffAction = preferredDiffActionForComment(item, project);
                const freshness = commentTextFreshness(item, project);
                const commentTextOutdated =
                  item.requires_action && !item.is_resolved && freshness.isOutdated;
                const workflowStatus = commentWorkflowStatus(item);
                const assignableUsers = commentAssignableUsers(item.target_kind, users);
                const editorLikeRole = isEditorLikeRole(user.role);
                const canTakeInWork =
                  item.requires_action &&
                  !item.is_resolved &&
                  (!item.assignee_user_id || item.assignee_user_id === user.id || editorLikeRole);
                const canReleaseFromWork =
                  item.requires_action &&
                  !item.is_resolved &&
                  Boolean(item.taken_in_work_at) &&
                  (item.taken_in_work_by_user_id === user.id || editorLikeRole);
                const canResolve =
                  item.requires_action &&
                  !item.is_resolved &&
                  (!item.assignee_user_id || item.assignee_user_id === user.id || editorLikeRole);
                const canReopen =
                  item.requires_action &&
                  item.is_resolved &&
                  (!item.assignee_user_id || item.assignee_user_id === user.id || editorLikeRole);
                return (
                  <div key={item.id} className="workspace-item">
                    <p>
                      <strong>{item.author_username}</strong> · {formatDateTime(item.created_at)}
                    </p>
                    <div className="project-text-state-badges">
                      <span className="project-text-state-badge project-text-state-badge-muted">
                        {commentTargetLabel(item.target_kind)}
                      </span>
                      {item.requires_action ? (
                        <span
                          className={`project-text-state-badge ${
                            workflowStatus === "resolved"
                              ? "project-text-state-badge-fresh"
                              : workflowStatus === "in_progress"
                                ? "project-text-state-badge-muted"
                              : "project-text-state-badge-warn"
                          }`}
                        >
                          {commentWorkflowStatusLabel(item)}
                        </span>
                      ) : null}
                    </div>
                    {item.requires_action ? (
                      <div className="comment-workflow-lane">
                        <span
                          className={`comment-workflow-step ${
                            workflowStatus === "open"
                              ? "comment-workflow-step-active"
                              : workflowStatus === "in_progress" || workflowStatus === "resolved"
                                ? "comment-workflow-step-done"
                                : "comment-workflow-step-todo"
                          }`}
                        >
                          1. Open
                        </span>
                        <span
                          className={`comment-workflow-step ${
                            workflowStatus === "in_progress"
                              ? "comment-workflow-step-active"
                              : workflowStatus === "resolved"
                                ? "comment-workflow-step-done"
                                : "comment-workflow-step-todo"
                          }`}
                        >
                          2. In progress
                        </span>
                        <span
                          className={`comment-workflow-step ${
                            workflowStatus === "resolved"
                              ? "comment-workflow-step-active"
                              : "comment-workflow-step-todo"
                          }`}
                        >
                          3. Resolved
                        </span>
                      </div>
                    ) : null}
                    {item.requires_action ? (
                      <p className="comment-workflow-hint">{commentWorkflowHint(item)}</p>
                    ) : null}
                    <p>{item.text}</p>
                    {item.requires_action ? (
                      <p className="muted">
                        Исполнитель: <strong>{item.assignee_username || "не назначен"}</strong>
                      </p>
                    ) : null}
                    {item.taken_in_work_at ? (
                      <p className="muted">
                        В работе у: <strong>{item.taken_in_work_by_username || "-"}</strong> ·{" "}
                        {formatDateTime(item.taken_in_work_at)}
                      </p>
                    ) : null}
                    {commentSnapshotLabel(item.created_text_snapshot_kind, item.created_text_seq) ? (
                      <p className="muted">
                        Поставлена на:{" "}
                        <strong>
                          {commentSnapshotLabel(item.created_text_snapshot_kind, item.created_text_seq)}
                        </strong>
                      </p>
                    ) : null}
                    {commentRevisionLabel(item.created_revision_no) ? (
                      <p className="muted">
                        Версия при постановке: <strong>{commentRevisionLabel(item.created_revision_no)}</strong>
                      </p>
                    ) : null}
                    {commentTextOutdated ? (
                      <div className="comment-outdated-alert">
                        <p>
                          Текст изменился после постановки задачи:{" "}
                          <strong>{formatTextSeq(freshness.fromSeq)}</strong> {"->"}{" "}
                          <strong>{formatTextSeq(freshness.toSeq)}</strong> ({freshness.basisLabel}).
                        </p>
                        <p>{commentOutdatedHint(item.target_kind)}</p>
                      </div>
                    ) : null}
                    {item.requires_action && item.is_resolved ? (
                      <p className="muted">Закрыта: {formatDateTime(item.resolved_at)}</p>
                    ) : null}
                    {item.is_resolved &&
                    commentSnapshotLabel(item.resolved_text_snapshot_kind, item.resolved_text_seq) ? (
                      <p className="muted">
                        Закрыта на:{" "}
                        <strong>
                          {commentSnapshotLabel(item.resolved_text_snapshot_kind, item.resolved_text_seq)}
                        </strong>
                      </p>
                    ) : null}
                    {item.is_resolved && commentRevisionLabel(item.resolved_revision_no) ? (
                      <p className="muted">
                        Версия при закрытии: <strong>{commentRevisionLabel(item.resolved_revision_no)}</strong>
                      </p>
                    ) : null}
                    {commentRelatedHistoryById[item.id]?.length ? (
                      <div className="comment-related-history">
                        <p className="muted small">Связанные события после комментария</p>
                        <div className="comment-related-history-list">
                          {commentRelatedHistoryById[item.id].map((historyItem) => (
                            <div key={`${item.id}-${historyItem.id}`} className="comment-related-history-item">
                              <div className="project-text-state-badges">
                                <span className="project-text-state-badge project-text-state-badge-muted">
                                  {commentTargetLabel(historyEventTargetKind(historyItem))}
                                </span>
                                <span className="project-text-state-badge project-text-state-badge-fresh">
                                  {eventTypeLabel(historyItem.event_type)}
                                </span>
                              </div>
                              <p>
                                {historyEventDetail(historyItem)} · {historyItem.actor_username} ·{" "}
                                {formatDateTime(historyItem.created_at)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="row controls wrap comment-workflow-controls">
                      {item.requires_action ? (
                        <label>
                          Исполнитель
                          <select
                            value={item.assignee_user_id ? String(item.assignee_user_id) : ""}
                            disabled={!rowsEditable || busyCommentId === item.id}
                            onChange={(event) =>
                              void handleUpdateCommentWorkflow(item.id, {
                                assigneeUserId: event.target.value,
                                clearAssignee: !event.target.value,
                                successMessage: event.target.value
                                  ? "Исполнитель правки обновлен"
                                  : "Исполнитель правки снят",
                                action: "assign",
                              })
                            }
                          >
                            <option value="">Не назначен</option>
                            {assignableUsers.map((candidate) => (
                              <option key={candidate.id} value={String(candidate.id)}>
                                {userDisplayName(candidate)} [{candidate.role}]
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {item.created_revision_id ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={revisionAction !== null && busyRevisionId !== item.created_revision_id}
                          onClick={() => void handleOpenRevision(item.created_revision_id || "")}
                        >
                          {busyRevisionId === item.created_revision_id && revisionAction === "open"
                            ? "Открываю версию..."
                            : `Открыть ${commentRevisionLabel(item.created_revision_no) || "revision"} постановки`}
                        </button>
                      ) : null}
                      {item.is_resolved && item.resolved_revision_id ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={revisionAction !== null && busyRevisionId !== item.resolved_revision_id}
                          onClick={() => void handleOpenRevision(item.resolved_revision_id || "")}
                        >
                          {busyRevisionId === item.resolved_revision_id && revisionAction === "open"
                            ? "Открываю версию..."
                            : `Открыть ${commentRevisionLabel(item.resolved_revision_no) || "revision"} закрытия`}
                        </button>
                      ) : null}
                      {diffAction ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={textStateDiffLoading}
                          onClick={() => void handleLoadTextStateDiff(diffAction.kind)}
                        >
                          {textStateDiffLoading && textStateDiffKind === diffAction.kind
                            ? "Открываю diff..."
                            : commentTextOutdated
                              ? "Что изменилось после постановки"
                              : diffAction.label}
                        </button>
                      ) : null}
                      {item.requires_action && !item.is_resolved && canTakeInWork && !item.taken_in_work_at ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={!rowsEditable || busyCommentId === item.id}
                          onClick={() =>
                            void handleUpdateCommentWorkflow(item.id, {
                              takenInWork: true,
                              successMessage: "Правка взята в работу",
                              action: "take",
                            })
                          }
                        >
                          {busyCommentId === item.id && commentWorkflowAction === "take"
                            ? "Беру..."
                            : "1. Взять в работу"}
                        </button>
                      ) : null}
                      {item.requires_action && !item.is_resolved && canReleaseFromWork ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={!rowsEditable || busyCommentId === item.id}
                          onClick={() =>
                            void handleUpdateCommentWorkflow(item.id, {
                              takenInWork: false,
                              successMessage: "Правка возвращена в очередь",
                              action: "release",
                            })
                          }
                        >
                          {busyCommentId === item.id && commentWorkflowAction === "release"
                            ? "Возвращаю..."
                            : "Вернуть в Open"}
                        </button>
                      ) : null}
                      {item.requires_action && (canResolve || canReopen) ? (
                        <button
                          type="button"
                          className="secondary"
                          disabled={!rowsEditable || busyCommentId === item.id}
                          onClick={() => void handleResolveComment(item.id, !item.is_resolved)}
                        >
                          {busyCommentId === item.id
                            ? commentResolutionAction === "reopen"
                              ? "Возвращаю..."
                              : "Закрываю..."
                            : item.is_resolved
                              ? "Переоткрыть задачу"
                              : "3. Закрыть задачу"}
                        </button>
                      ) : null}
                      {item.requires_action && !item.is_resolved && !canTakeInWork && !item.taken_in_work_at ? (
                        <span className="muted small">
                          Взять в работу может назначенный исполнитель или редактор.
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="danger"
                        disabled={!rowsEditable || busyCommentId === item.id}
                        onClick={() => void handleDeleteComment(item.id)}
                      >
                        {busyCommentId === item.id && !commentResolutionAction ? "Удаление..." : "Удалить"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <section className="editor-workflow-panel editor-meta-panel">
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
                        {userDisplayName(item)} [{item.role}]
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
                        {userDisplayName(item)} [{item.role}]
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
                        {userDisplayName(item)} [{item.role}]
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Титры
                  <select
                    value={metaTitlesAssigneeUserId}
                    disabled={!assignmentEditable}
                    onChange={(event) => setMetaTitlesAssigneeUserId(event.target.value)}
                  >
                    <option value="">Не назначен</option>
                    {designerUsers.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {userDisplayName(item)} [{item.role}]
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Монтаж
                  <select
                    value={metaEditAssigneeUserId}
                    disabled={!assignmentEditable}
                    onChange={(event) => setMetaEditAssigneeUserId(event.target.value)}
                  >
                    <option value="">Не назначен</option>
                    {montagerUsers.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {userDisplayName(item)} [{item.role}]
                      </option>
                    ))}
                  </select>
                </label>
                <div className="project-summary">
                  <p className="muted">Текущие ответственные</p>
                  <p>
                    Титры: <strong>{titlesAssigneeName}</strong>
                  </p>
                  <p>
                    Монтаж: <strong>{editAssigneeName}</strong>
                  </p>
                </div>
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
        </section>

        <section className="editor-workflow-panel editor-materials-panel">
              <div className="row between wrap editor-section-head">
                <h3>Материалы проекта</h3>
              </div>

              <div className="workspace-material-links-card">
                <p className="muted">
                  Здесь хранятся привязки к папкам и файлам на сетевом шаре. Это ссылки на рабочие
                  материалы, а не загрузка медиа внутрь системы.
                </p>
                {materialLinks.length > 0 ? (
                  <div className="project-text-state-badges">
                    {MATERIAL_LINK_OPTIONS.filter((option) => (materialLinkCountsByType[option.value] || 0) > 0).map(
                      (option) => (
                        <span
                          key={`material-summary-${option.value}`}
                          className="project-text-state-badge project-text-state-badge-muted"
                        >
                          {option.label}: {materialLinkCountsByType[option.value] || 0}
                        </span>
                      )
                    )}
                  </div>
                ) : null}
                <div className="workspace-material-link-form">
                  <label>
                    Тип привязки
                    <select
                      value={newMaterialLinkType}
                      disabled={!rowsEditable || materialLinkAction !== ""}
                      onChange={(event) => setNewMaterialLinkType(event.target.value)}
                    >
                      {MATERIAL_LINK_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Путь
                    <AutoSizeTextarea
                      value={newMaterialLinkPath}
                      disabled={!rowsEditable || materialLinkAction !== ""}
                      minHeight={64}
                      placeholder="/mnt/media/project/source или \\\\server\\share\\project\\master.mov"
                      onChange={(event) => setNewMaterialLinkPath(event.target.value)}
                    />
                  </label>
                  <label>
                    Комментарий
                    <AutoSizeTextarea
                      value={newMaterialLinkComment}
                      disabled={!rowsEditable || materialLinkAction !== ""}
                      minHeight={64}
                      placeholder="Что это за папка или файл"
                      onChange={(event) => setNewMaterialLinkComment(event.target.value)}
                    />
                  </label>
                </div>
                <div className="row controls wrap">
                  <button
                    type="button"
                    disabled={!rowsEditable || materialLinkAction !== "" || !newMaterialLinkPath.trim()}
                    onClick={() => void handleAddMaterialLink()}
                  >
                    {materialLinkAction === "add" ? "Добавление..." : "Добавить привязку"}
                  </button>
                </div>

                <div className="workspace-list">
                  {materialLinks.length === 0 ? (
                    <p className="muted">Привязок материалов пока нет</p>
                  ) : null}
                  {materialLinks.map((item) => (
                    <div key={item.id} className="workspace-item workspace-material-link-item">
                      <label>
                        Тип
                        <select
                          value={item.link_type}
                          disabled={!rowsEditable || busyMaterialLinkId === item.id}
                          onChange={(event) =>
                            updateMaterialLinkDraft(item.id, "link_type", event.target.value)
                          }
                        >
                          {MATERIAL_LINK_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Путь
                        <AutoSizeTextarea
                          value={item.path}
                          disabled={!rowsEditable || busyMaterialLinkId === item.id}
                          minHeight={64}
                          onChange={(event) =>
                            updateMaterialLinkDraft(item.id, "path", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Комментарий
                        <AutoSizeTextarea
                          value={item.comment}
                          disabled={!rowsEditable || busyMaterialLinkId === item.id}
                          minHeight={64}
                          onChange={(event) =>
                            updateMaterialLinkDraft(item.id, "comment", event.target.value)
                          }
                        />
                      </label>
                      <p className="muted">
                        {materialLinkTypeLabel(item.link_type)} · {item.added_by_username} · создано{" "}
                        {formatDateTime(item.created_at)} · обновлено {formatDateTime(item.updated_at)}
                      </p>
                      <div className="row controls wrap">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void handleCopyText(item.path, "Путь к материалу скопирован")}
                        >
                          Копировать путь
                        </button>
                        {externalPathHref(item.path) ? (
                          <a
                            className="button-link"
                            href={externalPathHref(item.path)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Открыть путь
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="secondary"
                          disabled={!rowsEditable || busyMaterialLinkId === item.id}
                          onClick={() => void handleUpdateMaterialLink(item.id)}
                        >
                          {busyMaterialLinkId === item.id && materialLinkAction === "update"
                            ? "Сохранение..."
                            : "Сохранить"}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={!rowsEditable || busyMaterialLinkId === item.id}
                          onClick={() => void handleDeleteMaterialLink(item.id)}
                        >
                          {busyMaterialLinkId === item.id && materialLinkAction === "delete"
                            ? "Удаление..."
                            : "Удалить"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <h4>Общие пути проекта</h4>
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
                      onClick={() => void handleCopyText(pathValue, "Путь проекта скопирован")}
                    >
                      Копировать путь
                    </button>
                    {externalPathHref(pathValue) ? (
                      <a
                        className="button-link"
                        href={externalPathHref(pathValue)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть путь
                      </a>
                    ) : null}
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

              <p className="small muted">Локальные вложения в storage приложения</p>
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
        </section>
      </div>

      <div className="editor-toolbar-sticky">
        <div className="card editor-toolbar-card">
          <div className="row controls wrap editor-table-toolbar">
            {!reviewMode ? (
              <>
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

              <div className="row controls wrap editor-format-toolbar-row editor-format-toolbar-row-inline">
                <div className="editor-add-block-buttons editor-add-block-buttons-inline">
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

                <div className="editor-format-inline-group">
                  <span className="editor-format-inline-label">Шрифт</span>
                  <select
                    className="editor-format-font-select"
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
                </div>

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

      <section className="editor-script-panel" aria-label="Таблица сценария">
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

                return (
                  <tr
                    key={`${row.id ?? "new"}-${index}`}
                    className={rowIsSelected ? "selected-row" : ""}
                    onClick={(event) => toggleRowSelection(index, event.ctrlKey || event.metaKey)}
                  >
                    <td className="editor-order-cell">
                      <span>{index + 1}</span>
                    </td>
                    <td className="editor-block-type-cell">
                      <div className="editor-block-cell-shell" onClick={(event) => event.stopPropagation()}>
                        {reviewMode ? (
                          <div className="editor-review-block-type-cell">
                            <span className={`editor-block-type-chip editor-block-type-chip-${blockTone}`}>
                              {blockLabel}
                            </span>
                          </div>
                        ) : (
                          <>
                            <select
                              className={`editor-block-type-select editor-block-type-select-${blockTone}`}
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
                            <div className="editor-block-cell-actions">
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
                                ⧉
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
                          </>
                        )}
                      </div>
                    </td>
                    <td
                      className={
                        snhMode || zkGeoMode ? "editor-text-cell editor-text-cell-structured" : "editor-text-cell"
                      }
                    >
                      <div className="editor-block-shell" onClick={(event) => event.stopPropagation()}>
                        {reviewMode ? (
                          <div className="editor-text-flow editor-text-flow-readonly">
                            <EditorRowReadPreview row={row} />
                          </div>
                        ) : snhMode ? (
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
                        {reviewMode ? (
                          <div className="editor-file-stack editor-file-stack-readonly">
                            {fileBundles.filter((bundle) => bundle.file_name || bundle.tc_in || bundle.tc_out)
                              .length === 0 ? (
                              <p className="muted editor-tech-empty">Нет файлов</p>
                            ) : (
                              fileBundles
                                .filter((bundle) => bundle.file_name || bundle.tc_in || bundle.tc_out)
                                .map((bundle, bundleIndex) => (
                                  <div
                                    key={`${index}-${bundleIndex}`}
                                    className="editor-file-bundle-readonly"
                                  >
                                    <div className="editor-file-bundle-readonly-head">
                                      {bundle.file_name || "Без имени файла"}
                                    </div>
                                    <div className="editor-file-bundle-readonly-meta">
                                      {bundle.tc_in || "-"} — {bundle.tc_out || "-"}
                                    </div>
                                  </div>
                                ))
                            )}
                          </div>
                        ) : (
                          <div className="editor-file-stack">
                            {fileBundles.map((bundle, bundleIndex) => {
                              const tcInFieldKey = getTimecodeFieldKey(index, bundleIndex, "tc_in");
                              const tcOutFieldKey = getTimecodeFieldKey(index, bundleIndex, "tc_out");
                              const tcInError =
                                activeTimecodeFieldKey === tcInFieldKey
                                  ? ""
                                  : timecodeValidationMessage(bundle.tc_in);
                              const tcOutError =
                                activeTimecodeFieldKey === tcOutFieldKey
                                  ? ""
                                  : timecodeValidationMessage(bundle.tc_out);

                              return (
                                <div key={`${index}-${bundleIndex}`} className="editor-file-bundle">
                                  <div className="editor-file-bundle-fields">
                                    <div className="editor-file-bundle-row editor-file-bundle-primary-row">
                                      <div className="editor-file-bundle-input-wrap">
                                        <input
                                          className="editor-cell-input"
                                          ref={(element) =>
                                            registerFileBundleInput(index, bundleIndex, element)
                                          }
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
                                      </div>
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
                                    <div className="editor-file-bundle-row editor-file-bundle-timecodes-row">
                                      <div className="editor-file-bundle-input-wrap editor-file-bundle-input-wrap-left">
                                        <input
                                          className={`editor-cell-input${tcInError ? " input-invalid" : ""}`}
                                          value={bundle.tc_in}
                                          disabled={!rowsEditable}
                                          placeholder="tc in"
                                          aria-invalid={tcInError ? "true" : "false"}
                                          onFocus={() => {
                                            setSelectedRowIndexes([index]);
                                            setActiveTimecodeFieldKey(tcInFieldKey);
                                          }}
                                          onBlur={(event) => {
                                            handleFileBundleTimecodeBlur(
                                              index,
                                              bundleIndex,
                                              "tc_in",
                                              event.target.value
                                            );
                                            setActiveTimecodeFieldKey(null);
                                          }}
                                          onChange={(event) =>
                                            updateFileBundle(index, bundleIndex, {
                                              tc_in: event.target.value,
                                            })
                                          }
                                        />
                                        {tcInError ? (
                                          <span className="editor-field-error">{tcInError}</span>
                                        ) : null}
                                      </div>
                                      <span className="editor-file-bundle-timecode-divider" aria-hidden="true">
                                        -
                                      </span>
                                      <div className="editor-file-bundle-input-wrap editor-file-bundle-input-wrap-right">
                                        <input
                                          className={`editor-cell-input${tcOutError ? " input-invalid" : ""}`}
                                          value={bundle.tc_out}
                                          disabled={!rowsEditable}
                                          placeholder="tc out"
                                          aria-invalid={tcOutError ? "true" : "false"}
                                          onFocus={() => {
                                            setSelectedRowIndexes([index]);
                                            setActiveTimecodeFieldKey(tcOutFieldKey);
                                          }}
                                          onBlur={(event) => {
                                            handleFileBundleTimecodeBlur(
                                              index,
                                              bundleIndex,
                                              "tc_out",
                                              event.target.value
                                            );
                                            setActiveTimecodeFieldKey(null);
                                          }}
                                          onChange={(event) =>
                                            updateFileBundle(index, bundleIndex, {
                                              tc_out: event.target.value,
                                            })
                                          }
                                        />
                                        {tcOutError ? (
                                          <span className="editor-field-error">{tcOutError}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            <div className="editor-file-bundle editor-file-bundle-draft">
                              <div className="editor-file-bundle-fields">
                                <div className="editor-file-bundle-row editor-file-bundle-primary-row editor-file-bundle-draft-row">
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
                        )}
                      </div>
                    </td>
                    <td className="editor-comment-cell">
                      <div className="editor-tech-shell" onClick={(event) => event.stopPropagation()}>
                        {reviewMode ? (
                          <div className="editor-comment-readonly">
                            {row.additional_comment ? (
                              <p>{row.additional_comment}</p>
                            ) : (
                              <p className="muted">Нет заметки</p>
                            )}
                          </div>
                        ) : (
                          <AutoSizeTextarea
                            className="editor-cell-textarea editor-cell-textarea-compact"
                            value={row.additional_comment}
                            disabled={!rowsEditable}
                            minHeight={30}
                            placeholder="текст"
                            onFocus={() => handleFieldFocus(index, "text")}
                            onChange={(event) =>
                              updateRow(index, {
                                additional_comment: event.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="editor-history-panel">
        <h3>История проекта</h3>
        <div className="history-list">
          {history.length === 0 ? <p className="muted">История проекта пока пуста</p> : null}
          {history.map((item) => (
            <div key={item.id} className="history-item">
              <p>
                <strong>{eventTypeLabel(item.event_type)}</strong> · {item.actor_username} ·{" "}
                {formatDateTime(item.created_at)}
              </p>
              <div className="project-text-state-badges">
                <span className="project-text-state-badge project-text-state-badge-muted">
                  {commentTargetLabel(historyEventTargetKind(item))}
                </span>
              </div>
              <p>{historyEventDetail(item)}</p>
              <p className="muted">
                {item.old_value || "-"} → {item.new_value || "-"}
              </p>
            </div>
          ))}
        </div>
      </section>

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
