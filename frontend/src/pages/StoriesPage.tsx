import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchStories,
  fetchStoryCreateOptions,
  updateStoryPriority,
} from "../features/stories/api";
import AttentionQueue from "../features/notifications/components/AttentionQueue";
import StoryFilters from "../features/stories/components/StoryFilters";
import StoriesTable from "../features/stories/components/StoriesTable";
import CreateStoryDialog from "../features/stories/components/CreateStoryDialog";
import ActionButton from "../features/stories/components/ActionButton";
import type {
  StoryCreateOptions,
  StoryListItem,
  StoryPriority,
} from "../features/stories/types";
import type { StoryListQuery } from "../features/stories/types";

interface StoriesPageProps {
  onOpenScenario: (storyId: number) => void;
}

const initialQuery: StoryListQuery = { scope: "active", limit: 50 };

export default function StoriesPage({ onOpenScenario }: StoriesPageProps) {
  const [query, setQuery] = useState<StoryListQuery>(initialQuery);
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchStories>>["items"]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOptions, setCreateOptions] = useState<StoryCreateOptions | null>(null);
  const [createOptionsError, setCreateOptionsError] = useState("");
  const [priorityError, setPriorityError] = useState("");
  const [priorityPendingStoryId, setPriorityPendingStoryId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const requestGenerationRef = useRef(0);
  const queryRef = useRef<StoryListQuery>(initialQuery);

  const loadStories = useCallback(async (activeQuery: StoryListQuery) => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setLoading(true);
    setError("");
    try {
      const response = await fetchStories(activeQuery);
      if (generation !== requestGenerationRef.current) return;
      setItems(response.items);
      setTotal(response.total);
    } catch (requestError) {
      if (generation !== requestGenerationRef.current) return;
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить сюжеты");
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStories(query); }, [loadStories, query]);
  useEffect(() => {
    let active = true;
    void fetchStoryCreateOptions()
      .then((response) => {
        if (!active) return;
        setCreateOptions(response);
        setCreateOptionsError("");
      })
      .catch((requestError) => {
        if (!active) return;
        setCreateOptionsError(
          requestError instanceof Error ? requestError.message : "Не удалось загрузить форму создания",
        );
      });
    return () => {
      active = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  const changePriority = useCallback(async (
    story: StoryListItem,
    priority: StoryPriority,
  ) => {
    if (!story.priority_action || priorityPendingStoryId !== null) return;
    setPriorityPendingStoryId(story.id);
    setPriorityError("");
    try {
      await updateStoryPriority(story.priority_action, priority);
      await loadStories(queryRef.current);
    } catch (requestError) {
      setPriorityError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось изменить приоритет",
      );
    } finally {
      setPriorityPendingStoryId(null);
    }
  }, [loadStories, priorityPendingStoryId]);

  const changeQuery = useCallback((nextQuery: StoryListQuery) => {
    queryRef.current = nextQuery;
    setQuery(nextQuery);
  }, []);

  return (
    <section className="stories-page" aria-labelledby="stories-page-title">
      <header className="stories-page-header">
        <div>
          <p className="muted small">общая редакционная картина</p>
          <h2 id="stories-page-title">Сюжеты</h2>
        </div>
        <div className="stories-page-actions">
          <p className="muted">Всего: {total}</p>
          {createOptions?.create_action ? (
            <ActionButton
              ref={createTriggerRef}
              className="primary"
              primaryAction
              onClick={() => setCreateOpen(true)}
            >
              {createOptions.create_action.label}
            </ActionButton>
          ) : null}
        </div>
      </header>
      {createOptionsError ? <p className="error" role="alert">{createOptionsError}</p> : null}
      {priorityError ? <p className="error" role="alert">{priorityError}</p> : null}
      <AttentionQueue />
      <StoryFilters query={query} onChange={changeQuery} />
      {loading ? <p className="muted" role="status">Загрузка сюжетов...</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!loading && !error ? (
        <StoriesTable
          items={items}
          onOpenScenario={onOpenScenario}
          onPriorityChange={changePriority}
          priorityPendingStoryId={priorityPendingStoryId}
        />
      ) : null}
      <CreateStoryDialog
        open={createOpen}
        options={createOptions}
        returnFocusRef={createTriggerRef}
        onClose={() => setCreateOpen(false)}
        onCreated={onOpenScenario}
      />
    </section>
  );
}
