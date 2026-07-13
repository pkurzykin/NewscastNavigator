import { useEffect, useState } from "react";
import type { AutosaveStatus as Status } from "../useScenarioAutosave";

export default function AutosaveStatus({ status, error }: { status: Status; error: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (status === "idle" || status === "error") { setVisible(false); return; } const timer = window.setTimeout(() => setVisible(true), 2000); return () => window.clearTimeout(timer); }, [status]);
  if (status === "pending" && visible) return <span className="scenario-autosave" role="status">Черновик изменен</span>;
  if (status === "saving" && visible) return <span className="scenario-autosave" role="status">Автосохранение...</span>;
  if (status === "error") return <span className="scenario-autosave scenario-autosave-error" role="alert">Сценарий остался в редакторе: {error}</span>;
  return <span className="scenario-autosave" aria-live="polite" />;
}
