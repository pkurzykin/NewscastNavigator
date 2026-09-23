import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import { useEffect, useRef, useState } from "react";

import type { ProductionMutationCoordinator } from "../../production/types";
import {
  executeExternalApprovalAction,
} from "../api";
import type {
  ExternalApprovalReadModel,
  ExternalApprovalResult,
  ExternalApprovalChangesRequestedPayload,
} from "../types";
import ExternalResultDialog from "./ExternalResultDialog";


interface Props {
  model: ExternalApprovalReadModel | null;
  loading: boolean;
  error: string;
  mutationPending: boolean;
  focusRequested?: boolean;
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
  focusRequested = false,
  onRetry,
  onMutate,
}: Props) {
  const [resultAction, setResultAction] = useState<
    NonNullable<ExternalApprovalReadModel["items"][number]["primary_action"]> | null
  >(null);
  const [actionError, setActionError] = useState("");
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!focusRequested) return;
    const frame = requestAnimationFrame(() => sectionRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusRequested]);

  const run = async (
    action: NonNullable<ExternalApprovalReadModel["send_action"]>,
    payload: ExternalApprovalChangesRequestedPayload | Record<string, never>,
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
        ref={sectionRef}
        id="external-approval"
        className="production-section external-approval-cycles"
        aria-labelledby="external-approval-title"
        tabIndex={-1}
      >
        <header className="production-section-head">
          <h3 id="external-approval-title">Внешнее согласование</h3>
          {model?.send_action ? (
            <Button
              type="button"
              variant="contained"
              data-context-primary-action="true"
              disabled={mutationPending}
              onClick={() => void run(model.send_action!, {}).catch(() => undefined)}
            >
              {model.send_action.label}
            </Button>
          ) : null}
        </header>
        {loading && !model ? (
          <p className="muted" role="status">Загрузка согласований...</p>
        ) : null}
        {error ? (
          <Alert className="correction-load-error" severity="error" action={
            <Button type="button" color="inherit" onClick={onRetry}>
              Повторить
            </Button>
          }>{error}</Alert>
        ) : null}
        {actionError ? (
          <Alert severity="error">{actionError} Можно повторить действие.</Alert>
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
                  <Chip
                    size="small"
                    variant="outlined"
                    color={cycle.result === "approved" ? "success" : cycle.result === "changes_requested" ? "error" : "primary"}
                    label={resultLabels[cycle.result]}
                  />
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
                    Правки №{cycle.correction_package_id}
                  </a>
                ) : null}
                {cycle.primary_action || cycle.additional_actions.length ? (
                  <div className="external-approval-actions">
                    {[cycle.primary_action, ...cycle.additional_actions]
                      .filter((action): action is NonNullable<typeof action> => action !== null)
                      .map((action) => (
                        <Button
                          type="button"
                          variant={action.emphasis === "primary" ? "contained" : "outlined"}
                          color={action.emphasis === "danger" ? "error" : "primary"}
                          data-context-primary-action={action.emphasis === "primary" ? "true" : undefined}
                          disabled={mutationPending}
                          key={action.code}
                          onClick={() => {
                            if (action.form === "external_result") {
                              setResultAction(action);
                              return;
                            }
                            void run(
                              action,
                              {},
                            ).catch(() => undefined);
                          }}
                        >
                          {action.label}
                        </Button>
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
        returnFocusRef={sectionRef}
        onClose={() => setResultAction(null)}
        onSubmit={async (payload) => {
          if (!resultAction) return;
          await run(resultAction, payload);
        }}
      />
    </>
  );
}
