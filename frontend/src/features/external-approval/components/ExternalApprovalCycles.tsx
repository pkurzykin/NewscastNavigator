import { useState } from "react";

import type { ProductionMutationCoordinator } from "../../production/types";
import {
  executeExternalApprovalAction,
} from "../api";
import type {
  ExternalApprovalReadModel,
  ExternalApprovalResult,
  ExternalApprovalResultPayload,
} from "../types";
import ExternalResultDialog from "./ExternalResultDialog";


interface Props {
  model: ExternalApprovalReadModel | null;
  loading: boolean;
  error: string;
  mutationPending: boolean;
  onRetry: () => void;
  onMutate: ProductionMutationCoordinator;
}

const resultLabels: Record<ExternalApprovalResult, string> = {
  pending: "Ожидается результат",
  approved: "Согласовано",
  changes_requested: "Есть правки",
};

const formatDate = (value: string) => new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(value));

export default function ExternalApprovalCycles({
  model,
  loading,
  error,
  mutationPending,
  onRetry,
  onMutate,
}: Props) {
  const [resultAction, setResultAction] = useState<
    NonNullable<ExternalApprovalReadModel["items"][number]["primary_action"]> | null
  >(null);
  const [actionError, setActionError] = useState("");

  const run = async (
    action: NonNullable<ExternalApprovalReadModel["send_action"]>,
    payload: ExternalApprovalResultPayload | Record<string, never>,
  ) => {
    setActionError("");
    try {
      await onMutate(() => executeExternalApprovalAction(action, payload));
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось выполнить действие",
      );
      throw requestError;
    }
  };

  return (
    <>
      <section
        id="external-approval"
        className="production-section external-approval-cycles"
        aria-labelledby="external-approval-title"
      >
        <header className="production-section-head">
          <div>
            <p className="production-kicker">Ручной внешний контур</p>
            <h3 id="external-approval-title">Внешнее согласование</h3>
          </div>
          {model?.send_action ? (
            <button
              type="button"
              className="primary"
              disabled={mutationPending}
              onClick={() => void run(model.send_action!, {}).catch(() => undefined)}
            >
              {model.send_action.label}
            </button>
          ) : null}
        </header>
        {loading && !model ? (
          <p className="muted" role="status">Загрузка согласований...</p>
        ) : null}
        {error ? (
          <div className="correction-load-error" role="alert">
            <span>{error}</span>
            <button type="button" className="secondary" onClick={onRetry}>
              Повторить
            </button>
          </div>
        ) : null}
        {actionError ? (
          <p className="error" role="alert">{actionError} Можно повторить действие.</p>
        ) : null}
        {model && model.items.length === 0 ? (
          <p className="production-empty">Сюжет ещё не отправлялся на внешнее согласование.</p>
        ) : null}
        {model?.items.length ? (
          <ol className="external-approval-list">
            {model.items.map((cycle) => (
              <li className="external-approval-cycle" key={cycle.id}>
                <div className="external-approval-cycle-head">
                  <strong>Цикл №{cycle.cycle_no}</strong>
                  <span className={`external-approval-state is-${cycle.result}`}>
                    {resultLabels[cycle.result]}
                  </span>
                </div>
                <p>
                  Отправил: {cycle.sent_by.display_name} · {formatDate(cycle.sent_at)}
                </p>
                {cycle.decided_by && cycle.decided_at ? (
                  <p>
                    Зафиксировал: {cycle.decided_by.display_name} · {formatDate(cycle.decided_at)}
                  </p>
                ) : null}
                {cycle.correction_package_id ? (
                  <a href={`#correction-package-${cycle.correction_package_id}`}>
                    Пакет правок №{cycle.correction_package_id}
                  </a>
                ) : null}
                {cycle.primary_action || cycle.additional_actions.length ? (
                  <div className="external-approval-actions">
                    {[cycle.primary_action, ...cycle.additional_actions]
                      .filter((action): action is NonNullable<typeof action> => action !== null)
                      .map((action) => (
                        <button
                          type="button"
                          className={action.emphasis === "primary" ? "primary" : "secondary"}
                          disabled={mutationPending}
                          key={action.code}
                          onClick={() => {
                            if (action.form === "external_result") {
                              setResultAction(action);
                              return;
                            }
                            void run(
                              action,
                              { result: "approved", parts: [] },
                            ).catch(() => undefined);
                          }}
                        >
                          {action.label}
                        </button>
                      ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      <ExternalResultDialog
        open={resultAction !== null}
        action={resultAction}
        assigneeOptions={model?.assignee_options ?? []}
        mutationPending={mutationPending}
        onClose={() => setResultAction(null)}
        onSubmit={async (payload) => {
          if (!resultAction) return;
          await run(resultAction, payload);
        }}
      />
    </>
  );
}
