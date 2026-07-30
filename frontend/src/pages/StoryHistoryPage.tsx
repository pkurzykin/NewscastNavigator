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
  StoryHistoryItem,
} from "../features/history/types";
import StoryHeader from "../features/stories/components/StoryHeader";
import StoryTabs from "../features/stories/components/StoryTabs";
import type { StoryListItem } from "../features/stories/types";

interface RestoreSelection {
  session: EditSessionHistoryItem;
  action: ActionRef;
}

const POSITIVE_INTEGER = /^[1-9]\d*$/;

function positiveIntegerParam(search: string, key: string): number | null {
  const rawValue = new URLSearchParams(search).get(key);
  if (!rawValue || !POSITIVE_INTEGER.test(rawValue)) return null;
  const value = Number(rawValue);
  return Number.isSafeInteger(value) ? value : null;
}

interface AddressedDiffReference {
  href: string;
  expectedSessionId: number | null;
}

function addressedDiffReference(
  storyId: number,
  search: string,
): AddressedDiffReference | null {
  const notificationId = positiveIntegerParam(search, "notification");
  if (notificationId !== null) {
    return {
      href: `/api/v1/stories/${storyId}/history/notifications/${notificationId}`,
      expectedSessionId: null,
    };
  }
  const sessionId = positiveIntegerParam(search, "session");
  return sessionId === null
    ? null
    : {
        href: `/api/v1/stories/${storyId}/history/edit-sessions/${sessionId}`,
        expectedSessionId: sessionId,
      };
}

function isNotificationComparison(item: EditSessionHistoryItem): boolean {
  return item.diff_href.includes("/history/notifications/");
}

export function mergeHistorySessions(
  ...groups: StoryHistoryItem[][]
): StoryHistoryItem[] {
  const itemsByKey = new Map<string, StoryHistoryItem>();
  groups.flat().forEach((item) => {
    const key = `${item.kind}:${item.id}`;
    const current = itemsByKey.get(key);
    if (
      !current
      || (
        item.kind === "edit_session"
        && current.kind === "edit_session"
        && isNotificationComparison(item)
        && !isNotificationComparison(current)
      )
    ) {
      itemsByKey.set(key, item);
    }
  });
  return [...itemsByKey.values()].sort((left, right) => {
    const leftAt = Date.parse(left.kind === "edit_session" ? left.ended_at : left.at);
    const rightAt = Date.parse(right.kind === "edit_session" ? right.ended_at : right.at);
    if (leftAt !== rightAt) return rightAt - leftAt;
    if (left.kind !== right.kind) return left.kind === "workflow_event" ? -1 : 1;
    return right.id - left.id;
  });
}

interface AddressedDiffResult {
  diff: ScenarioSessionDiffResponse | null;
  error: string;
}

async function loadAddressedDiff(
  reference: AddressedDiffReference,
): Promise<AddressedDiffResult> {
  try {
    const diff = await fetchScenarioSessionDiff(reference.href);
    if (
      reference.expectedSessionId !== null
      && diff.session.id !== reference.expectedSessionId
    ) {
      return {
        diff: null,
        error: "Сервер вернул другое сравнение. Повторите открытие изменений.",
      };
    }
    return { diff, error: "" };
  } catch (requestError) {
    return {
      diff: null,
      error: requestError instanceof Error
        ? requestError.message
        : "Не удалось загрузить выбранные изменения",
    };
  }
}

export default function StoryHistoryPage({ storyId }: { storyId: number }) {
  const [story, setStory] = useState<StoryListItem | null>(null);
  const [items, setItems] = useState<StoryHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [diffs, setDiffs] = useState<Record<number, ScenarioSessionDiffResponse | undefined>>({});
  const [diffLoadingId, setDiffLoadingId] = useState<number | null>(null);
  const [diffError, setDiffError] = useState("");
  const [diffErrorId, setDiffErrorId] = useState<number | null>(null);
  const [addressedDiffError, setAddressedDiffError] = useState("");
  const [addressedDiffLoading, setAddressedDiffLoading] = useState(false);
  const [restoreSelection, setRestoreSelection] = useState<RestoreSelection | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const addressedReference = addressedDiffReference(storyId, window.location.search);
      const addressedDiffPromise = addressedReference === null
        ? Promise.resolve<AddressedDiffResult>({ diff: null, error: "" })
        : loadAddressedDiff(addressedReference);
      const [response, addressedResult] = await Promise.all([
        fetchStoryHistory(storyId),
        addressedDiffPromise,
      ]);
      const addressedDiff = addressedResult.diff;
      setStory(response.story);
      setItems(mergeHistorySessions(
        addressedDiff ? [addressedDiff.session] : [],
        response.items,
      ));
      setNextCursor(response.next_cursor);
      setDiffs(addressedDiff ? { [addressedDiff.session.id]: addressedDiff } : {});
      setAddressedDiffError(addressedResult.error);
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
      setItems((current) => mergeHistorySessions(current, response.items));
      setNextCursor(response.next_cursor);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить ранние изменения");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleRetryAddressedDiff = async () => {
    const addressedReference = addressedDiffReference(storyId, window.location.search);
    if (addressedReference === null || addressedDiffLoading) return;
    setAddressedDiffLoading(true);
    const result = await loadAddressedDiff(addressedReference);
    const requestedDiff = result.diff;
    if (requestedDiff) {
      setItems((current) => mergeHistorySessions([requestedDiff.session], current));
      setDiffs((current) => ({
        ...current,
        [requestedDiff.session.id]: requestedDiff,
      }));
    }
    setAddressedDiffError(result.error);
    setAddressedDiffLoading(false);
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
  if (error && !story) {
    return (
      <section className="history-load-error" role="alert">
        <p className="error">{error}</p>
        <p>Проверьте соединение и повторите загрузку.</p>
        <button type="button" className="secondary" onClick={() => void loadInitial()}>Повторить загрузку</button>
      </section>
    );
  }
  if (!story) return <p className="error" role="alert">Сюжет не найден</p>;

  return (
    <section className="story-page history-page">
      <StoryHeader story={story} />
      <StoryTabs storyId={story.id} activeTab="history" />
      <section className="story-tab-panel history-panel" aria-label="История">
        <header className="history-panel-head">
          <div>
            <h3>История сюжета</h3>
            <p className="muted">
              Значимые этапы работы и сеансы редактирования; промежуточные автосохранения не показаны.
            </p>
          </div>
        </header>
        {addressedDiffError ? (
          <section className="history-load-error" role="alert">
            <p className="error"><strong>Не удалось открыть выбранные изменения.</strong> {addressedDiffError}</p>
            <p>Обычная история остаётся доступна. Проверьте соединение или доступ и повторите открытие.</p>
            <button
              type="button"
              className="secondary"
              disabled={addressedDiffLoading}
              onClick={() => void handleRetryAddressedDiff()}
            >
              {addressedDiffLoading ? "Повторное открытие..." : "Повторить открытие изменений"}
            </button>
          </section>
        ) : null}
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
