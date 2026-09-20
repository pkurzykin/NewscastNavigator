import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button } from "@mui/material";
import { fetchStories, runStoryLifecycleAction } from "../features/stories/api";
import ArchiveDeleteDialog from "../features/stories/components/ArchiveDeleteDialog";
import StoriesTable from "../features/stories/components/StoriesTable";
import type { ActionRef, StoryListItem } from "../features/stories/types";

export default function ArchivePage({ onOpenScenario }: { onOpenScenario: (storyId: number) => void }) {
  const [items, setItems] = useState<StoryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [pendingStoryId, setPendingStoryId] = useState<number | null>(null);
  const [acknowledgedStoryId, setAcknowledgedStoryId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoryListItem | null>(null);
  const busy = useRef(false);
  const scope = useRef(0);
  const request = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const [focusRecovery, setFocusRecovery] = useState<{
    source: Element | null;
    isCurrent: () => boolean;
  } | null>(null);

  const recoverFocus = useCallback((source: Element | null, isCurrent: () => boolean) => {
    setFocusRecovery({ source, isCurrent });
  }, []);
  useEffect(() => {
    if (!focusRecovery) return;
    // Run after the dialog/removed row commits, so its focus trap cannot undo recovery.
    setFocusRecovery(null);
    const active = document.activeElement;
    if (focusRecovery.isCurrent() && (active === document.body || active === focusRecovery.source)) {
      heading.current?.focus();
    }
  }, [focusRecovery]);

  const loadArchive = useCallback(async (confirmedStoryId?: number, removedFocusSource?: Element | null) => {
    const currentScope = scope.current;
    const currentRequest = ++request.current;
    const isCurrent = () => scope.current === currentScope && request.current === currentRequest;
    setLoading(true); setError("");
    try {
      const result = await fetchStories({ scope: "archive", limit: 50 });
      if (isCurrent()) {
        setItems(result.items); setTotal(result.total);
        if (confirmedStoryId != null) {
          setAcknowledgedStoryId((current) => current === confirmedStoryId ? null : current);
          if (!result.items.some((item) => item.id === confirmedStoryId)) {
            recoverFocus(removedFocusSource ?? null, isCurrent);
          }
        }
      }
    } catch (requestError) {
      if (isCurrent()) setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить архив");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [recoverFocus]);

  useEffect(() => {
    scope.current += 1;
    void loadArchive();
    return () => { scope.current += 1; };
  }, [loadArchive]);

  const mutate = async (story: StoryListItem, action: ActionRef) => {
    if (busy.current) return;
    const currentScope = scope.current;
    const isCurrent = () => scope.current === currentScope;
    const focusSource = document.activeElement;
    busy.current = true;
    setPendingStoryId(story.id); setMutationError("");
    try {
      await runStoryLifecycleAction(action);
      if (!isCurrent()) return;
      setAcknowledgedStoryId(story.id);
      setDeleteTarget(null);
      recoverFocus(focusSource, isCurrent);
      await loadArchive(story.id);
    } catch (requestError) {
      if (isCurrent()) setMutationError(requestError instanceof Error ? requestError.message : "Не удалось выполнить действие");
    } finally {
      if (isCurrent()) { busy.current = false; setPendingStoryId(null); }
    }
  };

  return <section className="stories-page" aria-labelledby="archive-page-title">
    <h2 id="archive-page-title" className="visually-hidden" tabIndex={-1} ref={heading}>Архив</h2>
    {loading ? <p className="muted" role="status">Загрузка архива…</p> : null}
    {error ? <Alert severity="error" action={<Button color="inherit" disabled={loading || pendingStoryId !== null}
      onClick={(event) => { void loadArchive(acknowledgedStoryId ?? undefined, event.currentTarget); }}>Повторить обновление</Button>}>{error}</Alert> : null}
    {mutationError && !deleteTarget ? <Alert severity="error">{mutationError} Можно повторить действие.</Alert> : null}
    {!loading || items.length > 0 ? <StoriesTable variant="archive" items={items}
      onOpenScenario={onOpenScenario} onRunLifecycle={(story, action) => { void mutate(story, action); }}
      lifecyclePendingStoryId={pendingStoryId ?? acknowledgedStoryId}
      lifecycleAcknowledgedStoryId={acknowledgedStoryId}
      onDelete={(story) => { if (!busy.current) { setMutationError(""); setDeleteTarget(story); } }} /> : null}
    <p className="stories-result-count">Показано {items.length} из {total}</p>
    {deleteTarget ? <ArchiveDeleteDialog story={deleteTarget} pending={pendingStoryId !== null} error={mutationError}
      onCancel={() => { if (!busy.current) { setDeleteTarget(null); setMutationError(""); } }}
      onConfirm={() => { if (deleteTarget.delete_action) void mutate(deleteTarget, deleteTarget.delete_action); }} /> : null}
  </section>;
}
