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

type MarkerContext = "video" | "titles";

interface MarkerBatchState {
  key: string;
  storyId: number;
  pending: Set<MarkerContext>;
}

interface StoryRequestState {
  storyId: number;
  generation: number;
}

export default function StoryScenarioPage({ storyId, activeTab, userId }: StoryScenarioPageProps) {
  const leaseCoordinator = useMemo(() => new EditLeaseHandoffCoordinator(), []);
  const [story, setStory] = useState<StoryListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [markerError, setMarkerError] = useState("");
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const currentStoryRef = useRef(storyId);
  currentStoryRef.current = storyId;
  const storyRequestRef = useRef<StoryRequestState>({ storyId, generation: 0 });
  if (storyRequestRef.current.storyId !== storyId) {
    storyRequestRef.current = { storyId, generation: 0 };
  }
  const markerContexts = useMemo(() => {
    const allowed = new Set(["video", "titles"]);
    return [...new Set(new URLSearchParams(window.location.search).getAll("production_context"))]
      .filter((context): context is MarkerContext => allowed.has(context));
  }, [storyId]);
  const markerKey = `${storyId}:${markerContexts.join(",")}`;
  const markerStateRef = useRef<MarkerBatchState>({
    key: markerKey,
    storyId,
    pending: new Set(markerContexts),
  });
  if (markerStateRef.current.key !== markerKey) {
    markerStateRef.current = { key: markerKey, storyId, pending: new Set(markerContexts) };
  }

  const loadStory = useCallback(async () => {
    const requestState = storyRequestRef.current;
    if (requestState.storyId !== storyId || currentStoryRef.current !== storyId) return;
    const generation = requestState.generation + 1;
    requestState.generation = generation;
    setLoading(true);
    setError("");
    try {
      const nextStory = await fetchStory(storyId);
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || storyRequestRef.current !== requestState
        || requestState.generation !== generation
      ) return;
      setStory(nextStory);
    } catch (requestError) {
      if (
        mountedRef.current
        && currentStoryRef.current === storyId
        && storyRequestRef.current === requestState
        && requestState.generation === generation
      ) {
        setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить сюжет");
      }
    } finally {
      if (
        mountedRef.current
        && currentStoryRef.current === storyId
        && storyRequestRef.current === requestState
        && requestState.generation === generation
      ) setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      storyRequestRef.current.generation += 1;
    };
  }, []);

  useEffect(() => { void loadStory(); }, [loadStory]);

  useEffect(() => {
    setMarkerError("");
    setLoadedRevision(null);
  }, [markerKey]);

  const markLoadedScenario = useCallback(async (revision: number) => {
    const batch = markerStateRef.current;
    if (
      !mountedRef.current
      || currentStoryRef.current !== storyId
      || batch.key !== markerKey
      || batch.storyId !== storyId
    ) return;
    setLoadedRevision(revision);
    const pending = [...batch.pending];
    if (!pending.length) return;
    const results = await Promise.allSettled(
      pending.map((context) => markScenarioOpened(storyId, revision, context)),
    );
    if (
      !mountedRef.current
      || currentStoryRef.current !== storyId
      || markerStateRef.current !== batch
      || batch.key !== markerKey
    ) return;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") batch.pending.delete(pending[index]);
    });
    setMarkerError(batch.pending.size
      ? "Не удалось отметить открытие актуального сценария."
      : "");
  }, [markerKey, storyId]);

  if (loading || (story !== null && story.id !== storyId && !error)) {
    return <p className="muted" role="status">Загрузка сюжета...</p>;
  }
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!story || story.id !== storyId) return <p className="error" role="alert">Сюжет не найден</p>;

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
