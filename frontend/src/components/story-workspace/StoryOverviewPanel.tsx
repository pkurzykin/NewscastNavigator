export type StoryOverviewTone = "fresh" | "warn" | "muted";

export interface StoryOverviewItem {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone?: StoryOverviewTone;
}

export interface StoryOverviewNextAction {
  label: string;
  detail: string;
  href: string;
  tone?: StoryOverviewTone;
}

interface StoryOverviewPanelProps {
  nextAction: StoryOverviewNextAction;
  signals: StoryOverviewItem[];
  people: StoryOverviewItem[];
  production: StoryOverviewItem[];
}

function StoryOverviewPanel({
  nextAction,
  signals,
  people,
  production,
}: StoryOverviewPanelProps) {
  return (
    <section id="story-overview" className="story-overview-panel story-workspace-section">
      <div className="story-overview-primary">
        <div>
          <p className="story-overview-eyebrow">обзор карточки</p>
          <h3>Следующий рабочий шаг</h3>
          <p>{nextAction.detail}</p>
        </div>
        <a
          className={`story-overview-next story-overview-next-${nextAction.tone || "fresh"}`}
          href={nextAction.href}
        >
          {nextAction.label}
        </a>
      </div>

      <div className="story-overview-grid" aria-label="Ключевые сигналы карточки">
        {signals.map((item) => (
          <div key={item.key} className={`story-overview-card story-overview-card-${item.tone || "muted"}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>

      <div className="story-overview-secondary">
        <div>
          <h4>Команда</h4>
          <div className="story-overview-list">
            {people.map((item) => (
              <div key={item.key}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4>Производство</h4>
          <div className="story-overview-list">
            {production.map((item) => (
              <div key={item.key} className={`story-overview-inline-${item.tone || "muted"}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default StoryOverviewPanel;
