import type { ScenarioSnapshot } from "../types";

export default function EditLeaseNotice({ edit, error }: { edit: ScenarioSnapshot["edit"]; error: string }) {
  if (error) return <p className="scenario-lease-notice error" role="alert">{error}</p>;
  if (edit.state === "held") return <p className="scenario-lease-notice muted" role="status">Сценарий редактирует {edit.holder?.display_name || "другой сотрудник"}.</p>;
  if (edit.state === "archived") return <p className="scenario-lease-notice muted" role="status">Архивный сценарий доступен только для чтения.</p>;
  return null;
}
