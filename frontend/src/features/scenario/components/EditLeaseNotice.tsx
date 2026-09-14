import type { ScenarioSnapshot } from "../types";

export default function EditLeaseNotice({ edit, error, owned = false }: { edit: ScenarioSnapshot["edit"]; error: string; owned?: boolean }) {
  if (error) return <p className="scenario-lease-notice error" role="alert">{error}</p>;
  if (edit.state === "mine" && !owned) return <p className="scenario-lease-notice muted" role="status">Сценарий открыт вами в другом окне.</p>;
  if (edit.state === "held") return <p className="scenario-lease-notice muted" role="status">Сценарий редактирует {edit.holder?.display_name || "другой сотрудник"}.</p>;
  if (edit.state === "archived") return <p className="scenario-lease-notice muted" role="status">Архивный сценарий доступен только для чтения.</p>;
  return null;
}
