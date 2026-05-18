interface StoryWorkspaceHeaderProps {
  projectId?: number | null;
  title: string;
  status: string;
  stateLabel: string;
  stateTone: "fresh" | "warn" | "muted";
  saveTone: string;
  saveLabel: string;
  saveDetail: string;
  role: string;
  onBackToMain: () => void;
}

export default function StoryWorkspaceHeader({
  projectId,
  title,
  status,
  stateLabel,
  stateTone,
  saveTone,
  saveLabel,
  saveDetail,
  role,
  onBackToMain,
}: StoryWorkspaceHeaderProps) {
  return (
    <section className="story-workspace-header" aria-label="Карточка сюжета">
      <div className="story-workspace-title-block">
        <button type="button" className="secondary story-back-button" onClick={onBackToMain}>
          Список сюжетов
        </button>
        <div>
          <p className="muted small">карточка сюжета</p>
          <h2>{title}</h2>
          <div className="project-text-state-badges">
            <span className="project-text-state-badge project-text-state-badge-muted">
              #{projectId || "-"}
            </span>
            <span className="project-text-state-badge project-text-state-badge-muted">
              {status}
            </span>
            <span className={`project-text-state-badge project-text-state-badge-${stateTone}`}>
              {stateLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="story-workspace-save-block">
        <div className={`editor-save-status editor-save-status-${saveTone}`}>
          <strong>{saveLabel}</strong>
          <span>{saveDetail}</span>
        </div>
        <p className="muted small">
          Роль: <strong>{role}</strong>
        </p>
      </div>
    </section>
  );
}
