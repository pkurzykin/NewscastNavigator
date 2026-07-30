import { apiRequest } from "../../shared/api/client";
import type { CommandAck } from "../../shared/contracts";
import type { ProductionAction, ProductionReadModel } from "./types";


export const fetchProduction = (storyId: number) =>
  apiRequest<ProductionReadModel>(`/api/v1/stories/${storyId}/production`);

export const runProductionAction = (
  action: ProductionAction,
  scenarioRevision: number,
  formPayload?: { description: string; assignee_user_id: number },
) => {
  const body = action.code === "video_start" || action.code === "titles_start"
    ? { revision: scenarioRevision }
    : action.code === "voiceover_not_ready"
      ? formPayload ?? {}
      : {};
  return apiRequest<CommandAck>(action.href, {
    method: action.method,
    body: JSON.stringify(body),
  });
};

export const addMaterial = (storyId: number, payload: { title: string; location: string }) =>
  apiRequest<CommandAck>(`/api/v1/stories/${storyId}/materials`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const setAssignment = (storyId: number, kind: string, userId: number) =>
  apiRequest<CommandAck>(`/api/v1/stories/${storyId}/assignments/${kind}`, {
    method: "PUT",
    body: JSON.stringify({ user_id: userId }),
  });

export const removeAssignment = (storyId: number, kind: string) =>
  apiRequest<CommandAck>(`/api/v1/stories/${storyId}/assignments/${kind}`, {
    method: "DELETE",
  });
