import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useId } from "react";

interface ConfirmationDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmColor?: "primary" | "error";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmationDialog({
  open,
  title = "Подтвердите действие",
  message,
  confirmLabel,
  cancelLabel = "Отмена",
  confirmColor = "primary",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const titleId = useId();
  return (
    <Dialog
      open={open}
      aria-labelledby={titleId}
      onClose={(_event, reason) => {
        if (reason === "backdropClick" || busy) return;
        onCancel();
      }}
      slotProps={{
        backdrop: { onMouseDown: (event) => event.preventDefault() },
        paper: { role: "alertdialog", "aria-busy": busy },
      }}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent dividers>
        <DialogContentText color="text.primary">{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button type="button" variant="outlined" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant="contained"
          color={confirmColor}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
