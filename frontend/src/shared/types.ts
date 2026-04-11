export type ProjectsView = "main" | "archive";

export type ProjectStatusValue =
  | "draft"
  | "reviewed"
  | "in_editing"
  | "in_proofreading"
  | "ready"
  | "delivered"
  | "archived";

export type TitlesStatusValue =
  | "not_started"
  | "in_progress"
  | "review"
  | "changes_requested"
  | "done";

export type EditStatusValue =
  | "not_started"
  | "in_progress"
  | "review"
  | "changes_requested"
  | "done";

export type VoiceoverStatusValue =
  | "not_started"
  | "in_progress"
  | "review"
  | "changes_requested"
  | "done";

export type FinalReviewStatusValue =
  | "not_started"
  | "submitted"
  | "changes_requested"
  | "approved";

export interface UserPublic {
  id: number;
  username: string;
  full_name?: string | null;
  job_title?: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface UserListItem {
  id: number;
  username: string;
  full_name?: string | null;
  job_title?: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
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

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
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
  text_seq?: number;
  current_text_seq?: number | null;
  current_text_set_at?: string | null;
  current_text_set_by_user_id?: number | null;
  checked_text_seq?: number | null;
  checked_at?: string | null;
  checked_by_user_id?: number | null;
  proofread_text_seq?: number | null;
  proofread_at?: string | null;
  proofread_by_user_id?: number | null;
  current_text_is_latest?: boolean;
  checked_text_is_current?: boolean;
  proofread_text_is_current?: boolean;
  latest_text_is_checked?: boolean;
  latest_text_is_proofread?: boolean;
  titles_status?: TitlesStatusValue | string;
  titles_text_seq?: number | null;
  titles_updated_at?: string | null;
  titles_updated_by_user_id?: number | null;
  titles_text_is_latest?: boolean;
  titles_text_is_current?: boolean;
  titles_text_is_proofread?: boolean;
  titles_requires_resync?: boolean;
  edit_status?: EditStatusValue | string;
  edit_text_seq?: number | null;
  edit_updated_at?: string | null;
  edit_updated_by_user_id?: number | null;
  edit_text_is_current?: boolean;
  edit_text_is_latest?: boolean;
  edit_requires_resync?: boolean;
  voiceover_status?: VoiceoverStatusValue | string;
  voiceover_text_seq?: number | null;
  voiceover_updated_at?: string | null;
  voiceover_updated_by_user_id?: number | null;
  voiceover_text_is_latest?: boolean;
  voiceover_text_is_current?: boolean;
  voiceover_text_is_proofread?: boolean;
  voiceover_requires_resync?: boolean;
  final_review_status?: FinalReviewStatusValue | string;
  final_review_updated_at?: string | null;
  final_review_updated_by_user_id?: number | null;
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

export interface ProjectTextStateActionPayload {
  text_seq?: number | null;
}

export interface ProjectTitlesTextSyncPayload {
  text_seq?: number | null;
}

export interface ProjectTitlesStatusPayload {
  status: TitlesStatusValue | string;
}

export interface ProjectEditTextSyncPayload {
  text_seq?: number | null;
}

export interface ProjectEditStatusPayload {
  status: EditStatusValue | string;
}

export interface ProjectVoiceoverTextSyncPayload {
  text_seq?: number | null;
}

export interface ProjectVoiceoverStatusPayload {
  status: VoiceoverStatusValue | string;
}

export interface ProjectFinalReviewStatusPayload {
  status: FinalReviewStatusValue | string;
}

export interface ProjectTextStateDiffHeaderItem {
  field: string;
  before?: string | null;
  after?: string | null;
}

export interface ProjectTextStateDiffRowItem {
  segment_uid: string;
  change_types: string[];
  changed_fields: string[];
  order_before?: number | null;
  order_after?: number | null;
  before_row?: ScriptElementRow | null;
  after_row?: ScriptElementRow | null;
}

export interface ProjectTextStateDiffSummary {
  added: number;
  removed: number;
  changed: number;
  moved: number;
  total: number;
}

export interface ProjectTextStateDiffResponse {
  snapshot_kind: string;
  snapshot_text_seq: number;
  workspace_text_seq: number;
  snapshot_created_at?: string | null;
  snapshot_created_by_user_id?: number | null;
  is_outdated: boolean;
  header_changes: ProjectTextStateDiffHeaderItem[];
  row_changes: ProjectTextStateDiffRowItem[];
  summary: ProjectTextStateDiffSummary;
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

export interface ProjectRevisionItem {
  id: string;
  project_id: number;
  revision_no: number;
  parent_revision_id?: string | null;
  branch_key: string;
  revision_kind: string;
  status: string;
  title: string;
  comment: string;
  project_title: string;
  project_rubric?: string | null;
  project_planned_duration?: string | null;
  created_by_user_id?: number | null;
  created_by_username?: string | null;
  created_at?: string | null;
  is_current: boolean;
}

export interface ProjectRevisionListResponse {
  items: ProjectRevisionItem[];
  total: number;
}

export interface ProjectRevisionDetailResponse {
  revision: ProjectRevisionItem;
}

export interface ProjectRevisionElementsResponse {
  revision: ProjectRevisionItem;
  elements: ScriptElementRow[];
}

export interface ProjectRevisionHeaderDiffItem {
  field: string;
  before?: string | null;
  after?: string | null;
}

export interface ProjectRevisionRowDiffItem {
  segment_uid: string;
  change_types: string[];
  changed_fields: string[];
  order_before?: number | null;
  order_after?: number | null;
  before_row?: ScriptElementRow | null;
  after_row?: ScriptElementRow | null;
}

export interface ProjectRevisionDiffSummary {
  added: number;
  removed: number;
  changed: number;
  moved: number;
  total: number;
}

export interface ProjectRevisionDiffResponse {
  revision: ProjectRevisionItem;
  against_revision: ProjectRevisionItem;
  header_changes: ProjectRevisionHeaderDiffItem[];
  row_changes: ProjectRevisionRowDiffItem[];
  summary: ProjectRevisionDiffSummary;
}

export interface ProjectRevisionActionResponse {
  ok: boolean;
  message: string;
  revision: ProjectRevisionItem;
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
  project: ProjectListItem;
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
