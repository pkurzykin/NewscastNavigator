import type {
  LoginResponse,
  ProjectEditorPayload,
  ProjectActionResponse,
  ProjectCommentItem,
  ProjectFileItem,
  ProjectFilters,
  ProjectHistoryResponse,
  ProjectRevisionActionResponse,
  ProjectRevisionDetailResponse,
  ProjectRevisionDiffResponse,
  ProjectRevisionElementsResponse,
  ProjectRevisionListResponse,
  ProjectListResponse,
  ProjectMetaUpdatePayload,
  ProjectWorkspacePayload,
  ProjectsView,
  SaveScriptElementsResponse,
  ScriptElementRow,
  UserListResponse,
  UserPublic,
  WorkspaceActionResponse
} from "./types";

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.toString().trim();
const API_BASE =
  configuredApiBase && configuredApiBase !== "/"
    ? configuredApiBase.replace(/\/+$/, "")
    : "";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) {
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : "Ошибка запроса к API";
    throw new Error(detail);
  }
  return payload as T;
}

function buildAuthHeaders(token?: string): HeadersInit {
  if (!token) {
    return {};
  }
  return {
    Authorization: `Bearer ${token}`
  };
}

function buildProjectsQuery(view: ProjectsView, filters: ProjectFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("view", view);

  const search = filters.search?.trim();
  if (search) {
    params.set("search", search);
  }

  for (const status of filters.status || []) {
    const normalized = status.trim();
    if (normalized) {
      params.append("status", normalized);
    }
  }

  const simpleFields: Array<keyof ProjectFilters> = [
    "rubric",
    "participant",
    "created_from",
    "created_to",
    "archived_by",
    "archived_from",
    "archived_to"
  ];
  for (const key of simpleFields) {
    const value = filters[key]?.toString().trim();
    if (value) {
      params.set(key, value);
    }
  }

  return params;
}

function extractFileNameFromDisposition(dispositionHeader: string | null): string {
  if (!dispositionHeader) {
    return "";
  }
  const utfMatch = dispositionHeader.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch (_error) {
      return utfMatch[1];
    }
  }
  const plainMatch = dispositionHeader.match(/filename=\"?([^\";]+)\"?/i);
  return plainMatch?.[1] || "";
}

export async function login(
  username: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });
  return parseJsonResponse<LoginResponse>(response);
}

export async function getCurrentUser(token: string): Promise<UserPublic> {
  const response = await fetch(`${API_BASE}/api/v1/auth/me`, {
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<UserPublic>(response);
}

export async function fetchUsers(token?: string): Promise<UserListResponse> {
  const response = await fetch(`${API_BASE}/api/v1/users`, {
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<UserListResponse>(response);
}

export async function fetchProjects(
  view: ProjectsView,
  filters: ProjectFilters,
  token?: string
): Promise<ProjectListResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/projects?${buildProjectsQuery(view, filters).toString()}`,
    {
      headers: buildAuthHeaders(token)
    }
  );
  return parseJsonResponse<ProjectListResponse>(response);
}

export async function createEmptyProject(
  token: string,
  payload?: { title?: string; rubric?: string; planned_duration?: string }
): Promise<ProjectActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(token)
    },
    body: JSON.stringify(payload || {})
  });
  return parseJsonResponse<ProjectActionResponse>(response);
}

export async function cloneLastProject(token: string): Promise<ProjectActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/clone-last`, {
    method: "POST",
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectActionResponse>(response);
}

export async function cloneSelectedProject(
  token: string,
  projectId: number
): Promise<ProjectActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/clone`, {
    method: "POST",
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectActionResponse>(response);
}

export async function updateProjectMeta(
  token: string,
  projectId: number,
  payload: ProjectMetaUpdatePayload
): Promise<ProjectActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/meta`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(token)
    },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<ProjectActionResponse>(response);
}

export async function fetchProjectHistory(
  token: string,
  projectId: number
): Promise<ProjectHistoryResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/history`, {
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectHistoryResponse>(response);
}

export async function fetchProjectRevisions(
  token: string,
  projectId: number
): Promise<ProjectRevisionListResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/revisions`, {
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectRevisionListResponse>(response);
}

export async function createProjectRevision(
  token: string,
  projectId: number,
  payload: { title?: string; comment?: string }
): Promise<ProjectRevisionActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/revisions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(token)
    },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<ProjectRevisionActionResponse>(response);
}

export async function fetchProjectRevision(
  token: string,
  projectId: number,
  revisionId: string
): Promise<ProjectRevisionDetailResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/revisions/${revisionId}`, {
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectRevisionDetailResponse>(response);
}

export async function fetchProjectRevisionElements(
  token: string,
  projectId: number,
  revisionId: string
): Promise<ProjectRevisionElementsResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/projects/${projectId}/revisions/${revisionId}/elements`,
    {
      headers: buildAuthHeaders(token)
    }
  );
  return parseJsonResponse<ProjectRevisionElementsResponse>(response);
}

export async function fetchProjectRevisionDiff(
  token: string,
  projectId: number,
  revisionId: string,
  againstRevisionId: string
): Promise<ProjectRevisionDiffResponse> {
  const params = new URLSearchParams({ against: againstRevisionId });
  const response = await fetch(
    `${API_BASE}/api/v1/projects/${projectId}/revisions/${revisionId}/diff?${params.toString()}`,
    {
      headers: buildAuthHeaders(token)
    }
  );
  return parseJsonResponse<ProjectRevisionDiffResponse>(response);
}

export async function restoreProjectRevisionToWorkspace(
  token: string,
  projectId: number,
  revisionId: string
): Promise<ProjectRevisionActionResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/projects/${projectId}/revisions/${revisionId}/restore-to-workspace`,
    {
      method: "POST",
      headers: buildAuthHeaders(token)
    }
  );
  return parseJsonResponse<ProjectRevisionActionResponse>(response);
}

export async function markProjectRevisionCurrent(
  token: string,
  projectId: number,
  revisionId: string
): Promise<ProjectRevisionActionResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/projects/${projectId}/revisions/${revisionId}/mark-current`,
    {
      method: "POST",
      headers: buildAuthHeaders(token)
    }
  );
  return parseJsonResponse<ProjectRevisionActionResponse>(response);
}

export async function archiveProject(
  token: string,
  projectId: number
): Promise<ProjectActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/archive`, {
    method: "POST",
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectActionResponse>(response);
}

export async function restoreProject(
  token: string,
  projectId: number
): Promise<ProjectActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/restore`, {
    method: "POST",
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectActionResponse>(response);
}

export async function fetchProjectEditor(
  token: string,
  projectId: number
): Promise<ProjectEditorPayload> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/editor`, {
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectEditorPayload>(response);
}

export async function saveProjectEditor(
  token: string,
  projectId: number,
  rows: ScriptElementRow[]
): Promise<SaveScriptElementsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/editor`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(token)
    },
    body: JSON.stringify({ rows })
  });
  return parseJsonResponse<SaveScriptElementsResponse>(response);
}

export async function fetchProjectWorkspace(
  token: string,
  projectId: number
): Promise<ProjectWorkspacePayload> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/workspace`, {
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<ProjectWorkspacePayload>(response);
}

export async function updateProjectWorkspace(
  token: string,
  projectId: number,
  payload: { file_root?: string; file_roots?: string[]; project_note: string }
): Promise<WorkspaceActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/workspace`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(token)
    },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse<WorkspaceActionResponse>(response);
}

export async function addProjectComment(
  token: string,
  projectId: number,
  text: string
): Promise<ProjectCommentItem> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(token)
    },
    body: JSON.stringify({ text })
  });
  return parseJsonResponse<ProjectCommentItem>(response);
}

export async function deleteProjectComment(
  token: string,
  projectId: number,
  commentId: number
): Promise<WorkspaceActionResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/projects/${projectId}/comments/${commentId}`,
    {
      method: "DELETE",
      headers: buildAuthHeaders(token)
    }
  );
  return parseJsonResponse<WorkspaceActionResponse>(response);
}

export async function uploadProjectFile(
  token: string,
  projectId: number,
  file: File
): Promise<ProjectFileItem> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/files/upload`, {
    method: "POST",
    headers: buildAuthHeaders(token),
    body: formData
  });
  return parseJsonResponse<ProjectFileItem>(response);
}

export async function deleteProjectFile(
  token: string,
  projectId: number,
  fileId: number
): Promise<WorkspaceActionResponse> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/files/${fileId}`, {
    method: "DELETE",
    headers: buildAuthHeaders(token)
  });
  return parseJsonResponse<WorkspaceActionResponse>(response);
}

export async function downloadProjectFile(
  token: string,
  projectId: number,
  fileId: number
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/files/${fileId}/download`, {
    headers: buildAuthHeaders(token)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : "Ошибка скачивания файла";
    throw new Error(detail);
  }
  const disposition = response.headers.get("content-disposition");
  const fileName = extractFileNameFromDisposition(disposition) || `project_file_${fileId}`;
  return {
    blob: await response.blob(),
    fileName
  };
}

export async function downloadProjectExport(
  token: string,
  projectId: number,
  format: "docx" | "pdf"
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/export/${format}`, {
    headers: buildAuthHeaders(token)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : "Ошибка экспорта";
    throw new Error(detail);
  }
  const disposition = response.headers.get("content-disposition");
  const fileName =
    extractFileNameFromDisposition(disposition) ||
    `newscast_project_${projectId}.${format}`;
  return {
    blob: await response.blob(),
    fileName
  };
}
