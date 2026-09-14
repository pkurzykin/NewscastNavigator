import { useEffect, useRef } from "react";
import Button from "@mui/material/Button";
import { formatDateTime } from "../../../shared/date";

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
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
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
            <h3 id="history-restore-title">Восстановить состояние сценария</h3>
          </div>
        </div>
        <div className="history-restore-dialog-body">
          <p>Состояние после правок: <strong>{session.actor.display_name}</strong> · {formatDateTime(session.ended_at)}.</p>
          <p>{action.confirmation ?? "Выбранное состояние станет актуальным. Последующая история сохранится."}</p>
          <p className="muted">Текущая и последующая история останутся доступны.</p>
          {error ? <p className="error" role="alert">{error}</p> : null}
        </div>
        <div className="history-restore-dialog-actions">
          <Button ref={cancelRef} variant="outlined" onClick={onCancel} disabled={submitting}>Отмена</Button>
          <Button variant="contained" color="error" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Восстановление..." : "Восстановить состояние"}
          </Button>
        </div>
      </section>
    </div>
  );
}
