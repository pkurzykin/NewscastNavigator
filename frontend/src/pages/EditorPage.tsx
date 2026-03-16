import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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
  uploadProjectFile
} from "../shared/api";
import type {
  ProjectCommentItem,
  ProjectFileItem,
  ProjectHistoryItem,
  ProjectListItem,
  ProjectStatusValue,
  ScriptElementRow,
  UserListItem,
  UserPublic
} from "../shared/types";

interface EditorPageProps {
  token: string;
  projectId: number;
  user: UserPublic;
  onBackToMain: () => void;
}

const BLOCK_OPTIONS = [
  { value: "podvodka", label: "Подводка" },
  { value: "zk", label: "ЗК" },
  { value: "life", label: "Лайф" },
  { value: "snh", label: "СНХ" }
];

type EditorColumnKey =
  | "order_index"
  | "block_type"
  | "text"
  | "file_name"
  | "tc_in"
  | "tc_out"
  | "additional_comment";

const DEFAULT_EDITOR_COLUMN_WIDTHS: Record<EditorColumnKey, number> = {
  order_index: 64,
  block_type: 132,
  text: 456,
  file_name: 200,
  tc_in: 108,
  tc_out: 108,
  additional_comment: 220
};

const MIN_EDITOR_COLUMN_WIDTHS: Record<EditorColumnKey, number> = {
  order_index: 56,
  block_type: 120,
  text: 320,
  file_name: 160,
  tc_in: 92,
  tc_out: 92,
  additional_comment: 180
};

const EDITOR_COLUMNS: Array<{ key: EditorColumnKey; label: string }> = [
  { key: "order_index", label: "№" },
  { key: "block_type", label: "Блок" },
  { key: "text", label: "Текст" },
  { key: "file_name", label: "Имя файла" },
  { key: "tc_in", label: "TC IN" },
  { key: "tc_out", label: "TC OUT" },
  { key: "additional_comment", label: "Другой коммент" }
];

const EDITOR_COLUMN_WIDTHS_STORAGE_KEY = "newscast-editor-column-widths-v1";

const ACTIVE_PROJECT_STATUSES: Array<{ value: ProjectStatusValue; label: string }> = [
  { value: "draft", label: "Черновик" },
  { value: "reviewed", label: "На проверке" },
  { value: "in_editing", label: "В работе" },
  { value: "in_proofreading", label: "На корректуре" },
  { value: "ready", label: "Готово" },
  { value: "delivered", label: "Сдано" }
];

const EVENT_LABELS: Record<string, string> = {
  project_created: "Проект создан",
  project_cloned: "Проект скопирован",
  status_changed: "Статус изменен",
  project_archived: "Проект отправлен в архив",
  project_restored: "Проект возвращен из архива",
  file_uploaded: "Файл загружен"
};

interface SnhRowParts {
  fio: string;
  position: string;
}

interface SnhRowPatch {
  fio?: string;
  position?: string;
  text?: string;
}

function normalizeProjectStatus(projectStatus: string): string {
  const normalized = (projectStatus || "").trim().toLowerCase();
  return normalized || "draft";
}

function isSnhBlock(blockType: string): boolean {
  return (blockType || "").trim().toLowerCase() === "snh";
}

function parseSnhSpeakerText(speakerText: string): SnhRowParts {
  const [fio = "", position = ""] = (speakerText || "").split(/\r?\n/, 2);
  return {
    fio: fio.trim(),
    position: position.trim()
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
      file_name: clampEditorColumnWidth("file_name", parsed.file_name),
      tc_in: clampEditorColumnWidth("tc_in", parsed.tc_in),
      tc_out: clampEditorColumnWidth("tc_out", parsed.tc_out),
      additional_comment: clampEditorColumnWidth(
        "additional_comment",
        parsed.additional_comment
      )
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

function normalizeOrder(rows: ScriptElementRow[]): ScriptElementRow[] {
  return rows.map((row, index) => ({
    ...row,
    order_index: index + 1
  }));
}

function toEditableRows(rows: ScriptElementRow[]): ScriptElementRow[] {
  if (rows.length === 0) {
    return [
      {
        id: null,
        order_index: 1,
        block_type: "zk",
        text: "",
        speaker_text: "",
        file_name: "",
        tc_in: "",
        tc_out: "",
        additional_comment: ""
      }
    ];
  }
  return normalizeOrder(rows);
}

export default function EditorPage({
  token,
  projectId,
  user,
  onBackToMain
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
  const [metaExecutorUserId, setMetaExecutorUserId] = useState("");
  const [metaProofreaderUserId, setMetaProofreaderUserId] = useState("");
  const [workspaceFileRoot, setWorkspaceFileRoot] = useState("");
  const [workspaceNote, setWorkspaceNote] = useState("");
  const [comments, setComments] = useState<ProjectCommentItem[]>([]);
  const [files, setFiles] = useState<ProjectFileItem[]>([]);
  const [newComment, setNewComment] = useState("");
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [commentSaving, setCommentSaving] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);
  const [busyFileId, setBusyFileId] = useState<number | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"" | "docx" | "pdf">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [columnWidths, setColumnWidths] =
    useState<Record<EditorColumnKey, number>>(loadEditorColumnWidths);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function applyProjectMeta(projectItem: ProjectListItem): void {
    setProject(projectItem);
    setMetaTitle(projectItem.title || "");
    setMetaRubric(projectItem.rubric || "");
    setMetaDuration(projectItem.planned_duration || "");
    setMetaStatus((projectItem.status || "draft") as ProjectStatusValue | string);
    setMetaAuthorUserId(projectItem.author_user_id ? String(projectItem.author_user_id) : "");
    setMetaExecutorUserId(projectItem.executor_user_id ? String(projectItem.executor_user_id) : "");
    setMetaProofreaderUserId(
      projectItem.proofreader_user_id ? String(projectItem.proofreader_user_id) : ""
    );
  }

  async function refreshWorkspaceSection(): Promise<void> {
    const payload = await fetchProjectWorkspace(token, projectId);
    setWorkspaceFileRoot(payload.workspace.file_root || "");
    setWorkspaceNote(payload.workspace.project_note || "");
    setComments(payload.comments || []);
    setFiles(payload.files || []);
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
        fetchProjectHistory(token, projectId)
      ]);
      applyProjectMeta(editorPayload.project);
      setRows(toEditableRows(editorPayload.elements));
      setSelectedRowIndexes([]);
      setWorkspaceFileRoot(workspacePayload.workspace.file_root || "");
      setWorkspaceNote(workspacePayload.workspace.project_note || "");
      setComments(workspacePayload.comments || []);
      setFiles(workspacePayload.files || []);
      setUsers(usersPayload.items || []);
      setHistory(historyPayload.items || []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить данные редактора"
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
    window.localStorage.setItem(
      EDITOR_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify(columnWidths)
    );
  }, [columnWidths]);

  const projectStatus = project?.status || "";
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

  function updateRow(index: number, patch: Partial<ScriptElementRow>): void {
    setRows((previousRows) =>
      previousRows.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              ...patch
            }
          : row
      )
    );
  }

  function updateSnhRow(index: number, patch: SnhRowPatch): void {
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
          speaker_text: buildSnhSpeakerText(nextFio, nextPosition)
        };
      })
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
          speaker_text: isSnhBlock(nextBlockType) ? row.speaker_text : ""
        };
      })
    );
  }

  function addRow(): void {
    setRows((previousRows) =>
      normalizeOrder([
        ...previousRows,
        {
          id: null,
          order_index: previousRows.length + 1,
          block_type: "zk",
          text: "",
          speaker_text: "",
          file_name: "",
          tc_in: "",
          tc_out: "",
          additional_comment: ""
        }
      ])
    );
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
  }

  async function saveRows(): Promise<void> {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const normalizedRows = normalizeOrder(rows);
      const payload = await saveProjectEditor(token, projectId, normalizedRows);
      setSuccess(
        `${payload.message}: обновлено ${payload.updated}, добавлено ${payload.inserted}, удалено ${payload.removed}.`
      );
      await loadEditorPayload();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка сохранения таблицы"
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveProjectMetaSection(): Promise<void> {
    setMetaSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload: {
        title?: string | null;
        rubric?: string | null;
        planned_duration?: string | null;
        status?: string | null;
        author_user_id?: number | null;
        executor_user_id?: number | null;
        proofreader_user_id?: number | null;
      } = {};

      if (metaEditable) {
        payload.title = metaTitle;
        payload.rubric = metaRubric;
        payload.planned_duration = metaDuration;
      }
      if (statusEditable) {
        payload.status = metaStatus;
      }
      if (assignmentEditable) {
        payload.author_user_id = metaAuthorUserId ? Number(metaAuthorUserId) : null;
        payload.executor_user_id = metaExecutorUserId ? Number(metaExecutorUserId) : null;
        payload.proofreader_user_id = metaProofreaderUserId ? Number(metaProofreaderUserId) : null;
      }

      const response = await updateProjectMeta(token, projectId, payload);
      applyProjectMeta(response.project);
      setSuccess(response.message);
      await refreshHistorySection();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка сохранения метаданных проекта"
      );
    } finally {
      setMetaSaving(false);
    }
  }

  async function saveWorkspaceMeta(): Promise<void> {
    setWorkspaceSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = await updateProjectWorkspace(token, projectId, {
        file_root: workspaceFileRoot,
        project_note: workspaceNote
      });
      setSuccess(payload.message);
      await refreshWorkspaceSection();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка сохранения пути и заметки"
      );
    } finally {
      setWorkspaceSaving(false);
    }
  }

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
        requestError instanceof Error
          ? requestError.message
          : "Ошибка добавления комментария"
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
        requestError instanceof Error
          ? requestError.message
          : "Ошибка удаления комментария"
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
        requestError instanceof Error
          ? requestError.message
          : "Ошибка загрузки файла"
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
        requestError instanceof Error
          ? requestError.message
          : "Ошибка удаления файла"
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
        requestError instanceof Error
          ? requestError.message
          : "Ошибка скачивания файла"
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
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка экспорта"
      );
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
          [columnKey]: nextWidth
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
            | Последнее изменение статуса: <strong>{formatDateTime(project?.status_changed_at)}</strong>
          </p>
        </div>
        <button type="button" className="secondary" onClick={onBackToMain}>
          Назад в MAIN
        </button>
      </div>

      {!rowsEditable ? (
        <p className="muted">{rowEditRestrictionMessage(user.role, projectStatus)}</p>
      ) : null}

      <div className="card">
        <h3>Метаданные проекта и workflow</h3>
        <div className="editor-meta-grid editor-meta-grid-wide">
          <label>
            Название
            <input
              value={metaTitle}
              disabled={!metaEditable || metaSaving}
              onChange={(event) => setMetaTitle(event.target.value)}
            />
          </label>
          <label>
            Рубрика
            <input
              value={metaRubric}
              disabled={!metaEditable || metaSaving}
              onChange={(event) => setMetaRubric(event.target.value)}
            />
          </label>
          <label>
            Хронометраж
            <input
              value={metaDuration}
              disabled={!metaEditable || metaSaving}
              onChange={(event) => setMetaDuration(event.target.value)}
              placeholder="02:30"
            />
          </label>
          <label>
            Статус
            <select
              value={metaStatus}
              disabled={!statusEditable || metaSaving}
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
              disabled={!assignmentEditable || metaSaving}
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
            Исполнитель
            <select
              value={metaExecutorUserId}
              disabled={!assignmentEditable || metaSaving}
              onChange={(event) => setMetaExecutorUserId(event.target.value)}
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
            Корректор
            <select
              value={metaProofreaderUserId}
              disabled={!assignmentEditable || metaSaving}
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
        </div>

        <div className="row controls wrap">
          <button
            type="button"
            onClick={() => void saveProjectMetaSection()}
            disabled={metaSaving || (!metaEditable && !assignmentEditable && !statusEditable)}
          >
            {metaSaving ? "Сохранение..." : "Сохранить метаданные"}
          </button>
        </div>
      </div>

      <div className="row controls wrap">
        <button type="button" onClick={addRow} disabled={!rowsEditable || saving}>
          Добавить строку
        </button>
        <button
          type="button"
          className="danger"
          onClick={deleteSelectedRows}
          disabled={!rowsEditable || saving || selectedRowIndexes.length === 0}
        >
          Удалить выбранные
        </button>
        <button type="button" onClick={() => void saveRows()} disabled={!rowsEditable || saving}>
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
      </div>

      <p className="muted">
        Выделение строк: клик по строке. Множественный выбор: Ctrl/Cmd + клик.
      </p>
      <p className="muted">
        Для блока `СНХ` в ячейке текста отдельно вводятся `ФИО`, `Должность` и текст синхрона.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}

      <div className="table-wrap">
        <table className="editor-table">
          <colgroup>
            {EDITOR_COLUMNS.map((column) => (
              <col
                key={column.key}
                style={{
                  width: `${columnWidths[column.key]}px`
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
              const snhParts = parseSnhSpeakerText(row.speaker_text);

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
                  <td className={snhMode ? "editor-text-cell editor-text-cell-snh" : "editor-text-cell"}>
                    {snhMode ? (
                      <div className="snh-editor" onClick={(event) => event.stopPropagation()}>
                        <input
                          className="snh-editor-line"
                          value={snhParts.fio}
                          disabled={!rowsEditable}
                          placeholder="Фамилия Имя"
                          onChange={(event) =>
                            updateSnhRow(index, {
                              fio: event.target.value
                            })
                          }
                        />
                        <input
                          className="snh-editor-line"
                          value={snhParts.position}
                          disabled={!rowsEditable}
                          placeholder="Должность"
                          onChange={(event) =>
                            updateSnhRow(index, {
                              position: event.target.value
                            })
                          }
                        />
                        <textarea
                          className="snh-editor-text"
                          value={row.text}
                          disabled={!rowsEditable}
                          placeholder="Текст синхрона"
                          rows={4}
                          onChange={(event) =>
                            updateSnhRow(index, {
                              text: event.target.value
                            })
                          }
                        />
                      </div>
                    ) : (
                      <textarea
                        className="editor-cell-textarea"
                        value={row.text}
                        disabled={!rowsEditable}
                        placeholder="Текст блока"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          updateRow(index, {
                            text: event.target.value
                          })
                        }
                        rows={4}
                      />
                    )}
                  </td>
                  <td>
                    <input
                      className="editor-cell-input"
                      value={row.file_name}
                      disabled={!rowsEditable}
                      placeholder="video_01.mov"
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateRow(index, {
                          file_name: event.target.value
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="editor-cell-input"
                      value={row.tc_in}
                      disabled={!rowsEditable}
                      placeholder="MM:SS"
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateRow(index, {
                          tc_in: event.target.value
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="editor-cell-input"
                      value={row.tc_out}
                      disabled={!rowsEditable}
                      placeholder="MM:SS"
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateRow(index, {
                          tc_out: event.target.value
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="editor-cell-input"
                      value={row.additional_comment}
                      disabled={!rowsEditable}
                      placeholder="Комментарий к строке"
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateRow(index, {
                          additional_comment: event.target.value
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

      <div className="card">
        <h3>Файлы, заметки и комментарии</h3>

        <div className="editor-meta-grid">
          <label>
            Путь к файлам проекта
            <input
              value={workspaceFileRoot}
              disabled={!rowsEditable || workspaceSaving}
              onChange={(event) => setWorkspaceFileRoot(event.target.value)}
              placeholder="/srv/newscast/storage (или относительный путь)"
            />
          </label>
          <label>
            Служебная заметка
            <textarea
              value={workspaceNote}
              disabled={!rowsEditable || workspaceSaving}
              onChange={(event) => setWorkspaceNote(event.target.value)}
              rows={4}
              placeholder="Короткая общая заметка по проекту"
            />
          </label>
        </div>

        <div className="row controls">
          <button
            type="button"
            onClick={() => void saveWorkspaceMeta()}
            disabled={!rowsEditable || workspaceSaving}
          >
            {workspaceSaving ? "Сохранение..." : "Сохранить путь и заметку"}
          </button>
        </div>

        <div className="editor-workspace-columns">
          <div className="workspace-column">
            <h4>Лента комментариев</h4>
            <div className="row controls">
              <textarea
                value={newComment}
                disabled={!rowsEditable || commentSaving}
                onChange={(event) => setNewComment(event.target.value)}
                rows={3}
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

          <div className="workspace-column">
            <h4>Файлы проекта</h4>
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
