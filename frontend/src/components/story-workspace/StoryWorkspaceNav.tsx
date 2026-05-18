interface StoryWorkspaceNavProps {
  reviewMode: boolean;
  rowsEditable: boolean;
  restrictionMessage?: string | null;
  onSetEditMode: () => void;
  onSetReviewMode: () => void;
}

const STORY_WORKSPACE_SECTIONS = [
  { href: "#story-overview", label: "Обзор" },
  { href: "#story-text", label: "Текст" },
  { href: "#story-materials", label: "Материалы" },
  { href: "#story-comments", label: "Правки" },
  { href: "#story-production", label: "Производство" },
  { href: "#story-history", label: "История" },
];

export default function StoryWorkspaceNav({
  reviewMode,
  rowsEditable,
  restrictionMessage,
  onSetEditMode,
  onSetReviewMode,
}: StoryWorkspaceNavProps) {
  return (
    <section className="story-workspace-nav-panel" aria-label="Навигация карточки сюжета">
      <nav className="story-workspace-section-nav" aria-label="Разделы карточки">
        {STORY_WORKSPACE_SECTIONS.map((section) => (
          <a key={section.href} href={section.href}>
            {section.label}
          </a>
        ))}
      </nav>

      <div className="story-workspace-mode">
        <div className="editor-mode-copy">
          <span className="muted small">режим работы</span>
          <strong>{reviewMode ? "Проверка текста" : "Редактирование текста"}</strong>
          <span className="muted small">
            {reviewMode
              ? "Фокус на чтении, комментариях и выборе строк."
              : rowsEditable
                ? "Строки сценария доступны для правки."
                : "Строки сценария доступны только для просмотра."}
          </span>
        </div>
        <div className="editor-view-toggle" role="tablist" aria-label="Режим просмотра редактора">
          <button
            type="button"
            className={`editor-view-toggle-button${!reviewMode ? " active" : ""}`}
            aria-selected={!reviewMode}
            onClick={onSetEditMode}
          >
            Редактирование
          </button>
          <button
            type="button"
            className={`editor-view-toggle-button${reviewMode ? " active" : ""}`}
            aria-selected={reviewMode}
            onClick={onSetReviewMode}
          >
            Проверка
          </button>
        </div>
        {restrictionMessage ? <p className="editor-mode-warning">{restrictionMessage}</p> : null}
      </div>
    </section>
  );
}
