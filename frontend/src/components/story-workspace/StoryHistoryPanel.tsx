import type { ReactNode } from "react";

interface StoryHistoryPanelProps {
  historyCount: number;
  revisionCount: number;
  currentRevision: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}

export default function StoryHistoryPanel({
  historyCount,
  revisionCount,
  currentRevision,
  actions,
  children,
}: StoryHistoryPanelProps) {
  return (
    <section id="story-history" className="story-history-panel story-workspace-section">
      <div className="story-history-head">
        <div>
          <p className="story-overview-eyebrow">история и версии</p>
          <h3>История</h3>
          <p>
            События карточки, сохраненные версии текста, согласование и сравнение изменений
            доступны из одного раздела.
          </p>
        </div>
        <div className="story-history-summary" aria-label="Сводка истории">
          <div>
            <span>события</span>
            <strong>{historyCount}</strong>
          </div>
          <div>
            <span>версии</span>
            <strong>{revisionCount}</strong>
          </div>
        </div>
      </div>

      <div className="story-history-revision-strip">
        <div>{currentRevision}</div>
        <div className="story-history-actions">{actions}</div>
      </div>

      <div className="story-history-body">{children}</div>
    </section>
  );
}
