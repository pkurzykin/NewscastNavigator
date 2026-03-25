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
  deleteProjectComment,
  deleteProjectFile,
  downloadProjectExport,
  downloadProjectFile,
  fetchProjectEditor,
  fetchProjectHistory,
  fetchProjectWorkspace,
  fetchUsers,
  saveProjectEditor,
  updateProjectMeta,
  updateProjectWorkspace,
  uploadProjectFile,
} from "../shared/api";
import type {
  ProjectCommentItem,
  ProjectFileItem,
  ProjectHistoryItem,
  ProjectListItem,
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
import { canUseEditorCoreTextField } from "../features/editor-core/defaults";

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
type RichTextEditorId = `${number}:${FormatTargetKey}`;

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
};

const DEFAULT_FONT_FAMILY = "PT Sans";
const DEFAULT_FILL_COLOR = "#f4f6f9";
const FONT_OPTIONS = ["PT Sans", "Arial", "Georgia", "Times New Roman", "Roboto Slab"];
const FILL_COLOR_OPTIONS = [
  "#f4f6f9",
  "#fff4d6",
  "#e7f5ff",
  "#fbe9ff",
  "#e9fbe7",
  "#ffe9e7",
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

interface AutoSizeTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  minHeight?: number;
}

interface RichTextFieldChangePayload {
  editor?: "legacy_html" | "tiptap";
  text: string;
  html: string;
  doc?: Record<string, unknown>;
}

interface SelectionFormattingCommand {
  legacy: () => void;
  tiptap: (editor: TiptapEditor) => void;
}

interface RichTextFieldProps {
  editorId: RichTextEditorId;
  htmlValue: string;
  plainTextValue: string;
  disabled: boolean;
  placeholder: string;
  className: string;
  style?: CSSProperties;
  onFocusField: () => void;
  onChangeValue: (payload: RichTextFieldChangePayload) => void;
  onRegister: (editorId: RichTextEditorId, element: HTMLDivElement | null) => void;
  onSelectionChange: (editorId: RichTextEditorId) => void;
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
  payload: RichTextFieldChangePayload
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
      fill_color: (source?.fill_color || targetDefaults.fill_color || DEFAULT_FILL_COLOR).trim(),
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

function RichTextField({
  editorId,
  htmlValue,
  plainTextValue,
  disabled,
  placeholder,
  className,
  style,
  onFocusField,
  onChangeValue,
  onRegister,
  onSelectionChange,
}: RichTextFieldProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = editorRef.current;
    if (!element) {
      return;
    }
    onRegister(editorId, element);
    return () => onRegister(editorId, null);
  }, [editorId, onRegister]);

  useEffect(() => {
    const element = editorRef.current;
    if (!element) {
      return;
    }
    const nextHtml = htmlValue || buildRichTextHtmlFromPlainText(plainTextValue);
    if (element.innerHTML !== nextHtml) {
      element.innerHTML = nextHtml;
    }
  }, [htmlValue, plainTextValue]);

  return (
    <div
      ref={editorRef}
      className={`${className} rich-text-field`}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      data-empty={plainTextValue.trim() ? "false" : "true"}
      style={style}
      onFocus={onFocusField}
      onInput={(event) => {
        const element = event.currentTarget;
        const text = normalizeEditableText(element.innerText || "");
        const html = text ? element.innerHTML : "";
        onChangeValue({ editor: "legacy_html", text, html });
        onSelectionChange(editorId);
      }}
      onKeyUp={() => onSelectionChange(editorId)}
      onMouseUp={() => onSelectionChange(editorId)}
      onClick={(event) => {
        event.stopPropagation();
      }}
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
  const [commentSaving, setCommentSaving] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);
  const [busyFileId, setBusyFileId] = useState<number | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"" | "docx" | "pdf">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [columnWidths, setColumnWidths] =
    useState<Record<EditorColumnKey, number>>(loadEditorColumnWidths);
  const [addRowBlockType, setAddRowBlockType] = useState("");
  const [activeFormatScope, setActiveFormatScope] = useState<ActiveFormatScope | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const richEditorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tiptapEditorRefs = useRef<Record<string, TiptapEditor | null>>({});
  const richSelectionRef = useRef<{ editorId: RichTextEditorId; range: Range } | null>(null);
  const lastSavedTableRef = useRef("");
  const lastSavedWorkflowRef = useRef("");
  const lastSavedWorkspaceRef = useRef("");
  const tableSaveRequestIdRef = useRef(0);
  const workflowSaveRequestIdRef = useRef(0);
  const workspaceSaveRequestIdRef = useRef(0);

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
  }

  async function refreshHistorySection(): Promise<void> {
    const payload = await fetchProjectHistory(token, projectId);
    setHistory(payload.items || []);
  }

  async function loadEditorPayload(): Promise<void> {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const [editorPayload, workspacePayload, usersPayload, historyPayload] = await Promise.all([
        fetchProjectEditor(token, projectId),
        fetchProjectWorkspace(token, projectId),
        fetchUsers(token),
        fetchProjectHistory(token, projectId),
      ]);

      applyProjectMeta(editorPayload.project);

      const loadedRows = toEditableRows(editorPayload.elements);
      setRows(loadedRows);
      setSelectedRowIndexes([]);
      setActiveFormatScope(null);
      setWorkspaceFileRoots(workspacePayload.workspace.file_roots || []);
      setWorkspaceNote(workspacePayload.workspace.project_note || "");
      setComments(workspacePayload.comments || []);
      setFiles(workspacePayload.files || []);
      setUsers(usersPayload.items || []);
      setHistory(historyPayload.items || []);

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

  function buildNextRowWithRichFieldValue(
    row: ScriptElementRow,
    target: FormatTargetKey,
    payload: RichTextFieldChangePayload
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
        structured_data: buildZkGeoStructuredData(text, current.text),
        formatting: nextFormatting,
        rich_text: nextRichText,
      };
    }

    if (isZkGeoBlock(row.block_type)) {
      const current = parseZkGeoStructuredData(row);
      return {
        ...row,
        text,
        structured_data: buildZkGeoStructuredData(current.geo, text),
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
    payload: RichTextFieldChangePayload
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
          structured_data: buildZkGeoStructuredData(nextGeo, nextText),
        };
      })
    );
  }

  function registerRichEditor(editorId: RichTextEditorId, element: HTMLDivElement | null): void {
    richEditorRefs.current[editorId] = element;
  }

  function registerTiptapEditor(editorId: string, editor: TiptapEditor | null): void {
    tiptapEditorRefs.current[editorId] = editor;
  }

  function syncRichFieldValue(editorId: RichTextEditorId): void {
    const binding = parseRichTextEditorId(editorId);
    const element = richEditorRefs.current[editorId];
    if (!binding || !element) {
      return;
    }

    const text = normalizeEditableText(element.innerText || "");
    const html = text ? element.innerHTML : "";

    applyRichFieldValue(binding.rowIndex, binding.target, { text, html });
  }

  function handleRichSelectionChange(editorId: RichTextEditorId): void {
    const element = richEditorRefs.current[editorId];
    if (!element) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) {
      return;
    }
    richSelectionRef.current = {
      editorId,
      range: range.cloneRange(),
    };
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

  function restoreActiveRichSelection(): RichTextEditorId | null {
    if (!activeFormatScope) {
      return null;
    }

    const editorId = getRichTextEditorId(activeFormatScope.rowIndex, activeFormatScope.target);
    const element = richEditorRefs.current[editorId];
    if (!element) {
      return null;
    }

    element.focus();
    const savedSelection = richSelectionRef.current;
    if (savedSelection?.editorId === editorId) {
      const selection = window.getSelection();
      try {
        selection?.removeAllRanges();
        selection?.addRange(savedSelection.range);
      } catch (_error) {
        richSelectionRef.current = null;
      }
    }
    return editorId;
  }

  function hasExpandedSelection(editorId: RichTextEditorId): boolean {
    const element = richEditorRefs.current[editorId];
    const selection = window.getSelection();
    if (!element || !selection || selection.rangeCount === 0) {
      return false;
    }
    const range = selection.getRangeAt(0);
    return !range.collapsed && element.contains(range.commonAncestorContainer);
  }

  function executeSelectionFormatting(command: SelectionFormattingCommand): boolean {
    if (activeFormatScope) {
      const editorId = getRichTextEditorId(activeFormatScope.rowIndex, activeFormatScope.target);
      const tiptapEditor = tiptapEditorRefs.current[editorId];
      if (tiptapEditor) {
        tiptapEditor.commands.focus();
        const { from, to } = tiptapEditor.state.selection;
        if (from === to) {
          return false;
        }
        command.tiptap(tiptapEditor);
        handleTiptapSelectionChange(editorId);
        return true;
      }
    }

    const editorId = restoreActiveRichSelection();
    if (!editorId || !hasExpandedSelection(editorId)) {
      return false;
    }
    document.execCommand("styleWithCSS", false, "true");
    command.legacy();
    handleRichSelectionChange(editorId);
    syncRichFieldValue(editorId);
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
    richCommand?: SelectionFormattingCommand
  ): void {
    if (richCommand && executeSelectionFormatting(richCommand)) {
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

  function handleBlockTypeChange(index: number, nextBlockType: string): void {
    setRows((previousRows) =>
      previousRows.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }
        return {
          ...row,
          block_type: nextBlockType,
          text: isZkGeoBlock(nextBlockType) ? parseZkGeoStructuredData(row).text : row.text,
          speaker_text: isSnhBlock(nextBlockType) ? row.speaker_text : "",
          structured_data: isZkGeoBlock(nextBlockType) ? buildZkGeoStructuredData("", row.text) : {},
          formatting: normalizeFormatting(nextBlockType, row.formatting),
        };
      })
    );
  }

  function insertRow(blockType: string, insertAfterIndex?: number): void {
    setRows((previousRows) => {
      const insertionIndex =
        typeof insertAfterIndex === "number"
          ? Math.max(0, Math.min(insertAfterIndex + 1, previousRows.length))
          : previousRows.length;
      const nextRows = [...previousRows];
      nextRows.splice(insertionIndex, 0, buildEmptyRow(blockType, insertionIndex + 1));
      return toEditableRows(nextRows);
    });
    if (typeof insertAfterIndex === "number") {
      setSelectedRowIndexes([insertAfterIndex + 1]);
      setActiveFormatScope({
        rowIndex: insertAfterIndex + 1,
        target: "text",
      });
    }
  }

  function handleAddRowSelection(blockType: string): void {
    if (!blockType) {
      return;
    }
    const insertAfterIndex =
      selectedRowIndexes.length > 0 ? selectedRowIndexes[selectedRowIndexes.length - 1] : undefined;
    insertRow(blockType, insertAfterIndex);
    setAddRowBlockType("");
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
    const nextRows = rows.filter((_row, index) => !selectedSet.has(index));
    setRows(toEditableRows(nextRows));
    setSelectedRowIndexes([]);
    setActiveFormatScope(null);
  }

  async function persistTable({
    showSuccess,
    refreshFromServer,
  }: {
    showSuccess: boolean;
    refreshFromServer: boolean;
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
      if (event.key !== "Enter" || !rowsEditable || selectedRowIndexes.length === 0) {
        return;
      }

      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      const activeElement = document.activeElement as HTMLElement | null;
      if (
        ["input", "textarea", "select", "button"].includes(activeTag) ||
        Boolean(activeElement?.isContentEditable) ||
        Boolean(activeElement?.closest(".rich-text-field"))
      ) {
        return;
      }

      const sourceIndex = selectedRowIndexes[selectedRowIndexes.length - 1];
      const sourceRow = rows[sourceIndex];
      if (!sourceRow) {
        return;
      }

      event.preventDefault();
      insertRow(String(sourceRow.block_type || "zk"), sourceIndex);
    }

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [rows, rowsEditable, selectedRowIndexes]);

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

  if (loading) {
    return (
      <section className="card">
        <p className="muted">Загрузка EDITOR...</p>
      </section>
    );
  }

  return (
    <section className="card">
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
                <span className="small muted">
                  {workflowAutosaveState === "saving"
                    ? "Автосохранение..."
                    : workflowAutosaveState === "error"
                      ? "Ошибка автосохранения"
                      : "Автосохранение включено"}
                </span>
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
                <span className="small muted">
                  {workspaceAutosaveState === "saving"
                    ? "Автосохранение..."
                    : workspaceAutosaveState === "error"
                      ? "Ошибка автосохранения"
                      : "Автосохранение включено"}
                </span>
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
            <label className="editor-add-row-label">
              Добавить строку
              <select
                value={addRowBlockType}
                disabled={!rowsEditable || saving}
                onChange={(event) => handleAddRowSelection(event.target.value)}
              >
                <option value="">Выбери блок...</option>
                {BLOCK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
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
              onClick={() => void persistTable({ showSuccess: true, refreshFromServer: true })}
              disabled={!rowsEditable || saving}
            >
              {saving ? "Сохранение..." : "Сохранить таблицу"}
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
            <span className="small muted">
              {tableAutosaveState === "saving"
                ? "Автосохранение таблицы..."
                : tableAutosaveState === "error"
                  ? "Ошибка автосохранения"
                  : "Автосохранение таблицы включено"}
            </span>
          </div>

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
                          {
                            legacy: () => {
                              document.execCommand("fontName", false, event.target.value);
                            },
                            tiptap: (editor) => {
                              editor.chain().focus().setFontFamily(event.target.value).run();
                            },
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
                          {
                            legacy: () => {
                              document.execCommand("removeFormat");
                            },
                            tiptap: (editor) => {
                              editor
                                .chain()
                                .focus()
                                .unsetBold()
                                .unsetItalic()
                                .unsetStrike()
                                .unsetHighlight()
                                .unsetFontFamily()
                                .run();
                            },
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
                          {
                            legacy: () => {
                              document.execCommand("bold");
                            },
                            tiptap: (editor) => {
                              editor.chain().focus().toggleBold().run();
                            },
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
                          {
                            legacy: () => {
                              document.execCommand("italic");
                            },
                            tiptap: (editor) => {
                              editor.chain().focus().toggleItalic().run();
                            },
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
                          {
                            legacy: () => {
                              document.execCommand("strikeThrough");
                            },
                            tiptap: (editor) => {
                              editor.chain().focus().toggleStrike().run();
                            },
                          }
                        )
                      : undefined
                  }
                >
                  Strike
                </button>
              </div>

              <div className="editor-color-palette">
                {FILL_COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`editor-color-swatch${
                      activeFormatConfig?.fill_color === color ? " active" : ""
                    }`}
                    style={{ backgroundColor: color }}
                    disabled={!activeFormatScope || !activeFormatConfig}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      activeFormatScope
                        ? applyFormattingChange(
                            activeFormatScope.target,
                            {
                              fill_color: color,
                            },
                            {
                              legacy: () => {
                                document.execCommand("hiliteColor", false, color);
                              },
                              tiptap: (editor) => {
                                editor.chain().focus().setHighlight({ color }).run();
                              },
                            }
                          )
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          </div>
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
                const editorCoreTextMode = canUseEditorCoreTextField(row.block_type, "text");
                const snhParts = parseSnhSpeakerText(row.speaker_text);
                const zkGeoParts = parseZkGeoStructuredData(row);
                const textFormat = getFormattingTarget(row, "text");
                const fioFormat = getFormattingTarget(row, "speaker_fio");
                const positionFormat = getFormattingTarget(row, "speaker_position");
                const geoFormat = getFormattingTarget(row, "geo");

                return (
                  <tr
                    key={`${row.id ?? "new"}-${index}`}
                    className={selectedRowIndexes.includes(index) ? "selected-row" : ""}
                    onClick={(event) => toggleRowSelection(index, event.ctrlKey || event.metaKey)}
                  >
                    <td>{index + 1}</td>
                    <td>
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
                    </td>
                    <td
                      className={
                        snhMode || zkGeoMode ? "editor-text-cell editor-text-cell-structured" : "editor-text-cell"
                      }
                    >
                      {snhMode ? (
                        <div className="structured-editor" onClick={(event) => event.stopPropagation()}>
                          <RichTextField
                            editorId={getRichTextEditorId(index, "speaker_fio")}
                            className="structured-editor-line structured-editor-line-emphasis rich-text-field-compact"
                            htmlValue={getFormattingHtml(row, "speaker_fio", snhParts.fio)}
                            plainTextValue={snhParts.fio}
                            disabled={!rowsEditable}
                            placeholder="ФИО"
                            style={buildFormattingStyle(fioFormat)}
                            onRegister={registerRichEditor}
                            onSelectionChange={handleRichSelectionChange}
                            onFocusField={() => handleFieldFocus(index, "speaker_fio")}
                            onChangeValue={(payload) =>
                              applyRichFieldValue(index, "speaker_fio", payload)
                            }
                          />
                          <RichTextField
                            editorId={getRichTextEditorId(index, "speaker_position")}
                            className="structured-editor-line structured-editor-line-emphasis rich-text-field-compact"
                            htmlValue={getFormattingHtml(row, "speaker_position", snhParts.position)}
                            plainTextValue={snhParts.position}
                            disabled={!rowsEditable}
                            placeholder="Должность"
                            style={buildFormattingStyle(positionFormat)}
                            onRegister={registerRichEditor}
                            onSelectionChange={handleRichSelectionChange}
                            onFocusField={() => handleFieldFocus(index, "speaker_position")}
                            onChangeValue={(payload) =>
                              applyRichFieldValue(index, "speaker_position", payload)
                            }
                          />
                          <RichTextField
                            editorId={getRichTextEditorId(index, "text")}
                            className="structured-editor-text"
                            htmlValue={getFormattingHtml(row, "text", row.text)}
                            plainTextValue={row.text}
                            disabled={!rowsEditable}
                            placeholder="Текст"
                            style={buildFormattingStyle(textFormat)}
                            onRegister={registerRichEditor}
                            onSelectionChange={handleRichSelectionChange}
                            onFocusField={() => handleFieldFocus(index, "text")}
                            onChangeValue={(payload) => applyRichFieldValue(index, "text", payload)}
                          />
                        </div>
                      ) : zkGeoMode ? (
                        <div className="structured-editor" onClick={(event) => event.stopPropagation()}>
                          <RichTextField
                            editorId={getRichTextEditorId(index, "geo")}
                            className="structured-editor-line rich-text-field-compact"
                            htmlValue={getFormattingHtml(row, "geo", zkGeoParts.geo)}
                            plainTextValue={zkGeoParts.geo}
                            disabled={!rowsEditable}
                            placeholder="Гео"
                            style={buildFormattingStyle(geoFormat)}
                            onRegister={registerRichEditor}
                            onSelectionChange={handleRichSelectionChange}
                            onFocusField={() => handleFieldFocus(index, "geo")}
                            onChangeValue={(payload) => applyRichFieldValue(index, "geo", payload)}
                          />
                          <RichTextField
                            editorId={getRichTextEditorId(index, "text")}
                            className="structured-editor-text"
                            htmlValue={getFormattingHtml(row, "text", zkGeoParts.text)}
                            plainTextValue={zkGeoParts.text}
                            disabled={!rowsEditable}
                            placeholder="Текст"
                            style={buildFormattingStyle(textFormat)}
                            onRegister={registerRichEditor}
                            onSelectionChange={handleRichSelectionChange}
                            onFocusField={() => handleFieldFocus(index, "text")}
                            onChangeValue={(payload) => applyRichFieldValue(index, "text", payload)}
                          />
                        </div>
                      ) : editorCoreTextMode ? (
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
                      ) : (
                        <RichTextField
                          editorId={getRichTextEditorId(index, "text")}
                          className="editor-cell-textarea"
                          htmlValue={getFormattingHtml(row, "text", row.text)}
                          plainTextValue={row.text}
                          disabled={!rowsEditable}
                          placeholder="Текст"
                          style={buildFormattingStyle(textFormat)}
                          onRegister={registerRichEditor}
                          onSelectionChange={handleRichSelectionChange}
                          onFocusField={() => handleFieldFocus(index, "text")}
                          onChangeValue={(payload) => applyRichFieldValue(index, "text", payload)}
                        />
                      )}
                    </td>
                    <td>
                      <div className="editor-file-stack" onClick={(event) => event.stopPropagation()}>
                        <input
                          className="editor-cell-input"
                          value={row.file_name}
                          disabled={!rowsEditable}
                          placeholder="Имя файла"
                          onChange={(event) =>
                            updateRow(index, {
                              file_name: event.target.value,
                            })
                          }
                        />
                        <input
                          className="editor-cell-input"
                          value={row.tc_in}
                          disabled={!rowsEditable}
                          placeholder="TC IN"
                          onChange={(event) =>
                            updateRow(index, {
                              tc_in: event.target.value,
                            })
                          }
                        />
                        <input
                          className="editor-cell-input"
                          value={row.tc_out}
                          disabled={!rowsEditable}
                          placeholder="TC OUT"
                          onChange={(event) =>
                            updateRow(index, {
                              tc_out: event.target.value,
                            })
                          }
                        />
                      </div>
                    </td>
                    <td>
                      <AutoSizeTextarea
                        className="editor-cell-textarea editor-cell-textarea-compact"
                        value={row.additional_comment}
                        disabled={!rowsEditable}
                        minHeight={84}
                        placeholder="текст"
                        onClick={(event) => event.stopPropagation()}
                        onFocus={() => handleFieldFocus(index, "text")}
                        onChange={(event) =>
                          updateRow(index, {
                            additional_comment: event.target.value,
                          })
                        }
                      />
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
