import { useCallback, useEffect, useState } from "react";

import { fetchStory } from "../features/stories/api";
import StoryHeader from "../features/stories/components/StoryHeader";
import StoryTabs from "../features/stories/components/StoryTabs";
import type { StoryListItem } from "../features/stories/types";

type StoryTab = "scenario" | "production" | "history";

interface StoryScenarioPageProps {
  storyId: number;
  activeTab: StoryTab;
}

export default function StoryScenarioPage({ storyId, activeTab }: StoryScenarioPageProps) {
  const [story, setStory] = useState<StoryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStory(await fetchStory(storyId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить сюжет");
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => { void loadStory(); }, [loadStory]);

  if (loading) return <p className="muted" role="status">Загрузка сюжета...</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!story) return <p className="error" role="alert">Сюжет не найден</p>;

  return (
    <section className="story-page">
      <StoryHeader story={story} />
      <StoryTabs storyId={story.id} activeTab={activeTab} />
      <section className="story-tab-panel" aria-label={activeTab === "scenario" ? "Сценарий" : activeTab === "production" ? "Производство" : "История"}>
        {activeTab === "scenario" ? <p className="muted">Редактор актуального сценария будет подключён к этой карточке следующим вертикальным срезом.</p> : null}
        {activeTab === "production" ? <p className="muted">Производственные данные будут подключены следующим вертикальным срезом.</p> : null}
        {activeTab === "history" ? <p className="muted">История изменений будет подключена следующим вертикальным срезом.</p> : null}
      </section>
    </section>
  );
}
