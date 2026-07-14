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
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => {
    if (submitting) dialogRef.current?.focus();
  }, [submitting]);

  return (
    <div className="history-dialog-backdrop">
      <section
        ref={dialogRef}
        className="history-restore-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-restore-title"
        aria-busy={submitting}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting) onCancel();
          if (event.key !== "Tab") return;
          if (submitting) {
            event.preventDefault();
            dialogRef.current?.focus();
            return;
          }
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? [],
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) return;
          if (document.activeElement === dialogRef.current) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
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
