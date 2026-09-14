import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import { ApiError } from "../shared/api/client";

import {
  fetchScenarioSessionDiff,
  fetchStoryHistory,
  restoreScenarioSession,
} from "../features/history/api";
import HistoryTimeline, { type HistoryDiffState } from "../features/history/components/HistoryTimeline";
import RestoreScenarioDialog from "../features/history/components/RestoreScenarioDialog";
import type {
  ActionRef,
  EditSessionHistoryItem,
  ScenarioSessionDiffResponse,
  StoryHistoryItem,
} from "../features/history/types";
import StoryAuthorControl from "../features/stories/components/StoryAuthorControl";
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
  const [diffs, setDiffs] = useState<Record<number, HistoryDiffState>>({});
  const diffsRef = useRef(diffs);
  const [addressedDiffError, setAddressedDiffError] = useState("");
  const [addressedDiffLoading, setAddressedDiffLoading] = useState(false);
  const [restoreSelection, setRestoreSelection] = useState<RestoreSelection | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [restoreAcknowledged, setRestoreAcknowledged] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState("");
  const scopeRef = useRef(0);
  const storyIdRef = useRef(storyId);
  storyIdRef.current = storyId;
  const requestRef = useRef(0);
  const diffEpochRef = useRef(0);
  const moreRef = useRef(false);
  const addressedRef = useRef(false);
  const restoreRef = useRef(false);
  const acknowledgedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const replaceDiffs = (next: Record<number, HistoryDiffState>) => {
    diffsRef.current = next;
    setDiffs(next);
  };
  const recoverFocus = (scope: number, source: HTMLElement | null = null) => {
    requestAnimationFrame(() => {
      if (scope !== scopeRef.current || storyId !== storyIdRef.current) return;
      if (document.activeElement === document.body || (document.activeElement === source && !source?.isConnected)) headingRef.current?.focus();
    });
  };

  const loadInitial = useCallback(async (refreshOnly = false) => {
    const scope = scopeRef.current;
    const request = ++requestRef.current;
    const current = () => scope === scopeRef.current && storyId === storyIdRef.current && request === requestRef.current;
    setLoading(true);
    setError("");
    try {
      const reference = refreshOnly ? null : addressedDiffReference(storyId, window.location.search);
      const [response, addressedResult] = await Promise.all([
        fetchStoryHistory(storyId),
        reference ? loadAddressedDiff(reference) : Promise.resolve<AddressedDiffResult>({ diff: null, error: "" }),
      ]);
      if (!current()) return;
      const addressedDiff = addressedResult.diff;
      setStory(response.story);
      setItems(mergeHistorySessions(addressedDiff ? [addressedDiff.session] : [], response.items));
      setNextCursor(response.next_cursor);
      diffEpochRef.current++;
      replaceDiffs(addressedDiff ? { [addressedDiff.session.id]: {
        open: true, loading: false, error: "", href: addressedDiff.session.diff_href, data: addressedDiff,
      } } : {});
      setAddressedDiffError(addressedResult.error);
      if (acknowledgedRef.current) {
        acknowledgedRef.current = false;
        setRestoreAcknowledged(false);
        setRestoreNotice("Сценарий восстановлен. История обновлена.");
      }
    } catch (requestError) {
      if (current()) setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить историю");
    } finally {
      if (current()) setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    scopeRef.current++;
    requestRef.current++;
    diffEpochRef.current++;
    moreRef.current = false;
    addressedRef.current = false;
    restoreRef.current = false;
    acknowledgedRef.current = false;
    setStory(null); setItems([]); setNextCursor(null); replaceDiffs({});
    setLoadingMore(false); setAddressedDiffLoading(false); setAddressedDiffError("");
    setRestoreSelection(null); setRestoring(false); setRestoreAcknowledged(false); setRestoreNotice("");
    void loadInitial();
    return () => { scopeRef.current++; };
  }, [loadInitial]);

  const handleLoadMore = async () => {
    if (!nextCursor || moreRef.current || loading) return;
    const scope = scopeRef.current; const request = requestRef.current;
    const current = () => scope === scopeRef.current && storyId === storyIdRef.current && request === requestRef.current;
    moreRef.current = true; setLoadingMore(true); setError("");
    try {
      const response = await fetchStoryHistory(storyId, nextCursor);
      if (!current()) return;
      setItems(value => mergeHistorySessions(value, response.items)); setNextCursor(response.next_cursor);
    } catch (requestError) {
      if (current()) setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить ранние изменения");
    } finally {
      if (scope === scopeRef.current && storyId === storyIdRef.current) { moreRef.current = false; setLoadingMore(false); }
    }
  };

  const handleRetryAddressedDiff = async () => {
    const reference = addressedDiffReference(storyId, window.location.search);
    if (!reference || addressedRef.current) return;
    const scope = scopeRef.current; const epoch = diffEpochRef.current;
    addressedRef.current = true; setAddressedDiffLoading(true);
    const result = await loadAddressedDiff(reference);
    if (scope !== scopeRef.current || storyId !== storyIdRef.current) return;
    addressedRef.current = false; setAddressedDiffLoading(false);
    if (epoch !== diffEpochRef.current) return;
    if (result.diff) {
      const data = result.diff;
      setItems(value => mergeHistorySessions([data.session], value));
      replaceDiffs({ ...diffsRef.current, [data.session.id]: { open: true, loading: false, error: "", href: data.session.diff_href, data } });
    }
    setAddressedDiffError(result.error);
  };

  const handleShowDiff = async (item: EditSessionHistoryItem, retry = false) => {
    const cached = diffsRef.current[item.id];
    const existing = cached?.href === item.diff_href ? cached : undefined;
    if (existing?.open && !retry) {
      replaceDiffs({ ...diffsRef.current, [item.id]: { ...existing, open: false } });
      return;
    }
    if (existing?.data || existing?.loading) {
      replaceDiffs({ ...diffsRef.current, [item.id]: { ...existing, open: true } });
      return;
    }
    const scope = scopeRef.current; const epoch = diffEpochRef.current;
    const current = () => scope === scopeRef.current && storyId === storyIdRef.current && epoch === diffEpochRef.current && diffsRef.current[item.id]?.href === item.diff_href;
    replaceDiffs({ ...diffsRef.current, [item.id]: { open: true, loading: true, error: "", href: item.diff_href } });
    try {
      const data = await fetchScenarioSessionDiff(item.diff_href);
      if (!current()) return;
      if (data.session.id !== item.id) throw new Error("Сервер вернул другое сравнение. Повторите открытие изменений.");
      replaceDiffs({ ...diffsRef.current, [item.id]: { ...diffsRef.current[item.id], loading: false, error: "", data } });
    } catch (requestError) {
      if (current()) replaceDiffs({ ...diffsRef.current, [item.id]: { ...diffsRef.current[item.id], loading: false,
        error: requestError instanceof Error ? requestError.message : "Не удалось загрузить изменения" } });
    }
  };

  const handleRestoreRequest = (session: EditSessionHistoryItem) => {
    if (restoreRef.current || acknowledgedRef.current) return;
    const action = session.available_actions.find(candidate => candidate.code === "restore_scenario_session");
    if (action) { setRestoreError(""); setRestoreNotice(""); setRestoreSelection({ session, action }); }
  };
  const handleRestore = async () => {
    if (!restoreSelection || restoreRef.current || acknowledgedRef.current) return;
    const scope = scopeRef.current;
    const source = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = () => scope === scopeRef.current && storyId === storyIdRef.current;
    restoreRef.current = true; setRestoring(true); setRestoreError("");
    try {
      await restoreScenarioSession(restoreSelection.action);
      if (!current()) return;
      acknowledgedRef.current = true; setRestoreAcknowledged(true);
      setRestoreNotice("Сценарий восстановлен. Обновляем историю…");
      setRestoreSelection(null); diffEpochRef.current++; replaceDiffs({});
      recoverFocus(scope, source);
      await loadInitial(true);
    } catch (requestError) {
      if (!current()) return;
      if (requestError instanceof ApiError && requestError.code === "SCENARIO_ALREADY_CURRENT") {
        setRestoreSelection(null);
        setRestoreNotice(requestError.message);
        recoverFocus(scope, source);
      } else {
        setRestoreError(requestError instanceof Error ? requestError.message : "Не удалось восстановить сценарий");
      }
    } finally {
      if (current()) { restoreRef.current = false; setRestoring(false); }
    }
  };

  if ((loading && !story) || (story && story.id !== storyId)) return <p className="muted" role="status">Загрузка истории...</p>;
  if (error && !story) return (
    <section className="history-load-error" role="alert">
      <p className="error">{error}</p><p>Проверьте соединение и повторите загрузку.</p>
      <Button variant="outlined" onClick={() => void loadInitial()}>Повторить загрузку</Button>
    </section>
  );
  if (!story) return <p className="error" role="alert">Сюжет не найден</p>;
  return (
    <section className="story-page history-page">
      <StoryHeader story={story} actions={<StoryAuthorControl story={story} onChanged={patch => setStory(value => value?.id === story.id ? { ...value, ...patch } : value)} />} />
      <StoryTabs storyId={story.id} activeTab="history" />
      <section className="story-tab-panel history-panel" aria-label="История">
        <header className="history-panel-head"><div>
          <h3 ref={headingRef} tabIndex={-1}>История сюжета</h3>
          <p className="muted">Этапы работы и сохранённые изменения сценария.</p>
        </div></header>
        {restoreNotice ? <p className="history-restore-notice" role="status">{restoreAcknowledged && error
          ? "Сценарий восстановлен. Не удалось обновить историю — повторите загрузку." : restoreNotice}</p> : null}
        {addressedDiffError ? <section className="history-load-error" role="alert">
          <p className="error"><strong>Не удалось открыть выбранные изменения.</strong> {addressedDiffError}</p>
          <p>Обычная история остаётся доступна. Проверьте соединение или доступ и повторите открытие.</p>
          <Button variant="outlined" disabled={addressedDiffLoading} onClick={() => void handleRetryAddressedDiff()}>
            {addressedDiffLoading ? "Повторное открытие..." : "Повторить открытие изменений"}
          </Button>
        </section> : null}
        {error ? <section className="history-load-error" role="alert"><p className="error">{error}</p>
          <Button variant="outlined" disabled={loading} onClick={event => {
            const source = event.currentTarget; const scope = scopeRef.current;
            void loadInitial(acknowledgedRef.current).then(() => recoverFocus(scope, source));
          }}>Повторить загрузку истории</Button>
        </section> : null}
        <HistoryTimeline items={items} nextCursor={nextCursor} loadingMore={loadingMore || loading}
          onLoadMore={() => void handleLoadMore()} onShowDiff={(item, retry) => void handleShowDiff(item, retry)}
          onRestore={handleRestoreRequest} diffStates={diffs} restoreDisabled={restoring || restoreAcknowledged} />
      </section>
      {restoreSelection ? <RestoreScenarioDialog session={restoreSelection.session} action={restoreSelection.action}
        submitting={restoring} error={restoreError} onCancel={() => setRestoreSelection(null)} onConfirm={() => void handleRestore()} /> : null}
    </section>
  );
}
