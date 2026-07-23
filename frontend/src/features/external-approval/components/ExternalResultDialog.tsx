import { type FormEvent, useEffect, useRef, useState } from "react";

import type { UserRef } from "../../../shared/contracts";
import type { CorrectionScope } from "../../corrections/types";
import type { ProductionAction } from "../../production/types";
import type { ExternalApprovalResultPayload } from "../types";


interface DraftPart {
  key: number;
  scope: CorrectionScope;
  description: string;
  assigneeId: string;
}

interface Props {
  open: boolean;
  action: ProductionAction | null;
  assigneeOptions: UserRef[];
  mutationPending: boolean;
  onClose: () => void;
  onSubmit: (payload: ExternalApprovalResultPayload) => Promise<void>;
}

const scopeLabels: Record<CorrectionScope, string> = {
  text: "Текст",
  video: "Ролик",
  titles: "Титры",
  voiceover: "Озвучка",
};

const newPart = (key: number): DraftPart => ({
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
  onClose,
  onSubmit,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const nextKeyRef = useRef(1);
  const [parts, setParts] = useState<DraftPart[]>([newPart(0)]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    nextKeyRef.current = 1;
    setParts([newPart(0)]);
    setError("");
    requestAnimationFrame(() => descriptionRef.current?.focus());
    return () => previouslyFocused?.focus();
  }, [open]);

  if (!open || !action) return null;

  const updatePart = (key: number, update: Partial<DraftPart>) => {
    setParts((current) => current.map((part) => (
      part.key === key ? { ...part, ...update } : part
    )));
  };

  const valid = parts.length > 0 && parts.every(
    (part) => part.description.trim() && part.assigneeId,
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mutationPending || !valid) return;
    setError("");
    try {
      await onSubmit({
        result: "changes_requested",
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
        aria-busy={mutationPending}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !mutationPending) onClose();
          if (event.key !== "Tab") return;
          if (mutationPending) {
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
          <div>
            <p className="production-kicker">Внешнее согласование</p>
            <h3 id="external-result-dialog-title">Зафиксировать внешние правки</h3>
          </div>
          <button
            type="button"
            className="text-button"
            disabled={mutationPending}
            onClick={onClose}
          >
            Закрыть
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <div className="correction-dialog-parts">
            {parts.map((part, index) => (
              <fieldset className="correction-dialog-part" key={part.key}>
                <legend>Часть {index + 1}</legend>
                <label>
                  Область правки
                  <select
                    aria-label="Область правки"
                    value={part.scope}
                    disabled={mutationPending}
                    onChange={(event) => updatePart(
                      part.key,
                      { scope: event.target.value as CorrectionScope },
                    )}
                  >
                    {Object.entries(scopeLabels).map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Описание правки
                  <textarea
                    ref={index === 0 ? descriptionRef : undefined}
                    aria-label="Описание правки"
                    value={part.description}
                    disabled={mutationPending}
                    rows={3}
                    maxLength={2000}
                    onChange={(event) => updatePart(
                      part.key,
                      { description: event.target.value },
                    )}
                  />
                </label>
                <label>
                  Ответственный
                  <select
                    aria-label="Ответственный"
                    value={part.assigneeId}
                    disabled={mutationPending}
                    onChange={(event) => updatePart(
                      part.key,
                      { assigneeId: event.target.value },
                    )}
                  >
                    <option value="">Выберите сотрудника</option>
                    {assigneeOptions.map((option) => (
                      <option value={option.id} key={option.id}>
                        {option.display_name} · {option.position}
                      </option>
                    ))}
                  </select>
                </label>
                {parts.length > 1 ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={mutationPending}
                    onClick={() => setParts((current) => (
                      current.filter((candidate) => candidate.key !== part.key)
                    ))}
                  >
                    Удалить часть
                  </button>
                ) : null}
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            className="secondary"
            disabled={mutationPending}
            onClick={() => {
              const key = nextKeyRef.current;
              nextKeyRef.current += 1;
              setParts((current) => [...current, newPart(key)]);
            }}
          >
            Добавить часть
          </button>
          {error ? (
            <p className="error" role="alert">{error} Можно повторить действие.</p>
          ) : null}
          <footer className="correction-dialog-actions">
            <button
              type="button"
              className="secondary"
              disabled={mutationPending}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="primary"
              disabled={mutationPending || !valid}
            >
              {mutationPending ? "Сохранение..." : "Зафиксировать результат"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
