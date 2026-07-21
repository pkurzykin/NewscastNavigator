import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchProduction,
  removeAssignment,
  setAssignment,
} from "../features/production/api";
import MaterialsList from "../features/production/components/MaterialsList";
import ProductionActions from "../features/production/components/ProductionActions";
import ProductionStages from "../features/production/components/ProductionStages";
import VoiceoverState from "../features/production/components/VoiceoverState";
import type { ProductionReadModel } from "../features/production/types";
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
  onRefresh: () => Promise<void>;
}

function Assignments({ production, onRefresh }: AssignmentsProps) {
  const initialSelection = useMemo(
    () => Object.fromEntries(
      production.assignments.map((assignment) => [assignment.kind, String(assignment.user.id)]),
    ),
    [production.assignments],
  );
  const [selection, setSelection] = useState<Record<string, string>>(initialSelection);
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setSelection(initialSelection), [initialSelection]);

  const save = async (kind: string) => {
    const selectedId = selection[kind];
    if (!selectedId || pendingKind !== null) return;
    setPendingKind(kind);
    setError("");
    try {
      await setAssignment(production.story.id, kind, Number(selectedId));
      await onRefresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось изменить назначение");
    } finally {
      setPendingKind(null);
    }
  };

  const remove = async (kind: string) => {
    if (pendingKind !== null) return;
    setPendingKind(kind);
    setError("");
    try {
      await removeAssignment(production.story.id, kind);
      await onRefresh();
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
                    value={selection[kind] ?? ""}
                    disabled={pendingKind !== null}
                    onChange={(event) => setSelection((state) => ({ ...state, [kind]: event.target.value }))}
                  >
                    <option value="">Не назначен</option>
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>{option.display_name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary"
                    disabled={pendingKind !== null || !selection[kind]}
                    onClick={() => void save(kind)}
                  >
                    {pendingKind === kind ? "Сохранение..." : "Сохранить"}
                  </button>
                  {current ? (
                    <button type="button" className="text-button" disabled={pendingKind !== null} onClick={() => void remove(kind)}>
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

  const refreshProduction = useCallback(async () => {
    setError("");
    const response = await fetchProduction(storyId);
    setProduction(response);
  }, [storyId]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await refreshProduction();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить производство");
    } finally {
      setLoading(false);
    }
  }, [refreshProduction]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  const refreshAfterCommand = useCallback(async () => {
    await refreshProduction();
  }, [refreshProduction]);

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
      <StoryTabs storyId={production.story.id} activeTab="production" />
      <section className="story-tab-panel production-panel" aria-label="Производство">
        <div className="production-top-grid">
          <ProductionStages stages={production.stages} />
          <ProductionActions production={production} onRefresh={refreshAfterCommand} />
        </div>
        <div className="production-detail-grid">
          <Assignments production={production} onRefresh={refreshAfterCommand} />
          <VoiceoverState voiceover={production.voiceover} />
          <MaterialsList
            storyId={production.story.id}
            materials={production.materials}
            canAdd={production.story.archived_at === null}
            onRefresh={refreshAfterCommand}
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
