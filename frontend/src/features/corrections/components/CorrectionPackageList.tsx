import ActionButton from "../../stories/components/ActionButton";
import { type FormEvent, useState } from "react";

import type { ProductionMutationCoordinator } from "../../production/types";
import { runCorrectionAction } from "../api";
import type { CorrectionAction, CorrectionPackagesResponse, CorrectionScope } from "../types";


interface Props {
  model: CorrectionPackagesResponse | null;
  loading: boolean;
  error: string;
  mutationPending: boolean;
  onRetry: () => void;
  onMutate: ProductionMutationCoordinator;
  onCreate: (action: CorrectionAction, initialScope?: CorrectionScope) => void;
}

const scopeLabels: Record<CorrectionScope, string> = {
  text: "Текст",
  video: "Ролик",
  titles: "Титры",
  voiceover: "Озвучка",
};

const formatDate = (value: string) => new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
}).format(new Date(value));

export default function CorrectionPackageList({
  model,
  loading,
  error,
  mutationPending,
  onRetry,
  onMutate,
  onCreate,
}: Props) {
  const [pendingActionHref, setPendingActionHref] = useState<string | null>(null);
  const [returnAction, setReturnAction] = useState<CorrectionAction | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [actionError, setActionError] = useState("");
  const createAction = model?.create_action;

  const execute = async (action: CorrectionAction, reason?: string) => {
    if (mutationPending || pendingActionHref !== null) return;
    setPendingActionHref(action.href);
    setActionError("");
    try {
      await onMutate(() => runCorrectionAction(action, { reason }));
      setReturnAction(null);
      setReturnReason("");
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Не удалось выполнить действие");
    } finally {
      setPendingActionHref(null);
    }
  };

  const chooseAction = (action: CorrectionAction) => {
    if (action.form === "return_reason") {
      setReturnAction(action);
      setReturnReason("");
      setActionError("");
      return;
    }
    void execute(action);
  };

  const submitReturn = (event: FormEvent) => {
    event.preventDefault();
    if (!returnAction || !returnReason.trim()) return;
    void execute(returnAction, returnReason.trim());
  };

  const createButton = createAction ? (
    <ActionButton
      type="button"
      className="secondary"
      disabled={mutationPending || pendingActionHref !== null}
      onClick={() => onCreate(createAction)}
    >
      {createAction.label}
    </ActionButton>
  ) : null;

  if (model && !model.items.length && !loading && !error) {
    return createButton ? <div className="correction-package-create-only">{createButton}</div> : null;
  }

  return (
    <section className="production-section correction-packages" aria-labelledby="correction-packages-title" aria-busy={loading}>
      <header className="production-section-head correction-packages-head">
        <div>
          <h3 id="correction-packages-title">Пакеты правок</h3>
        </div>
        {createButton}
      </header>
      {error ? (
        <div className="correction-load-error" role="alert">
          <span>{error}</span>
          <ActionButton type="button" className="secondary" disabled={loading || mutationPending} onClick={onRetry}>
            {loading ? "Загрузка..." : "Повторить загрузку правок"}
          </ActionButton>
        </div>
      ) : null}
      {!model && loading ? <p className="production-empty" role="status">Загрузка правок...</p> : null}
      {model?.items.length ? (
        <div className="correction-package-list">
          {model.items.map((item) => {
            const actions = [item.primary_action, ...item.additional_actions].filter(
              (candidate): candidate is CorrectionAction => candidate !== null,
            );
            return (
              <article id={`correction-package-${item.id}`} className={`correction-package-card${item.closed_at ? " is-closed" : ""}`} aria-label={`Правки №${item.id}`} key={item.id}>
                <header className="correction-package-card-head">
                  <div>
                    <span className="correction-package-source">
                      {item.source === "external" ? "Внешние" : "Внутренние"}
                    </span>
                    <h4>Правки №{item.id}</h4>
                    <p>Создал: {item.created_by.display_name} · {formatDate(item.created_at)}</p>
                  </div>
                  <span className={`correction-package-state ${item.closed_at ? "is-closed" : item.awaiting_leadership_review ? "is-review" : "is-open"}`}>
                    {item.closed_at
                      ? "Закрыты"
                      : item.awaiting_leadership_review
                        ? "Исполнители закончили — нужен просмотр руководства"
                        : "Правки в работе"}
                  </span>
                </header>
                <ol className="correction-part-list">
                  {item.parts.map((part) => (
                    <li className={`correction-part is-${part.state}`} key={part.id}>
                      <div className="correction-part-copy">
                        <span className="correction-part-scope">{scopeLabels[part.scope]}</span>
                        <strong>{part.description}</strong>
                      </div>
                      <div className="correction-part-meta">
                        <span>Ответственный: {part.assignee.display_name}</span>
                        {part.completed_by && part.completed_at
                          ? <span>Выполнил: {part.completed_by.display_name} · {formatDate(part.completed_at)}</span>
                          : <span>Ожидает выполнения</span>}
                      </div>
                    </li>
                  ))}
                </ol>
                {actions.length ? (
                  <div className="correction-package-actions">
                    {actions.map((action) => (
                      <ActionButton
                        type="button"
                        className={action.emphasis === "primary" ? "primary" : "secondary"}
                        data-context-primary-action={action.emphasis === "primary" ? "true" : undefined}
                        disabled={mutationPending || pendingActionHref !== null}
                        key={`${action.code}-${action.href}`}
                        onClick={() => chooseAction(action)}
                      >
                        {pendingActionHref === action.href ? "Выполняется..." : action.label}
                      </ActionButton>
                    ))}
                  </div>
                ) : null}
                {returnAction && actions.some((action) => action.href === returnAction.href) ? (
                  <form className="correction-return-form" onSubmit={submitReturn}>
                    <label>
                      Причина возврата
                      <textarea
                        aria-label="Причина возврата"
                        value={returnReason}
                        autoFocus
                        disabled={mutationPending || pendingActionHref !== null}
                        required
                        rows={2}
                        maxLength={2000}
                        onChange={(event) => setReturnReason(event.target.value)}
                      />
                    </label>
                    <div className="correction-return-controls">
                      <ActionButton type="submit" className="primary" data-context-primary-action="true" disabled={mutationPending || pendingActionHref !== null || !returnReason.trim()}>
                        Вернуть в работу
                      </ActionButton>
                      <ActionButton type="button" className="secondary" disabled={mutationPending || pendingActionHref !== null} onClick={() => setReturnAction(null)}>
                        Отмена
                      </ActionButton>
                    </div>
                  </form>
                ) : null}
                {item.closed_by && item.closed_at ? (
                  <p className="correction-package-closed-meta">Закрыл: {item.closed_by.display_name} · {formatDate(item.closed_at)}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {actionError ? <p className="error production-inline-error" role="alert">{actionError} Можно повторить действие.</p> : null}
    </section>
  );
}
