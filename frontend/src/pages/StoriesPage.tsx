import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchStories,
  fetchStoryCreateOptions,
  updateStoryManagement,
} from "../features/stories/api";
import AttentionQueue from "../features/notifications/components/AttentionQueue";
import StoryFilters from "../features/stories/components/StoryFilters";
import StoriesTable from "../features/stories/components/StoriesTable";
import CreateStoryDialog from "../features/stories/components/CreateStoryDialog";
import RubricManagementDialog from "../features/stories/components/RubricManagementDialog";
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
  const [managementError, setManagementError] = useState("");
  const [managementPendingStoryId, setManagementPendingStoryId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [rubricManagementOpen, setRubricManagementOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const rubricManagementTriggerRef = useRef<HTMLButtonElement>(null);
  const requestGenerationRef = useRef(0);
  const optionsGenerationRef = useRef(0);
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
  const loadCreateOptions = useCallback(async () => {
    const generation = optionsGenerationRef.current + 1;
    optionsGenerationRef.current = generation;
    try {
      const response = await fetchStoryCreateOptions();
      if (generation === optionsGenerationRef.current) {
        setCreateOptions(response);
        setCreateOptionsError("");
      }
    } catch (requestError) {
      if (generation === optionsGenerationRef.current) {
        setCreateOptionsError(
          requestError instanceof Error ? requestError.message : "Не удалось загрузить форму создания",
        );
      }
    }
  }, []);

  useEffect(() => {
    void loadCreateOptions();
    return () => {
      optionsGenerationRef.current += 1;
      requestGenerationRef.current += 1;
    };
  }, [loadCreateOptions]);

  const changeManagement = useCallback(async (
    story: StoryListItem,
    payload: { author_user_id?: number; priority?: StoryPriority },
  ) => {
    if (!story.management || managementPendingStoryId !== null) return;
    setManagementPendingStoryId(story.id);
    setManagementError("");
    try {
      await updateStoryManagement(story.management.action, payload);
      await loadStories(queryRef.current);
    } catch (requestError) {
      setManagementError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось изменить управление сюжетом",
      );
    } finally {
      setManagementPendingStoryId(null);
    }
  }, [loadStories, managementPendingStoryId]);

  const changePriority = useCallback((
    story: StoryListItem,
    priority: StoryPriority,
  ) => {
    if (priority === story.priority.code) return;
    void changeManagement(story, { priority });
  }, [changeManagement]);

  const changeAuthor = useCallback((
    story: StoryListItem,
    authorUserId: number,
  ) => {
    if (authorUserId === story.author.id) return;
    void changeManagement(story, { author_user_id: authorUserId });
  }, [changeManagement]);

  const refreshAfterRubricChange = useCallback(async () => {
    await loadCreateOptions();
    await loadStories(queryRef.current);
  }, [loadCreateOptions, loadStories]);

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
          {createOptions?.rubric_management ? (
            <ActionButton
              ref={rubricManagementTriggerRef}
              className="secondary"
              onClick={() => setRubricManagementOpen(true)}
            >
              Рубрики
            </ActionButton>
          ) : null}
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
      {managementError ? <p className="error" role="alert">{managementError}</p> : null}
      <AttentionQueue />
      <StoryFilters query={query} onChange={changeQuery} />
      {loading ? <p className="muted" role="status">Загрузка сюжетов...</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!loading && !error ? (
        <StoriesTable
          items={items}
          onOpenScenario={onOpenScenario}
          onPriorityChange={changePriority}
          onAuthorChange={changeAuthor}
          managementPendingStoryId={managementPendingStoryId}
        />
      ) : null}
      <CreateStoryDialog
        open={createOpen}
        options={createOptions}
        returnFocusRef={createTriggerRef}
        onClose={() => setCreateOpen(false)}
        onCreated={onOpenScenario}
      />
      <RubricManagementDialog
        open={rubricManagementOpen}
        management={createOptions?.rubric_management ?? null}
        returnFocusRef={rubricManagementTriggerRef}
        onClose={() => setRubricManagementOpen(false)}
        onChanged={refreshAfterRubricChange}
      />
    </section>
  );
}
