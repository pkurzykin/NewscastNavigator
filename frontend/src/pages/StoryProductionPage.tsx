import { useCallback, useEffect, useRef, useState } from "react";

import { createCorrectionPackage, fetchCorrectionPackages } from "../features/corrections/api";
import CorrectionPackageDialog from "../features/corrections/components/CorrectionPackageDialog";
import CorrectionPackageList from "../features/corrections/components/CorrectionPackageList";
import type {
  CorrectionAction,
  CorrectionPackagesResponse,
  CorrectionScope,
} from "../features/corrections/types";
import { fetchExternalApprovalCycles } from "../features/external-approval/api";
import ExternalApprovalCycles from "../features/external-approval/components/ExternalApprovalCycles";
import type { ExternalApprovalReadModel } from "../features/external-approval/types";
import {
  fetchProduction,
} from "../features/production/api";
import AssignmentPicker from "../features/production/components/AssignmentPicker";
import MaterialsList from "../features/production/components/MaterialsList";
import ProductionActions from "../features/production/components/ProductionActions";
import ProductionStages from "../features/production/components/ProductionStages";
import type { ProductionMutationCoordinator, ProductionReadModel } from "../features/production/types";
import { fetchStory } from "../features/stories/api";
import StoryAuthorControl, { type StoryAuthorPatch } from "../features/stories/components/StoryAuthorControl";
import StoryHeader from "../features/stories/components/StoryHeader";
import StoryTabs from "../features/stories/components/StoryTabs";
import type { StoryListItem } from "../features/stories/types";


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

type ProductionAuthorStory = Pick<StoryListItem, "id" | "title" | "author" | "management">;

const authorStoryErrorMessage = (requestError: unknown) => (
  requestError instanceof Error
    ? requestError.message
    : "Не удалось загрузить управление автором"
);

export default function StoryProductionPage({ storyId }: { storyId: number }) {
  const [production, setProduction] = useState<ProductionReadModel | null>(null);
  const [authorStory, setAuthorStory] = useState<ProductionAuthorStory | null>(null);
  const [authorStoryError, setAuthorStoryError] = useState("");
  const [authorStoryRetryPending, setAuthorStoryRetryPending] = useState(false);
  const [corrections, setCorrections] = useState<CorrectionPackagesResponse | null>(null);
  const [correctionsLoading, setCorrectionsLoading] = useState(false);
  const [correctionsError, setCorrectionsError] = useState("");
  const [correctionDialog, setCorrectionDialog] = useState<CorrectionDialogState | null>(null);
  const [externalApproval, setExternalApproval] = useState<ExternalApprovalReadModel | null>(null);
  const [externalApprovalLoading, setExternalApprovalLoading] = useState(false);
  const [externalApprovalError, setExternalApprovalError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [mutationPending, setMutationPending] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const mountedRef = useRef(true);
  const currentStoryRef = useRef(storyId);
  currentStoryRef.current = storyId;
  const requestStateRef = useRef<ProductionRequestState>({ storyId, generation: 0 });
  const storyRequestStateRef = useRef<ProductionRequestState>({ storyId, generation: 0 });
  const correctionRequestStateRef = useRef<ProductionRequestState>({ storyId, generation: 0 });
  const externalApprovalRequestStateRef = useRef<ProductionRequestState>({ storyId, generation: 0 });
  const mutationSequenceRef = useRef(0);
  const mutationInFlightRef = useRef<ProductionMutationState | null>(null);
  if (requestStateRef.current.storyId !== storyId) {
    requestStateRef.current = { storyId, generation: 0 };
    storyRequestStateRef.current = { storyId, generation: 0 };
    correctionRequestStateRef.current = { storyId, generation: 0 };
    externalApprovalRequestStateRef.current = { storyId, generation: 0 };
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

  const refreshAuthorStory = useCallback(async (): Promise<ProductionAuthorStory | null> => {
    const requestState = storyRequestStateRef.current;
    if (
      !mountedRef.current
      || currentStoryRef.current !== storyId
      || requestState.storyId !== storyId
    ) return null;
    const requestGeneration = requestState.generation + 1;
    requestState.generation = requestGeneration;
    try {
      const response = await fetchStory(storyId);
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || storyRequestStateRef.current !== requestState
        || requestGeneration !== requestState.generation
      ) return null;
      const next = {
        id: response.id,
        title: response.title,
        author: response.author,
        management: response.management,
      };
      setAuthorStory(next);
      return next;
    } catch (requestError) {
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || storyRequestStateRef.current !== requestState
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
        setCorrectionsError(requestError instanceof Error ? requestError.message : "Не удалось загрузить правки");
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

  const refreshExternalApproval = useCallback(async (
    href: string,
    exposeSectionError = true,
  ) => {
    const requestState = externalApprovalRequestStateRef.current;
    if (
      !mountedRef.current
      || currentStoryRef.current !== storyId
      || requestState.storyId !== storyId
    ) return false;
    const requestGeneration = requestState.generation + 1;
    requestState.generation = requestGeneration;
    setExternalApprovalLoading(true);
    setExternalApprovalError("");
    try {
      const response = await fetchExternalApprovalCycles(href);
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || externalApprovalRequestStateRef.current !== requestState
        || requestGeneration !== requestState.generation
      ) return false;
      setExternalApproval(response);
      return true;
    } catch (requestError) {
      if (
        !mountedRef.current
        || currentStoryRef.current !== storyId
        || externalApprovalRequestStateRef.current !== requestState
        || requestGeneration !== requestState.generation
      ) return false;
      if (exposeSectionError) {
        setExternalApprovalError(
          requestError instanceof Error
            ? requestError.message
            : "Не удалось загрузить внешние согласования",
        );
      }
      throw requestError;
    } finally {
      if (
        mountedRef.current
        && currentStoryRef.current === storyId
        && externalApprovalRequestStateRef.current === requestState
        && requestGeneration === requestState.generation
      ) setExternalApprovalLoading(false);
    }
  }, [storyId]);

  const refreshReadModels = useCallback(async () => {
    const response = await refreshProduction();
    if (!response) return false;
    if (!response.external_approval) {
      return refreshCorrections(response.corrections.href, false);
    }
    const results = await Promise.allSettled([
      refreshCorrections(response.corrections.href, false),
      refreshExternalApproval(response.external_approval.href, false),
    ]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
    return results.every(
      (result) => result.status === "fulfilled" && result.value,
    );
  }, [refreshCorrections, refreshExternalApproval, refreshProduction]);

  const loadInitial = useCallback(async () => {
    if (!mountedRef.current || currentStoryRef.current !== storyId) return;
    setLoading(true);
    setError("");
    try {
      const response = await refreshProduction();
      if (response) {
        try {
          const refreshedAuthorStory = await refreshAuthorStory();
          if (refreshedAuthorStory) setAuthorStoryError("");
        } catch (requestError) {
          if (mountedRef.current && currentStoryRef.current === storyId) {
            setAuthorStoryError(authorStoryErrorMessage(requestError));
          }
        }
        try {
          await refreshCorrections(response.corrections.href);
        } catch {
          // The production page remains usable while this section offers its own retry.
        }
        if (response.external_approval) {
          try {
            await refreshExternalApproval(response.external_approval.href);
          } catch {
            // The production page remains usable while this section offers its own retry.
          }
        }
      }
    } catch (requestError) {
      if (mountedRef.current && currentStoryRef.current === storyId) {
        setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить производство");
      }
    } finally {
      if (mountedRef.current && currentStoryRef.current === storyId) setLoading(false);
    }
  }, [refreshAuthorStory, refreshCorrections, refreshExternalApproval, refreshProduction, storyId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestStateRef.current.generation += 1;
      storyRequestStateRef.current.generation += 1;
      correctionRequestStateRef.current.generation += 1;
      externalApprovalRequestStateRef.current.generation += 1;
      mutationInFlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    setProduction(null);
    setAuthorStory(null);
    setAuthorStoryError("");
    setAuthorStoryRetryPending(false);
    setCorrections(null);
    setCorrectionsError("");
    setCorrectionDialog(null);
    setExternalApproval(null);
    setExternalApprovalError("");
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
    ) return { commandAcknowledged: false, refreshApplied: false };
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
        return { commandAcknowledged: false, refreshApplied: false };
      }
      if (!isCurrentOperation()) return { commandAcknowledged: true, refreshApplied: false };
      try {
        const applied = await refreshReadModels();
        if (applied && isCurrentOperation()) setRefreshWarning("");
        return { commandAcknowledged: true, refreshApplied: applied && isCurrentOperation() };
      } catch {
        if (isCurrentOperation()) {
          setRefreshWarning("Действие выполнено, но данные не обновились");
        }
        return { commandAcknowledged: true, refreshApplied: false };
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

  const retryAuthorStory = useCallback(async () => {
    const retryStoryId = storyId;
    if (
      authorStoryRetryPending
      || !mountedRef.current
      || currentStoryRef.current !== retryStoryId
    ) return;
    setAuthorStoryRetryPending(true);
    try {
      const refreshedAuthorStory = await refreshAuthorStory();
      if (
        refreshedAuthorStory
        && mountedRef.current
        && currentStoryRef.current === retryStoryId
      ) setAuthorStoryError("");
    } catch (requestError) {
      if (mountedRef.current && currentStoryRef.current === retryStoryId) {
        setAuthorStoryError(authorStoryErrorMessage(requestError));
      }
    } finally {
      if (mountedRef.current && currentStoryRef.current === retryStoryId) {
        setAuthorStoryRetryPending(false);
      }
    }
  }, [authorStoryRetryPending, refreshAuthorStory, storyId]);

  const retryExternalApproval = useCallback(async () => {
    if (!production?.external_approval) return;
    try {
      await refreshExternalApproval(production.external_approval.href);
    } catch {
      // The section keeps the error and the retry control visible.
    }
  }, [production, refreshExternalApproval]);

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

  const orderedActions = [production.primary_action, ...production.additional_actions].filter(
    (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
  );
  const headerActions = orderedActions.slice(0, 2);
  const contextualActions = orderedActions.slice(2);
  const headerStory = authorStory?.id === production.story.id
    ? { ...production.story, author: authorStory.author }
    : production.story;
  const applyAuthorPatch = (patch: StoryAuthorPatch) => {
    setAuthorStory((current) => current?.id === production.story.id
      ? { ...current, author: patch.author, management: patch.management }
      : current);
    setProduction((current) => current?.story.id === production.story.id
      ? { ...current, story: { ...current.story, author: patch.author } }
      : current);
    void refreshProduction().then((refreshed) => {
      if (refreshed) setRefreshWarning("");
    }).catch(() => {
      if (mountedRef.current && currentStoryRef.current === production.story.id) {
        setRefreshWarning("Автор изменён, но данные производства не обновились");
      }
    });
  };

  return (
    <section className="story-page production-page">
      <StoryHeader story={headerStory} actions={
        <div className="production-header-controls">
          {authorStory?.id === production.story.id ? (
            <StoryAuthorControl story={authorStory} onChanged={applyAuthorPatch} />
          ) : null}
          {authorStoryError ? (
            <div className="production-author-load-error" role="alert">
              <span>{authorStoryError}</span>
              <button
                type="button"
                className="secondary"
                disabled={authorStoryRetryPending}
                onClick={() => void retryAuthorStory()}
              >
                {authorStoryRetryPending ? "Загрузка..." : "Повторить загрузку управления автором"}
              </button>
            </div>
          ) : null}
          {headerActions.length ? (
          <ProductionActions
            production={production}
            actions={headerActions}
            mutationPending={mutationPending}
            onMutate={mutateAndRefresh}
            onOpenCorrectionPackage={(action, initialScope) => setCorrectionDialog({ action, initialScope })}
          />
          ) : null}
        </div>
      } />
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
        <ProductionStages
          production={production}
          contextualActions={contextualActions}
          mutationPending={mutationPending}
          onMutate={mutateAndRefresh}
          onOpenCorrectionPackage={(action, initialScope) => setCorrectionDialog({ action, initialScope })}
        />
        <div className="production-content-grid">
          <div className="production-main-column">
        <CorrectionPackageList
          model={corrections}
          loading={correctionsLoading}
          error={correctionsError}
          mutationPending={mutationPending}
          onRetry={() => void retryCorrections()}
          onMutate={mutateAndRefresh}
          onCreate={(action, initialScope) => setCorrectionDialog({ action, initialScope })}
        />
        {production.external_approval ? (
          <ExternalApprovalCycles
            model={externalApproval}
            loading={externalApprovalLoading}
            error={externalApprovalError}
            mutationPending={mutationPending}
            focusRequested={
              new URLSearchParams(window.location.search).get("action")
              === "external-approval"
            }
            onRetry={() => void retryExternalApproval()}
            onMutate={mutateAndRefresh}
          />
        ) : null}
          </div>
          <aside className="production-side-column" aria-label="Ресурсы производства">
          <AssignmentPicker key={production.story.id}
            production={production}
            mutationPending={mutationPending}
            onMutate={mutateAndRefresh}
          />
          <MaterialsList
            storyId={production.story.id}
            materials={production.materials}
            canAdd={production.story.archived_at === null}
            mutationPending={mutationPending}
            onMutate={mutateAndRefresh}
          />
          </aside>
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
