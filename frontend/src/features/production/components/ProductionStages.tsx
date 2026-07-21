import type { ProductionStage } from "../types";

const completedStates = new Set(["ready", "approved", "accepted"]);

function StageList({ stages }: { stages: ProductionStage[] }) {
  return (
    <ol className="production-stage-list">
      {stages.map((stage, index) => (
        <li key={stage.code} className={`production-stage production-stage-${stage.state}`}>
          <span className="production-stage-index" aria-hidden="true">{index + 1}</span>
          <div>
            <strong>{stage.label}</strong>
            <p>{stage.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ProductionStages({ stages }: { stages: ProductionStage[] }) {
  const completed = stages.filter((stage) => completedStates.has(stage.state));
  const current = stages.filter((stage) => !completedStates.has(stage.state));
  return (
    <section className="production-section production-stages" aria-labelledby="production-stages-title">
      <header className="production-section-head">
        <div>
          <p className="production-kicker">Текущий путь</p>
          <h3 id="production-stages-title">Этапы производства</h3>
        </div>
      </header>
      <StageList stages={current} />
      {completed.length ? (
        <details className="production-completed-stages">
          <summary>Завершено: {completed.length}</summary>
          <StageList stages={completed} />
        </details>
      ) : null}
    </section>
  );
}
