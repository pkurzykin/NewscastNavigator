import { useMemo, useState } from "react";

import { runWorkflowAction } from "../api";
import type { WorkflowAction, WorkflowReadModel } from "../types";


interface Props {
  workflow: WorkflowReadModel;
  revision: number;
  disabled?: boolean;
  beforeAction?: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
}

export default function WorkflowActions({ workflow, revision, disabled = false, beforeAction, onRefresh }: Props) {
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const actions = useMemo(
    () => [workflow.primary_action, ...workflow.additional_actions].filter(
      (action): action is WorkflowAction => action !== null,
    ),
    [workflow],
  );

  const execute = async (action: WorkflowAction) => {
    if (pendingCode !== null) return;
    setPendingCode(action.code);
    setError("");
    try {
      await beforeAction?.();
      await runWorkflowAction(action, revision);
      await onRefresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось выполнить действие. Повторите попытку.");
    } finally {
      setPendingCode(null);
    }
  };

  if (actions.length === 0) return null;
  return (
    <section className="workflow-actions" aria-label="Действия редакционного процесса">
      <div className="workflow-action-buttons">
        {actions.map((action) => (
          <button
            key={action.code}
            type="button"
            className={action.emphasis === "primary" ? "primary" : undefined}
            disabled={disabled || pendingCode !== null}
            onClick={() => void execute(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
      {error ? <p className="error workflow-action-error" role="alert">{error} Можно повторить действие.</p> : null}
    </section>
  );
}
