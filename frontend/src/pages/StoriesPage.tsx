import { useCallback, useEffect, useRef, useState } from "react";

import { fetchStories, fetchStoryCreateOptions } from "../features/stories/api";
import AttentionQueue from "../features/notifications/components/AttentionQueue";
import StoryFilters from "../features/stories/components/StoryFilters";
import StoriesTable from "../features/stories/components/StoriesTable";
import CreateStoryDialog from "../features/stories/components/CreateStoryDialog";
import type { StoryCreateOptions } from "../features/stories/types";
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
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const requestGenerationRef = useRef(0);

  const loadStories = useCallback(async () => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setLoading(true);
    setError("");
    try {
      const response = await fetchStories(query);
      if (generation !== requestGenerationRef.current) return;
      setItems(response.items);
      setTotal(response.total);
    } catch (requestError) {
      if (generation !== requestGenerationRef.current) return;
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить сюжеты");
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => { void loadStories(); }, [loadStories]);
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
            <button
              ref={createTriggerRef}
              type="button"
              className="primary"
              onClick={() => setCreateOpen(true)}
            >
              {createOptions.create_action.label}
            </button>
          ) : null}
        </div>
      </header>
      {createOptionsError ? <p className="error" role="alert">{createOptionsError}</p> : null}
      <AttentionQueue />
      <StoryFilters query={query} onChange={setQuery} />
      {loading ? <p className="muted" role="status">Загрузка сюжетов...</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!loading && !error ? <StoriesTable items={items} onOpenScenario={onOpenScenario} /> : null}
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
