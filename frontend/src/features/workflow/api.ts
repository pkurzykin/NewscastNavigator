import { apiRequest } from "../../shared/api/client";
import type { CommandAck } from "../../shared/contracts";
import type { WorkflowAction, WorkflowReadModel } from "./types";


export const fetchWorkflow = (storyId: number) =>
  apiRequest<WorkflowReadModel>(`/api/v1/stories/${storyId}/workflow`);

export const runWorkflowAction = (action: WorkflowAction, revision: number) =>
  apiRequest<CommandAck>(action.href, {
    method: action.method,
    body: JSON.stringify({ revision }),
  });
