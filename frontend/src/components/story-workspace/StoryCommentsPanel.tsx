import { forwardRef, type ReactNode } from "react";

interface StoryCommentsPanelProps {
  openCount: number;
  myOpenCount: number;
  textCount: number;
  editCount: number;
  titlesCount: number;
  voiceoverCount: number;
  children: ReactNode;
}

const StoryCommentsPanel = forwardRef<HTMLDivElement, StoryCommentsPanelProps>(
  (
    {
      openCount,
      myOpenCount,
      textCount,
      editCount,
      titlesCount,
      voiceoverCount,
      children,
    },
    ref
  ) => (
    <section id="story-comments" ref={ref} className="story-comments-panel story-workspace-section">
      <div className="story-comments-head">
        <div>
          <p className="story-overview-eyebrow">правки и замечания</p>
          <h3>Правки</h3>
          <p>
            Правки, назначение исполнителей, сравнения текста и этапы задач собраны
            в одном рабочем блоке карточки.
          </p>
        </div>
        <div className="story-comments-summary" aria-label="Сводка правок">
          <div>
            <span>открыто</span>
            <strong>{openCount}</strong>
          </div>
          <div>
            <span>на мне</span>
            <strong>{myOpenCount}</strong>
          </div>
        </div>
      </div>

      <div className="story-comments-counts" aria-label="Правки по трекам">
        <span>Текст {textCount}</span>
        <span>Монтаж {editCount}</span>
        <span>Титры {titlesCount}</span>
        <span>Озвучка {voiceoverCount}</span>
      </div>

      <div className="story-comments-body">{children}</div>
    </section>
  )
);

StoryCommentsPanel.displayName = "StoryCommentsPanel";

export default StoryCommentsPanel;
