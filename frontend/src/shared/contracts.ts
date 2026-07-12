export interface UserRef {
  id: number;
  username: string;
  display_name: string;
  position: string;
  function_codes: string[];
}

export interface CurrentUser extends UserRef {
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
}

export interface RubricRef {
  id: number;
  name: string;
}

export interface CodeLabel {
  code: string;
  label: string;
}

export interface AssignmentRef {
  kind: string;
  user: UserRef;
}

export interface StoryListItem {
  id: number;
  title: string;
  priority: CodeLabel;
  rubric: RubricRef;
  author: UserRef;
  situation: CodeLabel;
  assignments: AssignmentRef[];
  created_at: string;
  archived_at: string | null;
}

export interface StoryListResponse {
  items: StoryListItem[];
  total: number;
}

export interface StoryListQuery {
  scope: "active" | "archive";
  search?: string;
  rubric_id?: number;
  priority?: "standard" | "high";
  area?: "scenario" | "video" | "titles" | "voiceover" | "external";
  mine?: boolean;
  limit?: number;
}

export interface LoginResponse {
  user: CurrentUser;
}

export interface CommandAck {
  ok: true;
  event_id: string | null;
  changed_at: string;
  resource: { type: string; id: number } | null;
}

export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}
