import { type FormEvent, useEffect, useRef, useState } from "react";

import type { UserRef } from "../../../shared/contracts";
import ActionButton from "../../stories/components/ActionButton";
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
  const dialogRef = useRef<HTMLElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [part, setPart] = useState<CorrectionPartDraft>(() => newPart(initialScope));
  const [error, setError] = useState("");
  const busy = mutationPending || submitting;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    submittingRef.current = false;
    setSubmitting(false);
    setPart(newPart(initialScope));
    setError("");
    requestAnimationFrame(() => descriptionRef.current?.focus());
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [initialScope, open]);

  if (!open || !action) return null;

  const valid = Boolean(part.description.trim() && part.assigneeId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mutationPending || submittingRef.current || !valid) return;
    if (action.confirmation && !window.confirm(action.confirmation)) return;
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

  return (
    <div className="correction-dialog-backdrop">
      <section
        ref={dialogRef}
        className="correction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="correction-dialog-title"
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onClose();
          if (event.key !== "Tab") return;
          if (busy) {
            event.preventDefault();
            dialogRef.current?.focus();
            return;
          }
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
            ) ?? [],
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="correction-dialog-head">
          <h3 id="correction-dialog-title">Новые правки</h3>
          <ActionButton type="button" className="text-button correction-dialog-close" aria-label="Закрыть" disabled={busy} onClick={onClose}>×</ActionButton>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <div className="correction-dialog-body">
            <CorrectionPartFields
              part={part}
              assigneeOptions={assigneeOptions}
              disabled={busy}
              scopeLocked={scopeLocked}
              descriptionRef={descriptionRef}
              onChange={(update) => setPart((current) => ({ ...current, ...update }))}
            />
            <p className="correction-dialog-hint">Укажите фрагмент и опишите ожидаемый результат.</p>
          </div>
          <footer className="correction-dialog-actions">
            {error ? <p className="error" role="alert">{error} Можно повторить действие.</p> : null}
            <ActionButton type="button" className="secondary" disabled={busy} onClick={onClose}>Отмена</ActionButton>
            <ActionButton type="submit" className="primary" disabled={busy || !valid}>
              {busy ? "Создание..." : submitLabel}
            </ActionButton>
          </footer>
        </form>
      </section>
    </div>
  );
}
