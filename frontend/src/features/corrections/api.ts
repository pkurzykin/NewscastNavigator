import { apiRequest } from "../../shared/api/client";
import type { CommandAck } from "../../shared/contracts";
import type {
  CorrectionAction,
  CorrectionPackageCreatePayload,
  CorrectionPackagesResponse,
} from "./types";


export const fetchCorrectionPackages = (href: string) =>
  apiRequest<CorrectionPackagesResponse>(href);

export const createCorrectionPackage = (
  action: CorrectionAction,
  payload: CorrectionPackageCreatePayload,
) => apiRequest<CommandAck>(action.href, {
  method: action.method,
  body: JSON.stringify(payload),
});

const completionAction = (action: CorrectionAction) => {
  if (action.part_scope === "video") return "video_ready";
  if (action.part_scope === "titles") return "titles_ready";
  return "none";
};

export const runCorrectionAction = (
  action: CorrectionAction,
  payload: { reason?: string } = {},
) => {
  const body = action.code === "correction_part_complete"
    ? { completion_action: completionAction(action) }
    : action.code === "correction_part_return"
      ? { reason: payload.reason?.trim() ?? "" }
      : {};
  return apiRequest<CommandAck>(action.href, {
    method: action.method,
    body: JSON.stringify(body),
  });
};
