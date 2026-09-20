import type { CorrectionScope } from "../../corrections/types";
import type { ProductionAction, ProductionMutationCoordinator, ProductionReadModel } from "../types";
import ProductionActions, { productionActionContext } from "./ProductionActions";

const complete = new Set(["ready", "approved", "accepted"]);
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));

export default function ProductionStages({
  production,
  contextualActions,
  mutationPending,
  onMutate,
  onOpenCorrectionPackage,
}: {
  production: ProductionReadModel;
  contextualActions: ProductionAction[];
  mutationPending: boolean;
  onMutate: ProductionMutationCoordinator;
  onOpenCorrectionPackage?: (action: ProductionAction, initialScope: CorrectionScope) => void;
}) {
  return (
    <section className="production-stages" aria-label="Этапы производства">
      <ol className="production-stage-list">
        {production.stages.map((stage) => {
          const stageActions = contextualActions.filter((action) => productionActionContext(action.code) === stage.code);
          return (
          <li key={stage.code} className={`production-stage production-stage-${stage.state}`}>
            <span className="production-stage-indicator" aria-hidden="true">{complete.has(stage.state) ? "✓" : stage.state === "in_progress" ? "▷" : "○"}</span>
            <div className="production-stage-copy" role="region" aria-label={stage.label}>
              <div className="production-stage-summary">
              <strong>{stage.label}</strong>
              {stage.code === "voiceover" && stage.summary !== (production.voiceover.ready ? "Готова" : "Не готова") ? <span className="production-voiceover-state">{production.voiceover.ready ? "Готова" : "Не готова"}</span> : null}
              <p>{stage.summary}</p>
              {stage.code === "voiceover" && production.voiceover.ready && production.voiceover.ready_by && production.voiceover.ready_at ? (
                <p>{production.voiceover.ready_by.display_name} · {date(production.voiceover.ready_at)}</p>
              ) : null}
              </div>
              {stageActions.length ? (
                <ProductionActions
                  production={production}
                  actions={stageActions}
                  contextual
                  ariaLabel={`Действия этапа «${stage.label}»`}
                  mutationPending={mutationPending}
                  onMutate={onMutate}
                  onOpenCorrectionPackage={onOpenCorrectionPackage}
                />
              ) : null}
            </div>
          </li>
          );
        })}
      </ol>
    </section>
  );
}
