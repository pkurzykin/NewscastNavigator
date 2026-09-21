import { useId } from "react";
import Button from "@mui/material/Button";
import { formatDateTime } from "../../../shared/date";
import type {
  EditSessionHistoryItem,
  ScenarioSessionDiffResponse,
  StoryHistoryItem,
  WorkflowEventHistoryItem,
} from "../types";
import ScenarioSessionDiff from "./ScenarioSessionDiff";

export interface HistoryDiffState {
  open: boolean;
  loading: boolean;
  error: string;
  href: string;
  data?: ScenarioSessionDiffResponse;
}

interface HistoryTimelineProps {
  items: StoryHistoryItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  onShowDiff: (item: EditSessionHistoryItem, retry?: boolean) => void;
  onRestore: (item: EditSessionHistoryItem) => void;
  diffStates?: Record<number, HistoryDiffState>;
  restoreDisabled?: boolean;
}

const EMPTY_DIFFS: Record<number, HistoryDiffState> = {};

function Summary({ item }: { item: EditSessionHistoryItem }) {
  const summary = item.diff_summary;
  return (
    <p className="history-session-summary">
      <span>Добавлено: {summary.added}</span>
      <span>Удалено: {summary.removed}</span>
      <span>Изменено: {summary.changed}</span>
      <span>Перемещено: {summary.moved}</span>
      {summary.settings_changed ? <span>Основной шрифт изменён</span> : null}
    </p>
  );
}

function WorkflowEvent({ item }: { item: WorkflowEventHistoryItem }) {
  return (
    <>
      <header className="history-session-head">
        <div>
          <h3>{item.label}</h3>
          <p className="muted small">
            {item.actor
              ? `${item.actor.display_name} · ${item.actor.position}`
              : "Системное событие"}{" "}
            · {formatDateTime(item.at)}
          </p>
        </div>
      </header>
      {item.summary ? <p className="history-event-summary">{item.summary}</p> : null}
    </>
  );
}

export default function HistoryTimeline({
  items,
  nextCursor,
  loadingMore,
  onLoadMore,
  onShowDiff,
  onRestore,
  diffStates = EMPTY_DIFFS,
  restoreDisabled = false,
}: HistoryTimelineProps) {
  const id = useId();
  if (items.length === 0) {
    return <p className="muted history-empty">Содержательной истории пока нет.</p>;
  }

  return (
    <div className="history-timeline">
      <div className="history-timeline-line" aria-hidden="true" />
      {items.map((item) => {
        if (item.kind === "workflow_event") {
          return (
            <article className="history-session history-event" key={`${item.kind}:${item.id}`}>
              <span className="history-session-marker" aria-hidden="true" />
              <WorkflowEvent item={item} />
            </article>
          );
        }
        const state = diffStates[item.id];
        const panelId = `${id}-diff-${item.id}`;
        const restoreAction = item.available_actions.find((action) => action.code === "restore_scenario_session");
        return (
          <article className="history-session" key={`${item.kind}:${item.id}`}>
            <span className="history-session-marker" aria-hidden="true" />
            <header className="history-session-head">
              <div>
                <h3>{item.actor.display_name}</h3>
                <p className="muted small">{item.actor.position} · {formatDateTime(item.ended_at)}</p>
              </div>
            </header>
            <Summary item={item} />
            <div className="history-session-actions">
              <Button variant="outlined" onClick={() => onShowDiff(item)} aria-expanded={state?.open ?? false} aria-controls={panelId}>
                {state?.open ? "Скрыть изменения" : "Показать изменения"}
              </Button>
              {restoreAction ? <Button variant="text" color="error" disabled={restoreDisabled} onClick={() => onRestore(item)}>
                {restoreAction.label}
              </Button> : null}
            </div>
            <div id={panelId} hidden={!state?.open}>
              {state?.open && state.loading ? <p className="muted" role="status">Загрузка сравнения...</p> : null}
              {state?.open && state.error ? <div className="history-load-error" role="alert">
                <p className="error">{state.error}</p>
                <Button variant="outlined" onClick={() => onShowDiff(item, true)}>Повторить загрузку изменений</Button>
              </div> : null}
              {state?.open && state.data ? <ScenarioSessionDiff diff={state.data} /> : null}
            </div>
          </article>
        );
      })}
      {nextCursor ? (
        <Button variant="outlined" className="history-load-more" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? "Загрузка..." : "Показать более ранние изменения"}
        </Button>
      ) : null}
    </div>
  );
}
