import type { ReactNode } from "react";

export type StoryTextStateTone = "fresh" | "stale" | "empty";

export interface StoryTextStateLane {
  key: string;
  label: string;
  value: string;
  detail: string;
  chipLabel: string;
  tone: StoryTextStateTone;
}

export interface StoryTextStateButton {
  key: string;
  label: string;
  busyLabel?: string;
  isBusy?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  onClick: () => void;
}

interface StoryTextStatePanelProps {
  workspaceSeqLabel: string;
  currentSeqLabel: string;
  actions: StoryTextStateButton[];
  lanes: StoryTextStateLane[];
  alerts: string[];
  diffActions: StoryTextStateButton[];
  diffContent?: ReactNode;
}

function StoryTextStatePanel({
  workspaceSeqLabel,
  currentSeqLabel,
  actions,
  lanes,
  alerts,
  diffActions,
  diffContent,
}: StoryTextStatePanelProps) {
  return (
    <section id="story-text-state" className="editor-text-state-card story-workspace-section">
      <div className="row between wrap editor-section-head editor-text-state-head">
        <div>
          <h3>Состояние текста</h3>
          <p className="muted">
            Автосохранение обновляет рабочий черновик <strong>{workspaceSeqLabel}</strong>.
            Производственный статус текста фиксируется только явным действием. Текущий текст:{" "}
            <strong>{currentSeqLabel}</strong>.
          </p>
        </div>
        <div className="row wrap editor-text-state-actions">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className={action.variant === "primary" ? undefined : "secondary"}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.isBusy && action.busyLabel ? action.busyLabel : action.label}
            </button>
          ))}
        </div>
      </div>

      <div className="editor-text-state-grid">
        {lanes.map((lane) => (
          <div
            key={lane.key}
            className={`project-summary text-state-lane text-state-lane-${lane.tone}`}
          >
            <p className="text-state-lane-label">{lane.label}</p>
            <p>
              <strong>{lane.value}</strong>
            </p>
            <p className="muted">{lane.detail}</p>
            <span className={`text-state-chip text-state-chip-${lane.tone}`}>
              {lane.chipLabel}
            </span>
          </div>
        ))}
      </div>

      {alerts.map((alert) => (
        <p key={alert} className="editor-text-state-alert">
          {alert}
        </p>
      ))}

      {diffActions.length > 0 ? (
        <div className="row wrap text-state-diff-actions">
          {diffActions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="secondary"
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.isBusy && action.busyLabel ? action.busyLabel : action.label}
            </button>
          ))}
        </div>
      ) : null}

      {diffContent}
    </section>
  );
}

export default StoryTextStatePanel;
