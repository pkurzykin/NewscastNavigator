import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchProduction,
  removeAssignment,
  setAssignment,
} from "../features/production/api";
import MaterialsList from "../features/production/components/MaterialsList";
import ProductionActions from "../features/production/components/ProductionActions";
import ProductionStages from "../features/production/components/ProductionStages";
import VoiceoverState from "../features/production/components/VoiceoverState";
import type { ProductionMutationCoordinator, ProductionReadModel } from "../features/production/types";
import StoryHeader from "../features/stories/components/StoryHeader";
import StoryTabs from "../features/stories/components/StoryTabs";


const assignmentLabels: Record<string, string> = {
  proofreader: "Корректор",
  video_editor: "Монтажёр",
  designer: "Дизайнер",
};

const assignmentKinds = ["proofreader", "video_editor", "designer"] as const;

interface AssignmentsProps {
  production: ProductionReadModel;
  mutationPending: boolean;
  onMutate: ProductionMutationCoordinator;
}

interface AssignmentDraft {
  value: string;
  serverValue: string;
  dirty: boolean;
}

function Assignments({ production, mutationPending, onMutate }: AssignmentsProps) {
  const serverSelection = useMemo(
    () => Object.fromEntries(
      production.assignments.map((assignment) => [assignment.kind, String(assignment.user.id)]),
    ),
    [production.assignments],
  );
  const serverSignature = assignmentKinds
    .map((kind) => `${kind}:${serverSelection[kind] ?? ""}`)
    .join("|");
  const [drafts, setDrafts] = useState<Record<string, AssignmentDraft>>(() => Object.fromEntries(
    assignmentKinds.map((kind) => [kind, {
      value: serverSelection[kind] ?? "",
      serverValue: serverSelection[kind] ?? "",
      dirty: false,
    }]),
  ));
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setDrafts((current) => Object.fromEntries(assignmentKinds.map((kind) => {
      const serverValue = serverSelection[kind] ?? "";
      const draft = current[kind];
      if (!draft || !draft.dirty) {
        return [kind, { value: serverValue, serverValue, dirty: false }];
      }
      if (draft.value === serverValue) {
        return [kind, { value: serverValue, serverValue, dirty: false }];
      }
      return [kind, { ...draft, serverValue }];
    })));
  }, [serverSignature]);

  const save = async (kind: string) => {
    const selectedId = drafts[kind]?.value;
    if (!selectedId || pendingKind !== null || mutationPending) return;
    setPendingKind(kind);
    setError("");
    try {
      await onMutate(() => setAssignment(production.story.id, kind, Number(selectedId)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось изменить назначение");
    } finally {
      setPendingKind(null);
    }
  };

  const remove = async (kind: string) => {
    if (pendingKind !== null || mutationPending) return;
    setPendingKind(kind);
    setError("");
    try {
      await onMutate(() => removeAssignment(production.story.id, kind));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось снять назначение");
    } finally {
      setPendingKind(null);
    }
  };

  return (
    <section className="production-section production-assignments" aria-labelledby="production-assignments-title">
      <header className="production-section-head">
        <div>
          <p className="production-kicker">Ответственные</p>
          <h3 id="production-assignments-title">Назначения</h3>
        </div>
      </header>
      <div className="production-assignment-list">
        {assignmentKinds.map((kind) => {
          const current = production.assignments.find((assignment) => assignment.kind === kind);
          const options = production.assignee_options.filter((option) => option.function_codes.includes(kind));
          return (
            <div className="production-assignment" key={kind}>
              <div>
                <strong>{assignmentLabels[kind]}</strong>
                {!production.can_manage_assignments ? (
                  <span>{current?.user.display_name ?? "Не назначен"}</span>
                ) : null}
              </div>
              {production.can_manage_assignments ? (
                <div className="production-assignment-controls">
                  <select
                    aria-label={`Ответственный: ${assignmentLabels[kind]}`}
                    value={drafts[kind]?.value ?? ""}
                    disabled={mutationPending || pendingKind !== null}
                    onChange={(event) => setDrafts((state) => ({
                      ...state,
                      [kind]: {
                        value: event.target.value,
                        serverValue: state[kind]?.serverValue ?? "",
                        dirty: event.target.value !== (state[kind]?.serverValue ?? ""),
                      },
                    }))}
                  >
                    <option value="">Не назначен</option>
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>{option.display_name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary"
                    disabled={mutationPending || pendingKind !== null || !drafts[kind]?.value}
                    onClick={() => void save(kind)}
                  >
                    {pendingKind === kind ? "Сохранение..." : "Сохранить"}
                  </button>
                  {current ? (
                    <button type="button" className="text-button" disabled={mutationPending || pendingKind !== null} onClick={() => void remove(kind)}>
                      Снять
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? <p className="error production-inline-error" role="alert">{error} Можно повторить действие.</p> : null}
    </section>
  );
}

export default function StoryProductionPage({ storyId }: { storyId: number }) {
  const [production, setProduction] = useState<ProductionReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [mutationPending, setMutationPending] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const requestGenerationRef = useRef(0);
  const currentStoryRef = useRef(storyId);
  const mutationInFlightRef = useRef(false);
  currentStoryRef.current = storyId;

  const refreshProduction = useCallback(async () => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    try {
      const response = await fetchProduction(storyId);
      if (
        requestGeneration !== requestGenerationRef.current
        || currentStoryRef.current !== storyId
      ) return false;
      setProduction(response);
      return true;
    } catch (requestError) {
      if (
        requestGeneration !== requestGenerationRef.current
        || currentStoryRef.current !== storyId
      ) return false;
      throw requestError;
    }
  }, [storyId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await refreshProduction();
    } catch (requestError) {
      if (currentStoryRef.current === storyId) {
        setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить производство");
      }
    } finally {
      if (currentStoryRef.current === storyId) setLoading(false);
    }
  }, [refreshProduction, storyId]);

  useEffect(() => {
    setProduction(null);
    setRefreshWarning("");
    void loadInitial();
  }, [loadInitial]);

  const mutateAndRefresh = useCallback<ProductionMutationCoordinator>(async (mutation) => {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setMutationPending(true);
    try {
      await mutation();
      try {
        const applied = await refreshProduction();
        if (applied) setRefreshWarning("");
      } catch {
        setRefreshWarning("Действие выполнено, но данные не обновились");
      }
    } finally {
      mutationInFlightRef.current = false;
      setMutationPending(false);
    }
  }, [refreshProduction]);

  const retryRefresh = useCallback(async () => {
    if (retryPending) return;
    setRetryPending(true);
    try {
      const applied = await refreshProduction();
      if (applied) setRefreshWarning("");
    } catch {
      setRefreshWarning("Действие выполнено, но данные не обновились");
    } finally {
      setRetryPending(false);
    }
  }, [refreshProduction, retryPending]);

  if (loading && !production) return <p className="muted" role="status">Загрузка производства...</p>;
  if (error && !production) {
    return (
      <section className="production-load-error" role="alert">
        <p className="error">{error}</p>
        <p>Проверьте соединение и повторите загрузку.</p>
        <button type="button" className="secondary" onClick={() => void loadInitial()}>Повторить загрузку</button>
      </section>
    );
  }
  if (!production) return <p className="error" role="alert">Сюжет не найден</p>;

  return (
    <section className="story-page production-page">
      <StoryHeader story={production.story} />
      <StoryTabs
        storyId={production.story.id}
        activeTab="production"
        scenarioContexts={[
          ...(production.video.has_unseen_scenario_changes ? ["video" as const] : []),
          ...(production.titles.has_unseen_scenario_changes ? ["titles" as const] : []),
        ]}
      />
      <section className="story-tab-panel production-panel" aria-label="Производство">
        {refreshWarning ? (
          <aside className="production-refresh-warning" role="alert">
            <span>{refreshWarning}</span>
            <button type="button" className="secondary" disabled={retryPending} onClick={() => void retryRefresh()}>
              {retryPending ? "Обновление..." : "Повторить обновление"}
            </button>
          </aside>
        ) : null}
        <div className="production-top-grid">
          <ProductionStages stages={production.stages} />
          <ProductionActions
            production={production}
            mutationPending={mutationPending}
            onMutate={mutateAndRefresh}
          />
        </div>
        <div className="production-detail-grid">
          <Assignments
            production={production}
            mutationPending={mutationPending}
            onMutate={mutateAndRefresh}
          />
          <VoiceoverState voiceover={production.voiceover} />
          <MaterialsList
            storyId={production.story.id}
            materials={production.materials}
            canAdd={production.story.archived_at === null}
            mutationPending={mutationPending}
            onMutate={mutateAndRefresh}
          />
        </div>
        {production.video.has_unseen_scenario_changes || production.titles.has_unseen_scenario_changes ? (
          <aside className="production-scenario-update" aria-label="Изменения сценария">
            <strong>Сценарий изменился после начала работы.</strong>
            <span>Откройте актуальный сценарий, чтобы увидеть свежий текст и сравнение.</span>
          </aside>
        ) : null}
      </section>
    </section>
  );
}
