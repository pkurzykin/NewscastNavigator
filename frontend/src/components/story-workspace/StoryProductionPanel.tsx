import type { ReactNode } from "react";

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
}

function StoryProductionPanel({ tracks }: StoryProductionPanelProps) {
  const attentionCount = tracks.filter((track) => track.tone === "warn" || track.tone === "stale").length;

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
            а не к случайному последнему autosave.
          </p>
        </div>
        <div className={`story-production-attention story-production-attention-${attentionCount > 0 ? "warn" : "fresh"}`}>
          <span>требует внимания</span>
          <strong>{attentionCount}</strong>
        </div>
      </div>

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
    </section>
  );
}

export default StoryProductionPanel;
