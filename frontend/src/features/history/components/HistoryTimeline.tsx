import { formatDateTime } from "../../../shared/date";
import type {
  EditSessionHistoryItem,
  ScenarioSessionDiffResponse,
  StoryHistoryItem,
  WorkflowEventHistoryItem,
} from "../types";
import ScenarioSessionDiff from "./ScenarioSessionDiff";

interface HistoryTimelineProps {
  items: StoryHistoryItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  onShowDiff: (item: EditSessionHistoryItem) => void;
  onRestore: (item: EditSessionHistoryItem) => void;
  openDiffs?: Record<number, ScenarioSessionDiffResponse | undefined>;
  diffLoadingId?: number | null;
  diffError?: string;
  diffErrorId?: number | null;
}

const EMPTY_DIFFS: Record<number, ScenarioSessionDiffResponse | undefined> = {};

function Summary({ item }: { item: EditSessionHistoryItem }) {
  const summary = item.diff_summary;
  return (
    <p className="history-session-summary">
      <span>Добавлено: {summary.added}</span>
      <span>Удалено: {summary.removed}</span>
      <span>Изменено: {summary.changed}</span>
      <span>Перемещено: {summary.moved}</span>
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
  openDiffs = EMPTY_DIFFS,
  diffLoadingId = null,
  diffError = "",
  diffErrorId = null,
}: HistoryTimelineProps) {
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
              <button type="button" className="secondary" onClick={() => onShowDiff(item)} disabled={diffLoadingId === item.id}>
                {diffLoadingId === item.id ? "Загрузка изменений..." : "Показать изменения"}
              </button>
              {restoreAction ? (
                <button type="button" className={restoreAction.emphasis === "danger" ? "danger" : "secondary"} onClick={() => onRestore(item)}>
                  {restoreAction.label}
                </button>
              ) : null}
            </div>
            {diffLoadingId === item.id ? <p className="muted" role="status">Загрузка сравнения...</p> : null}
            {diffError && diffErrorId === item.id ? <p className="error" role="alert">{diffError}</p> : null}
            {openDiffs[item.id] ? <ScenarioSessionDiff diff={openDiffs[item.id]!} /> : null}
          </article>
        );
      })}
      {nextCursor ? (
        <button type="button" className="secondary history-load-more" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? "Загрузка..." : "Показать более ранние изменения"}
        </button>
      ) : null}
    </div>
  );
}
