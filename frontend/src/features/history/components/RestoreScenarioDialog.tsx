import { useEffect, useRef } from "react";

import type { ActionRef, EditSessionHistoryItem } from "../types";

interface RestoreScenarioDialogProps {
  session: EditSessionHistoryItem;
  action: ActionRef;
  submitting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function RestoreScenarioDialog({
  session,
  action,
  submitting,
  error,
  onCancel,
  onConfirm,
}: RestoreScenarioDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div className="history-dialog-backdrop">
      <section
        className="history-restore-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-restore-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting) onCancel();
        }}
      >
        <div className="history-restore-dialog-head">
          <div>
            <p className="muted small">Редакции {session.from_revision} → {session.to_revision}</p>
            <h3 id="history-restore-title">Восстановить состояние сценария</h3>
          </div>
        </div>
        <div className="history-restore-dialog-body">
          <p>{action.confirmation ?? "Будет создана новая актуальная редакция сценария."}</p>
          <p className="muted">Текущая и последующая история останутся доступны.</p>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </div>
        <div className="history-restore-dialog-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>Отмена</button>
          <button ref={confirmRef} type="button" className="danger" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Восстановление..." : "Создать новую актуальную редакцию"}
          </button>
        </div>
      </section>
    </div>
  );
}
