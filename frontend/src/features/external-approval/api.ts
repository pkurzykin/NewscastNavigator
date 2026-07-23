import { apiRequest } from "../../shared/api/client";
import type { ProductionAction } from "../production/types";
import type {
  ExternalApprovalReadModel,
  ExternalApprovalResultPayload,
} from "./types";


export const fetchExternalApprovalCycles = (href: string) =>
  apiRequest<ExternalApprovalReadModel>(href);

export const executeExternalApprovalAction = (
  action: ProductionAction,
  payload: ExternalApprovalResultPayload | Record<string, never>,
) => apiRequest(action.href, {
  method: action.method,
  body: JSON.stringify(payload),
});
