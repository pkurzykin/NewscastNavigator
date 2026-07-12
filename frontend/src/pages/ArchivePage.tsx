import { useCallback, useEffect, useState } from "react";

import { fetchStories } from "../features/stories/api";
import StoriesTable from "../features/stories/components/StoriesTable";

export default function ArchivePage({ onOpenScenario }: { onOpenScenario: (storyId: number) => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchStories>>["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  return (
    <section className="stories-page" aria-labelledby="archive-page-title">
      <header className="stories-page-header"><div><p className="muted small">завершённые сюжеты</p><h2 id="archive-page-title">Архив</h2></div></header>
      {loading ? <p className="muted" role="status">Загрузка архива...</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!loading && !error ? <StoriesTable items={items} onOpenScenario={onOpenScenario} /> : null}
    </section>
  );
}
