import { apiRequest } from "../../shared/api/client";
import type {
  ActionRef,
  RestoreScenarioResponse,
  ScenarioSessionDiffResponse,
  StoryHistoryResponse,
} from "./types";

export function fetchStoryHistory(storyId: number, cursor?: string | null): Promise<StoryHistoryResponse> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return apiRequest<StoryHistoryResponse>(`/api/v1/stories/${storyId}/history?${params.toString()}`);
}

export function fetchScenarioSessionDiff(diffHref: string): Promise<ScenarioSessionDiffResponse> {
  return apiRequest<ScenarioSessionDiffResponse>(diffHref);
}

export function restoreScenarioSession(action: ActionRef): Promise<RestoreScenarioResponse> {
  return apiRequest<RestoreScenarioResponse>(action.href, {
    method: "POST",
    body: "{}",
  });
}
