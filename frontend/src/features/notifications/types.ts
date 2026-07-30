import type { CodeLabel, CommandAck, UserRef } from "../../shared/contracts";


export interface NotificationStoryRef {
  id: number;
  title: string;
  priority: CodeLabel;
}

export interface NotificationAction {
  code: string;
  label: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  href: string;
  emphasis: "primary" | "normal" | "danger";
  confirmation: string | null;
  form: "correction_package" | "external_result" | "return_reason" | null;
  part_id?: number | null;
  part_scope?: "text" | "video" | "titles" | "voiceover" | null;
}

export interface PersonalAction {
  id: string;
  story: NotificationStoryRef;
  summary: string;
  target_href: string;
  action: NotificationAction;
}

export interface PersonalActionsResponse {
  items: PersonalAction[];
  total: number;
}

export interface NotificationDiffSummary {
  added: number;
  removed: number;
  changed: number;
  moved: number;
  total: number;
}

export interface NotificationDiffChange {
  segment_uid: string;
  kind: "added" | "removed" | "changed" | "moved";
  moved?: boolean;
  changed_fields?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface NotificationDiff {
  from_revision: number;
  to_revision: number;
  summary: NotificationDiffSummary;
  changes: NotificationDiffChange[];
  href: string | null;
}

export interface InternalNotification {
  id: number;
  kind: string;
  story: NotificationStoryRef;
  actor: UserRef | null;
  title: string;
  summary: string;
  target_href: string;
  diff: NotificationDiff | null;
  created_at: string;
  updated_at: string;
  read_at: string | null;
}

export interface NotificationListResponse {
  items: InternalNotification[];
  total: number;
  unread_count: number;
}

export type NotificationReadAck = CommandAck;
