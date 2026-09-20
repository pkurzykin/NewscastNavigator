import { useEffect, useMemo, useRef, useState } from "react";

import { runProductionAction } from "../api";
import type { CorrectionScope } from "../../corrections/types";
import type { ProductionAction, ProductionMutationCoordinator, ProductionReadModel } from "../types";
import ActionButton from "../../stories/components/ActionButton";

const correctionReturnCodes = new Set([
  "voiceover_not_ready",
  "video_correction_package",
  "titles_correction_package",
]);

export const productionActionContext = (code: string) => {
  if (code === "video_approve_for_titles" || code.startsWith("titles_")) return "titles";
  if (code.startsWith("voiceover_")) return "voiceover";
  if (code.startsWith("video_")) return "video";
  return "story";
};

interface Props {
  production: ProductionReadModel;
  actions?: ProductionAction[];
  contextual?: boolean;
  ariaLabel?: string;
  mutationPending: boolean;
  onMutate: ProductionMutationCoordinator;
  onOpenCorrectionPackage?: (action: ProductionAction, initialScope: CorrectionScope) => void;
}

export default function ProductionActions({
  production,
  actions: suppliedActions,
  contextual = false,
  ariaLabel = "Действия производства",
  mutationPending,
  onMutate,
  onOpenCorrectionPackage,
}: Props) {
  const regionRef = useRef<HTMLElement>(null);
  const previousPrimaryCode = useRef<string | null | undefined>(undefined);
  const suppressCommandFocusRef = useRef(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const actions = useMemo(
    () => suppliedActions ?? [production.primary_action, ...production.additional_actions].filter(
      (candidate): candidate is ProductionAction => candidate !== null,
    ),
    [production, suppliedActions],
  );

  useEffect(() => {
    const nextCode = production.primary_action?.code ?? null;
    if (pendingCode !== null) return;
    if (previousPrimaryCode.current !== undefined && previousPrimaryCode.current !== nextCode) {
      if (!contextual && !suppressCommandFocusRef.current) {
        regionRef.current?.querySelector<HTMLButtonElement>("button[data-production-primary='true']")?.focus();
      }
    }
    suppressCommandFocusRef.current = false;
    previousPrimaryCode.current = nextCode;
  }, [contextual, pendingCode, production.primary_action?.code]);

  const execute = async (action: ProductionAction) => {
    if (pendingCode !== null) return;
    if (action.confirmation && !window.confirm(action.confirmation)) return;
    suppressCommandFocusRef.current = true;
    setPendingCode(action.code);
    setError("");
    try {
      await onMutate(() => runProductionAction(action, production.scenario_revision));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось выполнить действие");
    } finally {
      setPendingCode(null);
    }
  };

  const chooseAction = (candidate: ProductionAction) => {
    if (correctionReturnCodes.has(candidate.code)) {
      onOpenCorrectionPackage?.(
        candidate,
        candidate.code === "voiceover_not_ready" ? "voiceover"
          : candidate.code === "video_correction_package" ? "video" : "titles",
      );
      return;
    }
    void execute(candidate);
  };

  if (!actions.length) return null;
  return (
    <section ref={regionRef} className={`production-actions${contextual ? " is-contextual" : ""}`} aria-label={ariaLabel}>
      <div className="production-action-buttons">
        {actions.map((candidate) => {
          const correctionReturn = correctionReturnCodes.has(candidate.code);
          return (
            <span className="production-action-group" key={candidate.code}>
              <ActionButton
                className={correctionReturn ? "secondary" : candidate.emphasis === "primary" ? "primary" : candidate.emphasis === "danger" ? "danger" : "secondary"}
                data-context-primary-action={contextual && candidate.emphasis === "primary" && !correctionReturn ? "true" : undefined}
                data-production-primary={candidate.code === production.primary_action?.code ? "true" : undefined}
                primaryAction={candidate.code === production.primary_action?.code && !correctionReturn}
                disabled={mutationPending || pendingCode !== null}
                onClick={() => chooseAction(candidate)}
              >
                {pendingCode === candidate.code ? "Выполняется..." : candidate.label}
              </ActionButton>
            </span>
          );
        })}
      </div>
      {error ? <p className="error production-inline-error" role="alert">{error} Можно повторить действие.</p> : null}
    </section>
  );
}
