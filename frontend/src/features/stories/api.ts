import { apiRequest } from "../../shared/api/client";
import type { CommandAck } from "../../shared/contracts";
import type {
  ActionRef,
  StoryCreateOptions,
  StoryListItem,
  StoryListQuery,
  StoryListResponse,
} from "./types";

export function fetchStories(query: StoryListQuery): Promise<StoryListResponse> {
  const params = new URLSearchParams({ scope: query.scope });
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.rubric_id) params.set("rubric_id", String(query.rubric_id));
  if (query.priority) params.set("priority", query.priority);
  if (query.area) params.set("area", query.area);
  if (query.mine) params.set("mine", "true");
  params.set("limit", String(query.limit ?? 50));
  return apiRequest<StoryListResponse>(`/api/v1/stories?${params.toString()}`);
}

export function fetchStory(storyId: number): Promise<StoryListItem> {
  return apiRequest<StoryListItem>(`/api/v1/stories/${storyId}`);
}

export function fetchStoryCreateOptions(): Promise<StoryCreateOptions> {
  return apiRequest<StoryCreateOptions>("/api/v1/stories/create-options");
}

export function createStory(
  action: ActionRef,
  payload: { title: string; rubric_id: number; author_user_id?: number },
): Promise<CommandAck> {
  return apiRequest<CommandAck>(action.href, {
    method: action.method,
    body: JSON.stringify(payload),
  });
}

export function runStoryLifecycleAction(action: ActionRef): Promise<CommandAck> {
  return apiRequest<CommandAck>(action.href, {
    method: action.method,
    body: "{}",
  });
}

export function updateStoryMetadata(
  storyId: number,
  payload: { title?: string; rubric_id?: number },
): Promise<CommandAck> {
  return apiRequest<CommandAck>(`/api/v1/stories/${storyId}/metadata`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
