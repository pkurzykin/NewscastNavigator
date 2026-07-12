import { apiRequest } from "../../shared/api/client";
import type {
  LegacyBridgeEditorPayload,
  SaveLegacyBridgeEditorResponse,
  ScriptElementRow,
} from "./legacyBridgeTypes";

const bridgePath = (storyId: number) => `/api/v1/stories/${storyId}/editor`;

export function fetchLegacyBridgeEditor(storyId: number): Promise<LegacyBridgeEditorPayload> {
  return apiRequest<LegacyBridgeEditorPayload>(bridgePath(storyId));
}

export function saveLegacyBridgeEditor(
  storyId: number,
  rows: ScriptElementRow[]
): Promise<SaveLegacyBridgeEditorResponse> {
  return apiRequest<SaveLegacyBridgeEditorResponse>(bridgePath(storyId), {
    method: "PUT",
    body: JSON.stringify({ rows }),
  });
}
