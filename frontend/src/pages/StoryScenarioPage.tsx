import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchStory } from "../features/stories/api";
import StoryHeader from "../features/stories/components/StoryHeader";
import StoryTabs from "../features/stories/components/StoryTabs";
import type { StoryListItem } from "../features/stories/types";
import ScenarioEditor from "../features/scenario/components/ScenarioEditor";
import { markScenarioOpened } from "../features/scenario/api";
import { EditLeaseHandoffCoordinator } from "../features/scenario/useEditLease";

interface StoryScenarioPageProps {
  storyId: number;
  activeTab: "scenario";
  userId: number;
}

export default function StoryScenarioPage({ storyId, activeTab, userId }: StoryScenarioPageProps) {
  const leaseCoordinator = useMemo(() => new EditLeaseHandoffCoordinator(), []);
  const [story, setStory] = useState<StoryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [markerError, setMarkerError] = useState("");
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const markerContexts = useMemo(() => {
    const allowed = new Set(["video", "titles"]);
    return [...new Set(new URLSearchParams(window.location.search).getAll("production_context"))]
      .filter((context): context is "video" | "titles" => allowed.has(context));
  }, [storyId]);
  const markerKey = `${storyId}:${markerContexts.join(",")}`;
  const markerStateRef = useRef<{ key: string; pending: Set<"video" | "titles"> }>({
    key: markerKey,
    pending: new Set(markerContexts),
  });
  if (markerStateRef.current.key !== markerKey) {
    markerStateRef.current = { key: markerKey, pending: new Set(markerContexts) };
  }

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

  const markLoadedScenario = useCallback(async (revision: number) => {
    setLoadedRevision(revision);
    const pending = [...markerStateRef.current.pending];
    if (!pending.length) return;
    const results = await Promise.allSettled(
      pending.map((context) => markScenarioOpened(storyId, revision, context)),
    );
    results.forEach((result, index) => {
      if (result.status === "fulfilled") markerStateRef.current.pending.delete(pending[index]);
    });
    setMarkerError(markerStateRef.current.pending.size
      ? "Не удалось отметить открытие актуального сценария."
      : "");
  }, [markerKey, storyId]);

  if (loading) return <p className="muted" role="status">Загрузка сюжета...</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!story) return <p className="error" role="alert">Сюжет не найден</p>;

  return (
    <section className="story-page">
      <StoryHeader story={story} />
      <StoryTabs storyId={story.id} activeTab={activeTab} />
      <section className="story-tab-panel" aria-label="Сценарий">
        {markerError ? (
          <p className="error" role="alert">
            {markerError}{" "}
            <button
              type="button"
              className="secondary"
              disabled={loadedRevision === null}
              onClick={() => { if (loadedRevision !== null) void markLoadedScenario(loadedRevision); }}
            >
              Повторить отметку открытия
            </button>
          </p>
        ) : null}
        <ScenarioEditor
          storyId={story.id}
          userId={userId}
          leaseCoordinator={leaseCoordinator}
          onScenarioLoaded={markLoadedScenario}
        />
      </section>
    </section>
  );
}
