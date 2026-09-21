import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import type { UserRef } from "../../../shared/contracts";
import CorrectionPartFields, { type CorrectionPartDraft } from "../../corrections/components/CorrectionPartFields";
import type { ProductionAction } from "../../production/types";
import type { ExternalApprovalChangesRequestedPayload } from "../types";

interface Props {
  open: boolean;
  action: ProductionAction | null;
  assigneeOptions: UserRef[];
  mutationPending: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (payload: ExternalApprovalChangesRequestedPayload) => Promise<void>;
}

const newPart = (key: number): CorrectionPartDraft => ({
  key,
  scope: "text",
  description: "",
  assigneeId: "",
});

export default function ExternalResultDialog({
  open,
  action,
  assigneeOptions,
  mutationPending,
  returnFocusRef,
  onClose,
  onSubmit,
}: Props) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const nextKeyRef = useRef(1);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [parts, setParts] = useState<CorrectionPartDraft[]>([newPart(0)]);
  const [error, setError] = useState("");
  const busy = mutationPending || submitting;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    nextKeyRef.current = 1;
    submittingRef.current = false;
    setSubmitting(false);
    setParts([newPart(0)]);
    setError("");
    requestAnimationFrame(() => descriptionRef.current?.focus());
    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      } else {
        returnFocusRef.current?.focus();
      }
    };
  }, [open, returnFocusRef]);

  if (!open || !action) return null;

  const updatePart = (key: number, update: Partial<CorrectionPartDraft>) => {
    setParts((current) => current.map((part) => (
      part.key === key ? { ...part, ...update } : part
    )));
  };
  const valid = parts.length > 0 && parts.every(
    (part) => part.description.trim() && part.assigneeId,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mutationPending || submittingRef.current || !valid) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        parts: parts.map((part) => ({
          scope: part.scope,
          description: part.description.trim(),
          assignee_user_id: Number(part.assigneeId),
        })),
      });
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось сохранить внешний результат",
      );
      requestAnimationFrame(() => descriptionRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
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
      aria-labelledby="external-result-dialog-title"
      slotProps={{
        backdrop: { onMouseDown: (event) => event.preventDefault() },
        paper: { "aria-busy": busy },
      }}
    >
      <div className="correction-dialog-title">
        <DialogTitle id="external-result-dialog-title">Внешние правки</DialogTitle>
        <IconButton type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}>×</IconButton>
      </div>
      <form
        className="correction-dialog-form"
        onFocusCapture={(event) => { lastFocusedRef.current = event.target as HTMLElement; }}
        onSubmit={(event) => void submit(event)}
      >
        <DialogContent>
            <div className="correction-dialog-parts">
              {parts.map((part, index) => (
                <fieldset className="correction-dialog-part" key={part.key}>
                  <legend>Правка {index + 1}</legend>
                  {parts.length > 1 ? (
                    <Button
                      type="button"
                      className="correction-dialog-remove"
                      variant="text"
                      disabled={busy}
                      onClick={() => setParts((current) => (
                        current.filter((candidate) => candidate.key !== part.key)
                      ))}
                    >
                      Удалить
                    </Button>
                  ) : null}
                  <CorrectionPartFields
                    part={part}
                    assigneeOptions={assigneeOptions}
                    disabled={busy}
                    descriptionRef={index === 0 ? descriptionRef : undefined}
                    onChange={(update) => updatePart(part.key, update)}
                  />
                </fieldset>
              ))}
            </div>
            <Button
              type="button"
              className="correction-dialog-add"
              variant="text"
              aria-label="Добавить правку"
              disabled={busy}
              onClick={() => {
                const key = nextKeyRef.current;
                nextKeyRef.current += 1;
                setParts((current) => [...current, newPart(key)]);
              }}
            >
              ＋ Добавить правку
            </Button>
        </DialogContent>
        {error ? (
          <Alert className="correction-dialog-feedback" severity="error">
            {error} Можно повторить действие.
          </Alert>
        ) : null}
        <DialogActions>
            <Button type="button" variant="outlined" disabled={busy} onClick={onClose}>Отмена</Button>
            <Button type="submit" variant="contained" disabled={busy || !valid}>
              {busy ? "Сохранение..." : "Сохранить правки"}
            </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
