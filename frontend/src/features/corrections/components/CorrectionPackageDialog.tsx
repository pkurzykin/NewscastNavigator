import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import { type FormEvent, useEffect, useRef, useState } from "react";

import type { UserRef } from "../../../shared/contracts";
import ConfirmationDialog from "../../../shared/ui/ConfirmationDialog";
import type {
  CorrectionAction,
  CorrectionPackageCreatePayload,
  CorrectionScope,
} from "../types";
import CorrectionPartFields, { type CorrectionPartDraft } from "./CorrectionPartFields";

interface Props {
  open: boolean;
  action: CorrectionAction | null;
  assigneeOptions: UserRef[];
  initialScope?: CorrectionScope;
  scopeLocked?: boolean;
  submitLabel?: string;
  mutationPending: boolean;
  onClose: () => void;
  onSubmit: (payload: CorrectionPackageCreatePayload) => Promise<void>;
}

const newPart = (scope: CorrectionScope): CorrectionPartDraft => ({
  key: 0,
  scope,
  description: "",
  assigneeId: "",
});

export default function CorrectionPackageDialog({
  open,
  action,
  assigneeOptions,
  initialScope = "text",
  scopeLocked = false,
  submitLabel = "Добавить правки",
  mutationPending,
  onClose,
  onSubmit,
}: Props) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [part, setPart] = useState<CorrectionPartDraft>(() => newPart(initialScope));
  const [error, setError] = useState("");
  const busy = mutationPending || submitting;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    submittingRef.current = false;
    setSubmitting(false);
    setAwaitingConfirmation(false);
    setPart(newPart(initialScope));
    setError("");
    requestAnimationFrame(() => descriptionRef.current?.focus());
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [initialScope, open]);

  if (!open || !action) return null;

  const valid = Boolean(part.description.trim() && part.assigneeId);
  const performSubmit = async () => {
    if (mutationPending || submittingRef.current || !valid) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        source: "internal",
        parts: [{
          scope: part.scope,
          description: part.description.trim(),
          assignee_user_id: Number(part.assigneeId),
        }],
      });
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось добавить правки");
      requestAnimationFrame(() => descriptionRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutationPending || submittingRef.current || !valid) return;
    if (action.confirmation) {
      setAwaitingConfirmation(true);
      return;
    }
    void performSubmit();
  };

  return (
    <Dialog
      open
      onClose={(_event, reason) => {
        if (reason === "backdropClick") {
          requestAnimationFrame(() => lastFocusedRef.current?.focus());
          return;
        }
        if (busy) return;
        onClose();
      }}
      aria-labelledby="correction-dialog-title"
      slotProps={{
        backdrop: { onMouseDown: (event) => event.preventDefault() },
        paper: { "aria-busy": busy },
      }}
    >
      <div className="correction-dialog-title">
        <DialogTitle id="correction-dialog-title">Новые правки</DialogTitle>
        <IconButton type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}>×</IconButton>
      </div>
      <form
        className="correction-dialog-form"
        onFocusCapture={(event) => { lastFocusedRef.current = event.target as HTMLElement; }}
        onSubmit={(event) => void submit(event)}
      >
        <DialogContent>
            <CorrectionPartFields
              part={part}
              assigneeOptions={assigneeOptions}
              disabled={busy}
              scopeLocked={scopeLocked}
              descriptionRef={descriptionRef}
              onChange={(update) => setPart((current) => ({ ...current, ...update }))}
            />
            <p className="correction-dialog-hint">Укажите фрагмент и опишите ожидаемый результат.</p>
        </DialogContent>
        {error ? (
          <Alert className="correction-dialog-feedback" severity="error">
            {error} Можно повторить действие.
          </Alert>
        ) : null}
        <DialogActions>
            <Button type="button" variant="outlined" disabled={busy} onClick={onClose}>Отмена</Button>
            <Button type="submit" variant="contained" disabled={busy || !valid}>
              {busy ? "Создание..." : submitLabel}
            </Button>
        </DialogActions>
      </form>
      <ConfirmationDialog
        open={awaitingConfirmation}
        message={action.confirmation ?? ""}
        confirmLabel={submitLabel}
        confirmColor={action.emphasis === "danger" ? "error" : "primary"}
        busy={busy}
        onCancel={() => setAwaitingConfirmation(false)}
        onConfirm={() => {
          setAwaitingConfirmation(false);
          void performSubmit();
        }}
      />
    </Dialog>
  );
}
