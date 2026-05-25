import type { ReactNode } from "react";
import type { ProductionGate } from "../../features/projects/productionGates";

export type StoryProductionTone = "fresh" | "stale" | "empty" | "warn";

export interface StoryProductionMetric {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: StoryProductionTone;
}

export interface StoryProductionTrack {
  key: string;
  title: string;
  sourceLabel: string;
  sourceValue: string;
  statusLabel: string;
  ownerLabel?: string;
  ownerValue?: string;
  tone: StoryProductionTone;
  controls: ReactNode;
  metrics: StoryProductionMetric[];
  alerts?: ReactNode[];
}

interface StoryProductionPanelProps {
  tracks: StoryProductionTrack[];
  gates: ProductionGate[];
  currentGate: ProductionGate | null;
  currentGateActions?: ReactNode;
  draftTitlesNotice?: ReactNode;
}

function productionGateStatusLabel(status: ProductionGate["status"]): string {
  if (status === "done") {
    return "Готово";
  }
  if (status === "current") {
    return "Текущий шаг";
  }
  if (status === "attention") {
    return "Требует внимания";
  }
  return "Заблокировано";
}

function StoryProductionPanel({
  tracks,
  gates,
  currentGate,
  currentGateActions,
  draftTitlesNotice,
}: StoryProductionPanelProps) {
  const attentionCount =
    gates.filter((gate) => gate.status === "attention").length ||
    tracks.filter((track) => track.tone === "warn" || track.tone === "stale").length;

  return (
    <section
      id="story-production"
      className="story-production-panel story-workspace-section"
      aria-label="Производство"
    >
      <div className="story-production-head">
        <div>
          <p className="story-overview-eyebrow">производственный контур</p>
          <h3>Производство</h3>
          <p>
            Монтаж, титры, озвучка и внешняя сдача привязаны к явным состояниям текста,
            а не к случайному последнему сохранению.
          </p>
        </div>
        <div className={`story-production-attention story-production-attention-${attentionCount > 0 ? "warn" : "fresh"}`}>
          <span>требует внимания</span>
          <strong>{attentionCount}</strong>
        </div>
      </div>

      <div className="story-production-track-strip" aria-label="Сводка производственных треков">
        {tracks.map((track) => (
          <div key={track.key} className={`story-production-track-chip story-production-track-chip-${track.tone}`}>
            <span>{track.title}</span>
            <strong>{track.statusLabel}</strong>
            <small>{track.sourceValue}</small>
          </div>
        ))}
      </div>

      <div className="story-production-gate-layout">
        <ol className="story-production-gate-list" aria-label="Production gates">
          {gates.map((gate, index) => (
            <li key={gate.key} className={`story-production-gate story-production-gate-${gate.status}`}>
              <span className="story-production-gate-index">{index + 1}</span>
              <div>
                <div className="story-production-gate-head">
                  <strong>{gate.label}</strong>
                  <span>{productionGateStatusLabel(gate.status)}</span>
                </div>
                <p>{gate.summary}</p>
                <small>{gate.detail}</small>
              </div>
            </li>
          ))}
        </ol>

        <aside className="story-production-current-gate" aria-label="Текущий production gate">
          {currentGate ? (
            <>
              <p className="story-overview-eyebrow">текущий gate</p>
              <h4>{currentGate.label}</h4>
              <strong>{currentGate.actionLabel}</strong>
              <p>{currentGate.detail}</p>
              {currentGateActions ? (
                <div className="story-production-current-actions">{currentGateActions}</div>
              ) : null}
              {draftTitlesNotice ? (
                <div className="story-production-draft-titles">{draftTitlesNotice}</div>
              ) : null}
            </>
          ) : (
            <p className="muted">Production gates пока не рассчитаны.</p>
          )}
        </aside>
      </div>

      <details className="story-production-track-details">
        <summary>Детали треков и вторичные действия</summary>
        <div className="story-production-grid">
          {tracks.map((track) => (
            <article key={track.key} className={`story-production-track story-production-track-${track.tone}`}>
              <div className="story-production-track-head">
                <div>
                  <span>{track.sourceLabel}</span>
                  <h4>{track.title}</h4>
                  <p>
                    Источник: <strong>{track.sourceValue}</strong> · Статус:{" "}
                    <strong>{track.statusLabel}</strong>
                  </p>
                  {track.ownerLabel ? (
                    <p>
                      {track.ownerLabel}: <strong>{track.ownerValue || "-"}</strong>
                    </p>
                  ) : null}
                </div>
                <div className="story-production-controls">{track.controls}</div>
              </div>

              <div className="story-production-metrics">
                {track.metrics.map((metric) => (
                  <div key={metric.key} className={`story-production-metric story-production-metric-${metric.tone}`}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </div>
                ))}
              </div>

              {track.alerts && track.alerts.length > 0 ? (
                <div className="story-production-alerts">{track.alerts}</div>
              ) : null}
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}

export default StoryProductionPanel;
