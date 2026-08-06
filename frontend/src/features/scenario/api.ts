import { apiRequest, apiResponse } from "../../shared/api/client";
import type {
  ScenarioDocxDownload,
  ScenarioDocxExportRequest,
  ScenarioLease,
  ScenarioSaveAck,
  ScenarioSnapshot,
  ScenarioRow,
} from "./types";

const scenarioPath = (storyId: number) => `/api/v1/stories/${storyId}/scenario`;

export const fetchScenario = (storyId: number) => apiRequest<ScenarioSnapshot>(scenarioPath(storyId));
export const markScenarioOpened = (storyId: number, revision: number, context: "video" | "titles") =>
  apiRequest(`${scenarioPath(storyId)}/opened`, {
    method: "POST",
    body: JSON.stringify({ revision, context }),
  });
export const acquireScenarioLease = (storyId: number) => apiRequest<ScenarioLease>(`${scenarioPath(storyId)}/lease`, { method: "POST", body: "{}" });
export const heartbeatScenarioLease = (storyId: number, lease: Pick<ScenarioLease, "edit_session_id" | "lease_token">) =>
  apiRequest<{ ok: true; expires_at: string }>(`${scenarioPath(storyId)}/lease/heartbeat`, { method: "POST", body: JSON.stringify(lease) });
export const releaseScenarioLease = (
  storyId: number,
  lease: Pick<ScenarioLease, "edit_session_id" | "lease_token">,
  keepalive = false,
) => apiRequest(`${scenarioPath(storyId)}/lease`, {
  method: "DELETE",
  body: JSON.stringify({ edit_session_id: lease.edit_session_id, lease_token: lease.lease_token }),
  keepalive,
});
export const saveScenario = (storyId: number, payload: {
  base_revision: number; client_save_id: string; edit_session_id: number; lease_token: string; rows: ScenarioRow[];
}) => apiRequest<ScenarioSaveAck>(scenarioPath(storyId), { method: "PUT", body: JSON.stringify(payload) });

function exportFilename(response: Response, storyId: number): string {
  const disposition = response.headers.get("Content-Disposition");
  const encoded = disposition?.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]?.trim();
  if (encoded) {
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded) return decoded;
    } catch {
      // Fall through to the deterministic client-side name.
    }
  }
  return `Scenario-${storyId}.docx`;
}

export async function exportScenarioDocx(
  storyId: number,
  payload: ScenarioDocxExportRequest,
): Promise<ScenarioDocxDownload> {
  const response = await apiResponse(`${scenarioPath(storyId)}/export-docx`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    blob: await response.blob(),
    filename: exportFilename(response, storyId),
  };
}
