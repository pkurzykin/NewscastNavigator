import type { AutosaveStatus as Status } from "../useScenarioAutosave";

export default function AutosaveStatus({ status, error }: { status: Status; error: string }) {
  if (status === "pending") return <span className="scenario-autosave" role="status">Черновик изменен</span>;
  if (status === "saving") return <span className="scenario-autosave" role="status">Автосохранение...</span>;
  if (status === "error") return <span className="scenario-autosave scenario-autosave-error" role="alert">Сценарий остался в редакторе: {error}</span>;
  return <span className="scenario-autosave" aria-live="polite" />;
}
