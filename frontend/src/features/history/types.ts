import type { CommandAck, StoryListItem, UserRef } from "../../shared/contracts";
import type { EditorCoreRichTextTarget } from "../editor-core/types";
import type { ScenarioFormattingTarget } from "../scenario/types";

export type ActionMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ActionRef {
  code: string;
  label: string;
  method: ActionMethod;
  href: string;
  emphasis: "primary" | "normal" | "danger";
  confirmation: string | null;
  form: "correction_package" | "external_result" | "return_reason" | null;
}

export interface ScenarioDiffSummary {
  added: number;
  removed: number;
  changed: number;
  moved: number;
  total: number;
}

export interface EditSessionHistoryItem {
  kind: "edit_session";
  id: number;
  actor: UserRef;
  started_at: string;
  ended_at: string;
  from_revision: number;
  to_revision: number;
  diff_summary: ScenarioDiffSummary;
  diff_href: string;
  available_actions: ActionRef[];
}

export interface WorkflowEventHistoryItem {
  kind: "workflow_event";
  id: number;
  event_code: string;
  label: string;
  summary: string | null;
  actor: UserRef | null;
  at: string;
  diff_href: string | null;
  available_actions: ActionRef[];
}

export type StoryHistoryItem = EditSessionHistoryItem | WorkflowEventHistoryItem;

export interface StoryHistoryResponse {
  story: StoryListItem;
  items: StoryHistoryItem[];
  next_cursor: string | null;
}

export interface ScenarioRowSnapshot {
  order_index?: number;
  block_type?: string;
  text?: string;
  speaker_text?: string;
  file_name?: string;
  tc_in?: string;
  tc_out?: string;
  additional_comment?: string;
  structured_data?: Record<string, unknown>;
  formatting?: {
    targets?: Record<string, ScenarioFormattingTarget>;
  };
  rich_text?: {
    schema_version?: number;
    targets?: Record<string, Partial<EditorCoreRichTextTarget>>;
  };
  [key: string]: unknown;
}

export interface ScenarioRowDiff {
  segment_uid: string;
  kind: "added" | "removed" | "changed" | "moved";
  moved: boolean;
  changed_fields: string[];
  before: ScenarioRowSnapshot | null;
  after: ScenarioRowSnapshot | null;
}

export interface ScenarioSessionDiffResponse {
  story: StoryListItem;
  session: EditSessionHistoryItem;
  changes: ScenarioRowDiff[];
}

export type RestoreScenarioResponse = CommandAck;
