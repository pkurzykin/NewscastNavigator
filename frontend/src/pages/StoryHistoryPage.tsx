import { useCallback, useEffect, useState } from "react";

import {
  fetchScenarioSessionDiff,
  fetchStoryHistory,
  restoreScenarioSession,
} from "../features/history/api";
import HistoryTimeline from "../features/history/components/HistoryTimeline";
import RestoreScenarioDialog from "../features/history/components/RestoreScenarioDialog";
import type {
  ActionRef,
  EditSessionHistoryItem,
  ScenarioSessionDiffResponse,
} from "../features/history/types";
import StoryHeader from "../features/stories/components/StoryHeader";
import StoryTabs from "../features/stories/components/StoryTabs";
import type { StoryListItem } from "../features/stories/types";

interface RestoreSelection {
  session: EditSessionHistoryItem;
  action: ActionRef;
}

export default function StoryHistoryPage({ storyId }: { storyId: number }) {
  const [story, setStory] = useState<StoryListItem | null>(null);
  const [items, setItems] = useState<EditSessionHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [diffs, setDiffs] = useState<Record<number, ScenarioSessionDiffResponse | undefined>>({});
  const [diffLoadingId, setDiffLoadingId] = useState<number | null>(null);
  const [diffError, setDiffError] = useState("");
  const [diffErrorId, setDiffErrorId] = useState<number | null>(null);
  const [restoreSelection, setRestoreSelection] = useState<RestoreSelection | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchStoryHistory(storyId);
      setStory(response.story);
      setItems(response.items);
      setNextCursor(response.next_cursor);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить историю");
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetchStoryHistory(storyId, nextCursor);
      setItems((current) => [...current, ...response.items]);
      setNextCursor(response.next_cursor);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить ранние изменения");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleShowDiff = async (item: EditSessionHistoryItem) => {
    if (diffs[item.id] || diffLoadingId !== null) return;
    setDiffLoadingId(item.id);
    setDiffError("");
    setDiffErrorId(null);
    try {
      const response = await fetchScenarioSessionDiff(item.diff_href);
      setDiffs((current) => ({ ...current, [item.id]: response }));
    } catch (requestError) {
      setDiffError(requestError instanceof Error ? requestError.message : "Не удалось загрузить изменения");
      setDiffErrorId(item.id);
    } finally {
      setDiffLoadingId(null);
    }
  };

  const handleRestoreRequest = (session: EditSessionHistoryItem) => {
    const action = session.available_actions.find((candidate) => candidate.code === "restore_scenario_session");
    if (!action) return;
    setRestoreError("");
    setRestoreSelection({ session, action });
  };

  const handleRestore = async () => {
    if (!restoreSelection || restoring) return;
    setRestoring(true);
    setRestoreError("");
    try {
      await restoreScenarioSession(restoreSelection.action);
      setRestoreSelection(null);
      setDiffs({});
      await loadInitial();
    } catch (requestError) {
      setRestoreError(requestError instanceof Error ? requestError.message : "Не удалось восстановить сценарий");
    } finally {
      setRestoring(false);
    }
  };

  if (loading && !story) return <p className="muted" role="status">Загрузка истории...</p>;
  if (error && !story) return <p className="error" role="alert">{error}</p>;
  if (!story) return <p className="error" role="alert">Сюжет не найден</p>;

  return (
    <section className="story-page history-page">
      <StoryHeader story={story} />
      <StoryTabs storyId={story.id} activeTab="history" />
      <section className="story-tab-panel history-panel" aria-label="История">
        <header className="history-panel-head">
          <div>
            <h3>История сценария</h3>
            <p className="muted">Сеансы редактирования сгруппированы; промежуточные автосохранения не показаны.</p>
          </div>
        </header>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <HistoryTimeline
          items={items}
          nextCursor={nextCursor}
          loadingMore={loadingMore}
          onLoadMore={() => void handleLoadMore()}
          onShowDiff={(item) => void handleShowDiff(item)}
          onRestore={handleRestoreRequest}
          openDiffs={diffs}
          diffLoadingId={diffLoadingId}
          diffError={diffError}
          diffErrorId={diffErrorId}
        />
      </section>
      {restoreSelection ? (
        <RestoreScenarioDialog
          session={restoreSelection.session}
          action={restoreSelection.action}
          submitting={restoring}
          error={restoreError}
          onCancel={() => setRestoreSelection(null)}
          onConfirm={() => void handleRestore()}
        />
      ) : null}
    </section>
  );
}
