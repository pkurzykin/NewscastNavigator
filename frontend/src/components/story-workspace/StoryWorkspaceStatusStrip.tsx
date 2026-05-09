export interface StoryWorkspaceStatusItem {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone?: "ok" | "warn" | "muted";
}

interface StoryWorkspaceStatusStripProps {
  items: StoryWorkspaceStatusItem[];
}

export default function StoryWorkspaceStatusStrip({ items }: StoryWorkspaceStatusStripProps) {
  return (
    <section className="story-status-strip" aria-label="Состояния карточки сюжета">
      {items.map((item) => (
        <div
          key={item.key}
          className={`story-status-card story-status-card-${item.tone || "muted"}`}
        >
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.detail}</small>
        </div>
      ))}
    </section>
  );
}
