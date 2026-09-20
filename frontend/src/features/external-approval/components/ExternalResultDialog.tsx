import {
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import type { UserRef } from "../../../shared/contracts";
import CorrectionPartFields, { type CorrectionPartDraft } from "../../corrections/components/CorrectionPartFields";
import ActionButton from "../../stories/components/ActionButton";
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
  const dialogRef = useRef<HTMLElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
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
    <div className="correction-dialog-backdrop">
      <section
        ref={dialogRef}
        className="correction-dialog external-result-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-result-dialog-title"
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
          <h3 id="external-result-dialog-title">Внешние правки</h3>
          <ActionButton type="button" className="text-button correction-dialog-close" aria-label="Закрыть" disabled={busy} onClick={onClose}>×</ActionButton>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <div className="correction-dialog-body">
            <div className="correction-dialog-parts">
              {parts.map((part, index) => (
                <fieldset className="correction-dialog-part" key={part.key}>
                  <legend>Правка {index + 1}</legend>
                  {parts.length > 1 ? (
                    <ActionButton
                      type="button"
                      className="text-button correction-dialog-remove"
                      disabled={busy}
                      onClick={() => setParts((current) => (
                        current.filter((candidate) => candidate.key !== part.key)
                      ))}
                    >
                      Удалить
                    </ActionButton>
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
            <ActionButton
              type="button"
              className="text-button correction-dialog-add"
              aria-label="Добавить правку"
              disabled={busy}
              onClick={() => {
                const key = nextKeyRef.current;
                nextKeyRef.current += 1;
                setParts((current) => [...current, newPart(key)]);
              }}
            >
              ＋ Добавить правку
            </ActionButton>
          </div>
          <footer className="correction-dialog-actions">
            {error ? (
              <p className="error" role="alert">{error} Можно повторить действие.</p>
            ) : null}
            <ActionButton type="button" className="secondary" disabled={busy} onClick={onClose}>Отмена</ActionButton>
            <ActionButton type="submit" className="primary" disabled={busy || !valid}>
              {busy ? "Сохранение..." : "Сохранить правки"}
            </ActionButton>
          </footer>
        </form>
      </section>
    </div>
  );
}
