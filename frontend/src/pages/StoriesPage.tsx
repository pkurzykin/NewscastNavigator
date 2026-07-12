import { useCallback, useEffect, useState } from "react";

import { fetchStories } from "../features/stories/api";
import StoryFilters from "../features/stories/components/StoryFilters";
import StoriesTable from "../features/stories/components/StoriesTable";
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

  const loadStories = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchStories(query);
      setItems(response.items);
      setTotal(response.total);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить сюжеты");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void loadStories(); }, [loadStories]);

  return (
    <section className="stories-page" aria-labelledby="stories-page-title">
      <header className="stories-page-header">
        <div>
          <p className="muted small">общая редакционная картина</p>
          <h2 id="stories-page-title">Сюжеты</h2>
        </div>
        <p className="muted">Всего: {total}</p>
      </header>
      <StoryFilters query={query} onChange={setQuery} />
      {loading ? <p className="muted" role="status">Загрузка сюжетов...</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!loading && !error ? <StoriesTable items={items} onOpenScenario={onOpenScenario} /> : null}
    </section>
  );
}
