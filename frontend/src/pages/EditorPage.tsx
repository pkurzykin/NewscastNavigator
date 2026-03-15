import { useEffect, useMemo, useRef, useState } from "react";

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

function normalizeProjectStatus(projectStatus: string): string {
  const normalized = (projectStatus || "").trim().toLowerCase();
  return normalized || "draft";
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
          : "Ошибка сохранения параметров проекта"
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
        Для блока СНХ поле `Титр` должно содержать две строки: 1) ФИО, 2) должность.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}

      <div className="table-wrap">
        <table className="editor-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Блок</th>
              <th>Текст</th>
              <th>Титр</th>
              <th>Имя файла</th>
              <th>TC IN</th>
              <th>TC OUT</th>
              <th>Другой коммент</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.id ?? "new"}-${index}`}
                className={selectedRowIndexes.includes(index) ? "selected-row" : ""}
                onClick={(event) => toggleRowSelection(index, event.ctrlKey || event.metaKey)}
              >
                <td>{index + 1}</td>
                <td>
                  <select
                    value={row.block_type}
                    disabled={!rowsEditable}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateRow(index, {
                        block_type: event.target.value
                      })
                    }
                  >
                    {BLOCK_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <textarea
                    value={row.text}
                    disabled={!rowsEditable}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateRow(index, {
                        text: event.target.value
                      })
                    }
                    rows={3}
                  />
                </td>
                <td>
                  <textarea
                    value={row.speaker_text}
                    disabled={!rowsEditable}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateRow(index, {
                        speaker_text: event.target.value
                      })
                    }
                    rows={3}
                  />
                </td>
                <td>
                  <input
                    value={row.file_name}
                    disabled={!rowsEditable}
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
                    value={row.additional_comment}
                    disabled={!rowsEditable}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateRow(index, {
                        additional_comment: event.target.value
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Файлы и комментарии проекта</h3>

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
            Комментарий проекта
            <textarea
              value={workspaceNote}
              disabled={!rowsEditable || workspaceSaving}
              onChange={(event) => setWorkspaceNote(event.target.value)}
              rows={4}
            />
          </label>
        </div>

        <div className="row controls">
          <button
            type="button"
            onClick={() => void saveWorkspaceMeta()}
            disabled={!rowsEditable || workspaceSaving}
          >
            {workspaceSaving ? "Сохранение..." : "Сохранить параметры проекта"}
          </button>
        </div>

        <div className="editor-workspace-columns">
          <div className="workspace-column">
            <h4>Комментарии проекта</h4>
            <div className="row controls">
              <textarea
                value={newComment}
                disabled={!rowsEditable || commentSaving}
                onChange={(event) => setNewComment(event.target.value)}
                rows={3}
                placeholder="Новый комментарий к проекту"
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
