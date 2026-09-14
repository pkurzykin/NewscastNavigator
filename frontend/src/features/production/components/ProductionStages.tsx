import type { ProductionReadModel, ProductionStage } from "../types";

const complete = new Set(["ready", "approved", "accepted"]);
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));

export default function ProductionStages({ stages, voiceover }: { stages: ProductionStage[]; voiceover?: ProductionReadModel["voiceover"] }) {
  return (
    <section className="production-stages" aria-label="Этапы производства">
      <ol className="production-stage-list">
        {stages.map((stage) => (
          <li key={stage.code} className={`production-stage production-stage-${stage.state}`}>
            <span className="production-stage-indicator" aria-hidden="true">{complete.has(stage.state) ? "✓" : stage.state === "in_progress" ? "▷" : "○"}</span>
            <div role={stage.code === "voiceover" ? "region" : undefined} aria-label={stage.code === "voiceover" ? "Озвучка" : undefined}>
              <strong>{stage.label}</strong>
              {stage.code === "voiceover" && voiceover && stage.summary !== (voiceover.ready ? "Готова" : "Не готова") ? <span className="production-voiceover-state">{voiceover.ready ? "Готова" : "Не готова"}</span> : null}
              <p>{stage.summary}</p>
              {stage.code === "voiceover" && voiceover?.ready && voiceover.ready_by && voiceover.ready_at ? (
                <p>{voiceover.ready_by.display_name} · {date(voiceover.ready_at)}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
