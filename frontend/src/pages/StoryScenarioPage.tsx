import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchStory } from "../features/stories/api";
import StoryHeader from "../features/stories/components/StoryHeader";
import StoryTabs from "../features/stories/components/StoryTabs";
import type { StoryListItem } from "../features/stories/types";
import ScenarioEditor from "../features/scenario/components/ScenarioEditor";
import { EditLeaseHandoffCoordinator } from "../features/scenario/useEditLease";

type StoryTab = "scenario" | "production";

interface StoryScenarioPageProps {
  storyId: number;
  activeTab: StoryTab;
  userId: number;
}

export default function StoryScenarioPage({ storyId, activeTab, userId }: StoryScenarioPageProps) {
  const leaseCoordinator = useMemo(() => new EditLeaseHandoffCoordinator(), []);
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
      <section className="story-tab-panel" aria-label={activeTab === "scenario" ? "Сценарий" : "Производство"}>
        {activeTab === "scenario" ? <ScenarioEditor storyId={story.id} userId={userId} leaseCoordinator={leaseCoordinator} /> : null}
        {activeTab === "production" ? <p className="muted">Производственные данные будут подключены следующим вертикальным срезом.</p> : null}
      </section>
    </section>
  );
}
