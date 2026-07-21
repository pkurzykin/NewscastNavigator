import type { ProductionStage } from "../types";


export default function ProductionStages({ stages }: { stages: ProductionStage[] }) {
  return (
    <section className="production-section production-stages" aria-labelledby="production-stages-title">
      <header className="production-section-head">
        <div>
          <p className="production-kicker">Текущий путь</p>
          <h3 id="production-stages-title">Этапы производства</h3>
        </div>
      </header>
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
    </section>
  );
}
