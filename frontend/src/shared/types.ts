export type ProjectsView = "main" | "archive";

export type ProjectStatusValue =
  | "draft"
  | "reviewed"
  | "in_editing"
  | "in_proofreading"
  | "ready"
  | "delivered"
  | "archived";

export interface UserPublic {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface UserListItem {
  id: number;
  username: string;
  role: string;
  is_active: boolean;
}

export interface UserListResponse {
  items: UserListItem[];
  total: number;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: UserPublic;
}

export interface ProjectListItem {
  id: number;
  title: string;
  status: string;
  rubric?: string | null;
  planned_duration?: string | null;
  source_project_id?: number | null;
  author_user_id?: number | null;
  author_username?: string | null;
  executor_user_id?: number | null;
  executor_user_ids?: number[];
  executor_username?: string | null;
  proofreader_user_id?: number | null;
  proofreader_username?: string | null;
  archived_at?: string | null;
  archived_by_user_id?: number | null;
  archived_by_username?: string | null;
  status_changed_at?: string | null;
  status_changed_by_user_id?: number | null;
  created_at?: string | null;
}

export interface ProjectListResponse {
  items: ProjectListItem[];
  total: number;
}

export interface ProjectActionResponse {
  ok: boolean;
  message: string;
  project: ProjectListItem;
}

export interface ProjectFilters {
  search?: string;
  status?: string[];
  rubric?: string;
  participant?: string;
  created_from?: string;
  created_to?: string;
  archived_by?: string;
  archived_from?: string;
  archived_to?: string;
}

export interface ProjectMetaUpdatePayload {
  title?: string | null;
  rubric?: string | null;
  planned_duration?: string | null;
  status?: ProjectStatusValue | string | null;
  author_user_id?: number | null;
  executor_user_id?: number | null;
  executor_user_ids?: number[] | null;
  proofreader_user_id?: number | null;
}

export interface ProjectHistoryItem {
  id: number;
  event_type: string;
  old_value?: string | null;
  new_value?: string | null;
  actor_user_id?: number | null;
  actor_username: string;
  created_at?: string | null;
  meta_json?: string | null;
}

export interface ProjectHistoryResponse {
  items: ProjectHistoryItem[];
  total: number;
}

export type BlockTypeCode = "podvodka" | "zk" | "zk_geo" | "life" | "snh";

export interface ScriptElementFormattingTarget {
  font_family: string;
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  fill_color: string;
}

export interface ScriptElementFormatting {
  targets?: Record<string, ScriptElementFormattingTarget>;
  html_by_target?: Record<string, string>;
}

export interface ScriptElementRichTextTarget {
  editor: string;
  text: string;
  html: string;
  doc?: Record<string, unknown>;
}

export interface ScriptElementRichText {
  schema_version?: number;
  targets?: Record<string, ScriptElementRichTextTarget>;
}

export interface ScriptElementRow {
  id?: number | null;
  segment_uid?: string | null;
  order_index: number;
  block_type: BlockTypeCode | string;
  text: string;
  speaker_text: string;
  file_name: string;
  tc_in: string;
  tc_out: string;
  additional_comment: string;
  structured_data: Record<string, unknown>;
  formatting: ScriptElementFormatting;
  rich_text: ScriptElementRichText;
}

export interface ProjectEditorPayload {
  project: ProjectListItem;
  elements: ScriptElementRow[];
}

export interface SaveScriptElementsResponse {
  ok: boolean;
  message: string;
  updated: number;
  inserted: number;
  removed: number;
  total: number;
  elements: ScriptElementRow[];
}

export interface ProjectWorkspaceMeta {
  file_root: string;
  file_roots: string[];
  project_note: string;
}

export interface ProjectCommentItem {
  id: number;
  text: string;
  created_at?: string | null;
  author_user_id?: number | null;
  author_username: string;
}

export interface ProjectFileItem {
  id: number;
  original_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at?: string | null;
  uploaded_by_user_id?: number | null;
  uploaded_by_username: string;
  exists_on_disk: boolean;
}

export interface ProjectWorkspacePayload {
  project: ProjectListItem;
  workspace: ProjectWorkspaceMeta;
  comments: ProjectCommentItem[];
  files: ProjectFileItem[];
}

export interface WorkspaceActionResponse {
  ok: boolean;
  message: string;
}
