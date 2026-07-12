import type { EditorCoreRichTextTarget } from "../editor-core/types";

/**
 * Временный контракт CP2. Он сохраняет табличный редактор до перехода на
 * revision-safe API сценария в CP3 и не является вторым пользовательским режимом.
 */
export interface ScriptElementFormattingTarget {
  font_family?: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  fill_color?: string;
}

export interface ScriptElementFormatting {
  targets?: Record<string, ScriptElementFormattingTarget>;
}

export type ScriptElementRichTextTarget = EditorCoreRichTextTarget;

export interface ScriptElementRichText {
  schema_version: number;
  targets?: Record<string, ScriptElementRichTextTarget>;
}

export interface ScriptElementRow {
  id: number | null;
  segment_uid: string | null;
  order_index: number;
  block_type: string;
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

export interface LegacyBridgeStory {
  id: number;
  title: string;
}

export interface LegacyBridgeEditorPayload {
  story: LegacyBridgeStory;
  elements: ScriptElementRow[];
}

export interface SaveLegacyBridgeEditorResponse extends LegacyBridgeEditorPayload {
  ok: true;
  message: string;
  updated: number;
  inserted: number;
  removed: number;
  total: number;
}
