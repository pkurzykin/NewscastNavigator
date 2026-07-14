import type { EditorCoreRichTextTarget } from "../editor-core/types";

export interface ScenarioFormattingTarget {
  font_family?: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  fill_color?: string;
}

export interface ScenarioRow {
  segment_uid: string;
  order_index: number;
  block_type: "podvodka" | "zk" | "zk_geo" | "life" | "snh";
  text: string;
  speaker_text: string;
  file_name: string;
  tc_in: string;
  tc_out: string;
  additional_comment: string;
  structured_data: Record<string, unknown>;
  formatting: { targets?: Record<string, ScenarioFormattingTarget> };
  rich_text: { schema_version: number; targets?: Record<string, EditorCoreRichTextTarget> };
}

export interface ScenarioSnapshot {
  story: { id: number; title: string };
  scenario: { revision: number; rows: ScenarioRow[] };
  edit: {
    state: "available" | "mine" | "held" | "archived";
    edit_session_id?: number | null;
    holder?: { id: number; display_name: string } | null;
    expires_at?: string | null;
  };
  captionpanels: ScenarioCaptionPanelsState;
}

export interface ScenarioCaptionPanelsState {
  eligible: boolean;
  last_opened_revision: number | null;
  changed_since_last_open: boolean;
  diff_session_id: number | null;
}

export interface ScenarioLease {
  edit_session_id: number;
  lease_token: string;
  expires_at: string;
  revision: number;
}

export interface ScenarioSaveAck {
  ok: true;
  client_save_id: string;
  revision: number;
  saved_at: string;
}

export interface ScenarioDraft {
  revision: number;
  rows: ScenarioRow[];
  saved_at: string;
}
