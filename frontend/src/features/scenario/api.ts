import { apiRequest } from "../../shared/api/client";
import type { ScenarioLease, ScenarioSaveAck, ScenarioSnapshot, ScenarioRow } from "./types";

const scenarioPath = (storyId: number) => `/api/v1/stories/${storyId}/scenario`;

export const fetchScenario = (storyId: number) => apiRequest<ScenarioSnapshot>(scenarioPath(storyId));
export const acquireScenarioLease = (storyId: number) => apiRequest<ScenarioLease>(`${scenarioPath(storyId)}/lease`, { method: "POST", body: "{}" });
export const heartbeatScenarioLease = (storyId: number, lease: Pick<ScenarioLease, "edit_session_id" | "lease_token">) =>
  apiRequest<{ ok: true; expires_at: string }>(`${scenarioPath(storyId)}/lease/heartbeat`, { method: "POST", body: JSON.stringify(lease) });
export const releaseScenarioLease = (storyId: number, lease: Pick<ScenarioLease, "edit_session_id" | "lease_token">) =>
  apiRequest(`${scenarioPath(storyId)}/lease`, { method: "DELETE", body: JSON.stringify(lease) });
export const saveScenario = (storyId: number, payload: {
  base_revision: number; client_save_id: string; edit_session_id: number; lease_token: string; rows: ScenarioRow[];
}) => apiRequest<ScenarioSaveAck>(scenarioPath(storyId), { method: "PUT", body: JSON.stringify(payload) });
