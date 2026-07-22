import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createCorrectionPackage, fetchCorrectionPackages } from "../features/corrections/api";
import CorrectionPackageDialog from "../features/corrections/components/CorrectionPackageDialog";
import CorrectionPackageList from "../features/corrections/components/CorrectionPackageList";
import type {
  CorrectionAction,
  CorrectionPackagesResponse,
  CorrectionScope,
} from "../features/corrections/types";
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

interface ProductionRequestState {
  storyId: number;
  generation: number;
}

interface ProductionMutationState {
  storyId: number;
  sequence: number;
}

interface CorrectionDialogState {
  action: CorrectionAction;
  initialScope?: CorrectionScope;
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
  const [corrections, setCorrections] = useState<CorrectionPackagesResponse | null>(null);
  const [correctionsLoading, setCorrectionsLoading] = useState(false);
  const [correctionsError, setCorrectionsError] = useState("");
  const [correctionDialog, setCorrectionDialog] = useState<CorrectionDialogState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [mutationPending, setMutationPending] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const mountedRef = useRef(true);
  const currentStoryRef = useRef(storyId);
  currentStoryRef.current = storyId;
  const requestStateRef = useRef<ProductionRequestState>({ storyId, generation: 0 });
  const correctionRequestStateRef = useRef<ProductionRequestState>({ storyId, generation: 0 });
  const mutationSequenceRef = useRef(0);
  const mutationInFlightRef = useRef<ProductionMutationState | null>(null);
  if (requestStateRef.current.storyId !== storyId) {
    requestStateRef.current = { storyId, generation: 0 };
    correctionRequestStateRef.current = { storyId, generation: 0 };
    mutationInFlightRef.current = null;
  }

  const refreshProduction = useCallback(async (): Promise<ProductionReadModel | null> => {
    const requestState = requestStateRef.current;
    if (
      !mountedRef.current
      || currentStoryRef.current !== storyId
      || requestState.storyId !== storyId
    ) return null;
    const requestGeneration = requestState.generation + 1;
    requestState.generation = requestGeneration;
    try {
      const response = await fetchProduction(storyId);
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || requestStateRef.current !== requestState
        || requestGeneration !== requestState.generation
      ) return null;
      setProduction(response);
      return response;
    } catch (requestError) {
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || requestStateRef.current !== requestState
        || requestGeneration !== requestState.generation
      ) return null;
      throw requestError;
    }
  }, [storyId]);

  const refreshCorrections = useCallback(async (href: string, exposeSectionError = true) => {
    const requestState = correctionRequestStateRef.current;
    if (
      !mountedRef.current
      || currentStoryRef.current !== storyId
      || requestState.storyId !== storyId
    ) return false;
    const requestGeneration = requestState.generation + 1;
    requestState.generation = requestGeneration;
    setCorrectionsLoading(true);
    setCorrectionsError("");
    try {
      const response = await fetchCorrectionPackages(href);
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || correctionRequestStateRef.current !== requestState
        || requestGeneration !== requestState.generation
      ) return false;
      setCorrections(response);
      return true;
    } catch (requestError) {
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || correctionRequestStateRef.current !== requestState
        || requestGeneration !== requestState.generation
      ) return false;
      if (exposeSectionError) {
        setCorrectionsError(requestError instanceof Error ? requestError.message : "Не удалось загрузить пакеты правок");
      }
      throw requestError;
    } finally {
      if (
        mountedRef.current
        && currentStoryRef.current === storyId
        && correctionRequestStateRef.current === requestState
        && requestGeneration === requestState.generation
      ) setCorrectionsLoading(false);
    }
  }, [storyId]);

  const refreshReadModels = useCallback(async () => {
    const response = await refreshProduction();
    if (!response) return false;
    return refreshCorrections(response.corrections.href, false);
  }, [refreshCorrections, refreshProduction]);

  const loadInitial = useCallback(async () => {
    if (!mountedRef.current || currentStoryRef.current !== storyId) return;
    setLoading(true);
    setError("");
    try {
      const response = await refreshProduction();
      if (response) {
        try {
          await refreshCorrections(response.corrections.href);
        } catch {
          // The production page remains usable while this section offers its own retry.
        }
      }
    } catch (requestError) {
      if (mountedRef.current && currentStoryRef.current === storyId) {
        setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить производство");
      }
    } finally {
      if (mountedRef.current && currentStoryRef.current === storyId) setLoading(false);
    }
  }, [refreshCorrections, refreshProduction, storyId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestStateRef.current.generation += 1;
      correctionRequestStateRef.current.generation += 1;
      mutationInFlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    setProduction(null);
    setCorrections(null);
    setCorrectionsError("");
    setCorrectionDialog(null);
    setRefreshWarning("");
    setMutationPending(false);
    setRetryPending(false);
    void loadInitial();
  }, [loadInitial]);

  const mutateAndRefresh = useCallback<ProductionMutationCoordinator>(async (mutation) => {
    const mutationStoryId = storyId;
    if (
      !mountedRef.current
      || currentStoryRef.current !== mutationStoryId
      || mutationInFlightRef.current !== null
    ) return;
    const operation: ProductionMutationState = {
      storyId: mutationStoryId,
      sequence: mutationSequenceRef.current + 1,
    };
    mutationSequenceRef.current = operation.sequence;
    mutationInFlightRef.current = operation;
    const isCurrentOperation = () => (
      mountedRef.current
      && currentStoryRef.current === mutationStoryId
      && mutationInFlightRef.current === operation
    );
    setMutationPending(true);
    try {
      try {
        await mutation();
      } catch (requestError) {
        if (isCurrentOperation()) throw requestError;
        return;
      }
      if (!isCurrentOperation()) return;
      try {
        const applied = await refreshReadModels();
        if (applied && isCurrentOperation()) setRefreshWarning("");
      } catch {
        if (isCurrentOperation()) {
          setRefreshWarning("Действие выполнено, но данные не обновились");
        }
      }
    } finally {
      if (mutationInFlightRef.current === operation) {
        mutationInFlightRef.current = null;
        if (mountedRef.current && currentStoryRef.current === mutationStoryId) {
          setMutationPending(false);
        }
      }
    }
  }, [refreshReadModels, storyId]);

  const retryRefresh = useCallback(async () => {
    const retryStoryId = storyId;
    if (
      retryPending
      || !mountedRef.current
      || currentStoryRef.current !== retryStoryId
    ) return;
    setRetryPending(true);
    try {
      const applied = await refreshReadModels();
      if (applied && mountedRef.current && currentStoryRef.current === retryStoryId) {
        setRefreshWarning("");
      }
    } catch {
      if (mountedRef.current && currentStoryRef.current === retryStoryId) {
        setRefreshWarning("Действие выполнено, но данные не обновились");
      }
    } finally {
      if (mountedRef.current && currentStoryRef.current === retryStoryId) {
        setRetryPending(false);
      }
    }
  }, [refreshReadModels, retryPending, storyId]);

  const retryCorrections = useCallback(async () => {
    if (!production) return;
    try {
      await refreshCorrections(production.corrections.href);
    } catch {
      // The section keeps the error and the retry control visible.
    }
  }, [production, refreshCorrections]);

  if (production !== null && production.story.id !== storyId) {
    return <p className="muted" role="status">Загрузка производства...</p>;
  }
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
            onOpenCorrectionPackage={(action, initialScope) => setCorrectionDialog({ action, initialScope })}
          />
        </div>
        <CorrectionPackageList
          model={corrections}
          loading={correctionsLoading}
          error={correctionsError}
          mutationPending={mutationPending}
          onRetry={() => void retryCorrections()}
          onMutate={mutateAndRefresh}
          onCreate={(action, initialScope) => setCorrectionDialog({ action, initialScope })}
        />
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
      <CorrectionPackageDialog
        open={correctionDialog !== null}
        action={correctionDialog?.action ?? null}
        assigneeOptions={corrections?.assignee_options ?? []}
        initialScope={correctionDialog?.initialScope}
        mutationPending={mutationPending}
        onClose={() => setCorrectionDialog(null)}
        onSubmit={async (payload) => {
          if (!correctionDialog) return;
          await mutateAndRefresh(() => createCorrectionPackage(correctionDialog.action, payload));
        }}
      />
    </section>
  );
}
