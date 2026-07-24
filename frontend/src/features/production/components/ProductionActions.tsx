import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { runProductionAction } from "../api";
import type { CorrectionScope } from "../../corrections/types";
import type { ProductionAction, ProductionMutationCoordinator, ProductionReadModel } from "../types";
import ActionButton from "../../stories/components/ActionButton";


interface Props {
  production: ProductionReadModel;
  mutationPending: boolean;
  onMutate: ProductionMutationCoordinator;
  onOpenCorrectionPackage?: (action: ProductionAction, initialScope: CorrectionScope) => void;
}

export default function ProductionActions({ production, mutationPending, onMutate, onOpenCorrectionPackage }: Props) {
  const regionRef = useRef<HTMLElement>(null);
  const previousPrimaryCode = useRef<string | null | undefined>(undefined);
  const suppressCommandFocusRef = useRef(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [formAction, setFormAction] = useState<ProductionAction | null>(null);
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState("");
  const actions = useMemo(
    () => [production.primary_action, ...production.additional_actions].filter(
      (candidate): candidate is ProductionAction => candidate !== null,
    ),
    [production],
  );

  useEffect(() => {
    const nextCode = production.primary_action?.code ?? null;
    if (pendingCode !== null) return;
    if (previousPrimaryCode.current !== undefined && previousPrimaryCode.current !== nextCode) {
      if (!suppressCommandFocusRef.current) {
        regionRef.current?.querySelector<HTMLButtonElement>("button[data-production-primary='true']")?.focus();
      }
    }
    suppressCommandFocusRef.current = false;
    previousPrimaryCode.current = nextCode;
  }, [pendingCode, production.primary_action?.code]);

  const execute = async (
    action: ProductionAction,
    payload?: { description: string; assignee_user_id: number },
  ) => {
    if (pendingCode !== null) return;
    if (action.confirmation && !window.confirm(action.confirmation)) return;
    suppressCommandFocusRef.current = true;
    setPendingCode(action.code);
    setError("");
    try {
      await onMutate(() => runProductionAction(action, production.scenario_revision, payload));
      setFormAction(null);
      setDescription("");
      setAssigneeId("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось выполнить действие");
    } finally {
      setPendingCode(null);
    }
  };

  const chooseAction = (candidate: ProductionAction) => {
    if (candidate.code === "video_correction_package" || candidate.code === "titles_correction_package") {
      onOpenCorrectionPackage?.(
        candidate,
        candidate.code === "video_correction_package" ? "video" : "titles",
      );
      return;
    }
    if (candidate.form === "correction_package") {
      setFormAction(candidate);
      setError("");
      return;
    }
    void execute(candidate);
  };

  const submitCorrection = (event: FormEvent) => {
    event.preventDefault();
    if (!formAction || !assigneeId) return;
    void execute(formAction, {
      description: description.trim(),
      assignee_user_id: Number(assigneeId),
    });
  };

  if (!actions.length) return null;
  return (
    <section ref={regionRef} className="production-section production-actions" aria-label="Действия производства">
      <header className="production-section-head">
        <div>
          <p className="production-kicker">Следующий шаг</p>
          <h3>Действия</h3>
        </div>
      </header>
      {!formAction ? (
        <div className="production-action-buttons">
          {actions.map((candidate) => (
            <ActionButton
              key={candidate.code}
              className={candidate.emphasis === "primary" ? "primary" : "secondary"}
              data-production-primary={candidate.emphasis === "primary" ? "true" : undefined}
              primaryAction={candidate.emphasis === "primary"}
              disabled={mutationPending || pendingCode !== null}
              onClick={() => chooseAction(candidate)}
            >
              {pendingCode === candidate.code ? "Выполняется..." : candidate.label}
            </ActionButton>
          ))}
        </div>
      ) : null}
      {formAction?.code === "voiceover_not_ready" ? (
        <form className="production-correction-form" onSubmit={submitCorrection}>
          <label>
            Что исправить в озвучке
            <textarea
              value={description}
              autoFocus
              onChange={(event) => setDescription(event.target.value)}
              required
              rows={3}
              maxLength={2000}
            />
          </label>
          <label>
            Ответственный за правку
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} required>
              <option value="">Выберите сотрудника</option>
              {production.assignee_options.map((option) => (
                <option key={option.id} value={option.id}>{option.display_name} · {option.position}</option>
              ))}
            </select>
          </label>
          <div className="production-correction-controls">
            <button type="submit" className="primary" disabled={mutationPending || pendingCode !== null || !description.trim() || !assigneeId}>
              Создать правку и вернуть
            </button>
            <button type="button" className="secondary" disabled={mutationPending || pendingCode !== null} onClick={() => setFormAction(null)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}
      {error ? <p className="error production-inline-error" role="alert">{error} Можно повторить действие.</p> : null}
    </section>
  );
}
