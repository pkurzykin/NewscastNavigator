import { useCallback, useEffect, useState } from "react";

import { fetchStories, runStoryLifecycleAction } from "../features/stories/api";
import StoriesTable from "../features/stories/components/StoriesTable";
import type { ActionRef, StoryListItem } from "../features/stories/types";

export default function ArchivePage({ onOpenScenario }: { onOpenScenario: (storyId: number) => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchStories>>["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [pendingStoryId, setPendingStoryId] = useState<number | null>(null);

  const loadArchive = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems((await fetchStories({ scope: "archive", limit: 50 })).items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить архив");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadArchive(); }, [loadArchive]);

  const restore = async (story: StoryListItem, action: ActionRef) => {
    if (pendingStoryId !== null) return;
    setPendingStoryId(story.id);
    setMutationError("");
    try {
      await runStoryLifecycleAction(action);
      await loadArchive();
    } catch (requestError) {
      setMutationError(
        requestError instanceof Error ? requestError.message : "Не удалось вернуть сюжет в работу",
      );
    } finally {
      setPendingStoryId(null);
    }
  };

  return (
    <section className="stories-page" aria-labelledby="archive-page-title">
      <header className="stories-page-header"><div><p className="muted small">завершённые сюжеты</p><h2 id="archive-page-title">Архив</h2></div></header>
      {loading ? <p className="muted" role="status">Загрузка архива...</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {mutationError ? <p className="error" role="alert">{mutationError} Можно повторить действие.</p> : null}
      {!loading && !error ? (
        <StoriesTable
          items={items}
          onOpenScenario={onOpenScenario}
          onRunLifecycle={(story, action) => { void restore(story, action); }}
          lifecyclePendingStoryId={pendingStoryId}
        />
      ) : null}
    </section>
  );
}
