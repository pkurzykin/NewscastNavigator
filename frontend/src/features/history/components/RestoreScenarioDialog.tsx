import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useEffect, useRef } from "react";
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
  const dialogRef = useRef<HTMLDivElement>(null);
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
    <Dialog
      open
      aria-labelledby="history-restore-title"
      onClose={() => {
        if (!submitting) onCancel();
      }}
      slotProps={{
        paper: { ref: dialogRef, tabIndex: -1, "aria-busy": submitting },
        transition: { onEntered: () => cancelRef.current?.focus() },
      }}
    >
      <DialogTitle id="history-restore-title">Восстановить состояние сценария</DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gap: 2 }}>
        <DialogContentText component="p" color="text.primary">
          Состояние после правок: <strong>{session.actor.display_name}</strong> · {formatDateTime(session.ended_at)}.
        </DialogContentText>
        <DialogContentText component="p" color="text.primary">
          {action.confirmation ?? "Выбранное состояние станет актуальным. Последующая история сохранится."}
        </DialogContentText>
        <DialogContentText component="p">
          Текущая и последующая история останутся доступны.
        </DialogContentText>
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button ref={cancelRef} autoFocus variant="outlined" color="inherit" onClick={onCancel} disabled={submitting}>Отмена</Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={submitting}>
          {submitting ? "Восстановление..." : "Восстановить состояние"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
