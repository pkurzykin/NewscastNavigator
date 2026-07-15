import { useCallback, useEffect, useRef, useState } from "react";

import { fetchScenario, saveScenario } from "../api";
import { readScenarioDraft } from "../draftStorage";
import { cloneScenarioRow, createEmptyScenarioRow, createSegmentUid, withOrderIndexes } from "../rowIdentity";
import type { ScenarioRow, ScenarioSnapshot } from "../types";
import { EditLeaseHandoffCoordinator, useEditLease } from "../useEditLease";
import { useScenarioAutosave } from "../useScenarioAutosave";
import AutosaveStatus from "./AutosaveStatus";
import CaptionPanelsStatus from "./CaptionPanelsStatus";
import EditLeaseNotice from "./EditLeaseNotice";
import ScenarioRowComponent from "./ScenarioRow";

interface Props { storyId: number; userId: number; leaseCoordinator?: EditLeaseHandoffCoordinator; }

export default function ScenarioEditor({ storyId, userId, leaseCoordinator }: Props) {
  const [snapshot, setSnapshot] = useState<ScenarioSnapshot | null>(null);
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const rowsRef = useRef<ScenarioRow[]>([]);
  const lease = useEditLease(storyId, leaseCoordinator);
  const persistScenario = useCallback(
    (payload: Parameters<typeof saveScenario>[1]) => saveScenario(storyId, payload),
    [storyId],
  );
  const autosave = useScenarioAutosave({
    storyId,
    userId,
    initialRevision: snapshot?.scenario.revision ?? 0,
    ensureLease: lease.acquire,
    save: persistScenario,
    resumeVersion: lease.resumeVersion,
  });

  useEffect(() => {
    let active = true;
    void fetchScenario(storyId)
      .then((next) => {
        if (!active) return;
        const draft = readScenarioDraft(storyId, userId);
        const initialRows = draft?.revision === next.scenario.revision ? draft.rows : next.scenario.rows;
        const ordered = withOrderIndexes(initialRows);
        rowsRef.current = ordered;
        setRows(ordered);
        setSnapshot(next);
        setLoadError("");
      })
      .catch((requestError) => active && setLoadError(requestError instanceof Error ? requestError.message : "Не удалось загрузить сценарий"));
    return () => { active = false; };
  }, [storyId, userId]);

  const mutate = useCallback((updater: (current: ScenarioRow[]) => ScenarioRow[]) => {
    if (!snapshot || snapshot.edit.state === "held" || snapshot.edit.state === "archived") return;
    const next = withOrderIndexes(updater(rowsRef.current));
    rowsRef.current = next;
    setRows(next);
    lease.touch();
    void lease.acquire().catch(() => undefined);
    autosave.scheduleSave(next);
  }, [autosave, lease, snapshot]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (autosave.isDirty()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [autosave]);

  if (loadError) return <p className="error" role="alert">{loadError}</p>;
  if (!snapshot) return <p className="muted" role="status">Загрузка сценария...</p>;
  const readOnly = snapshot.edit.state === "held" || snapshot.edit.state === "archived";

  return <section className="scenario-editor" aria-label="Редактор сценария">
    <div className="scenario-editor-heading"><h2>{snapshot.story.title || "Сценарий"}</h2><AutosaveStatus status={autosave.status} error={autosave.error} /></div>
    <EditLeaseNotice edit={snapshot.edit} error={lease.error} />
    {snapshot.captionpanels ? <CaptionPanelsStatus storyId={storyId} state={snapshot.captionpanels} /> : null}
    <section className="editor-table-wrap" aria-label="Таблица сценария">
      <table><thead><tr><th>№</th><th>Блок</th><th>Текст</th><th>Имя файла / TC</th><th>В кадре</th><th>Действия</th></tr></thead><tbody>
        {rows.map((row, index) => <ScenarioRowComponent key={row.segment_uid} row={row} index={index} rowCount={rows.length} readOnly={readOnly}
          onChange={(next) => mutate((current) => current.map((item, itemIndex) => itemIndex === index ? next : item))}
          onDuplicate={() => mutate((current) => { const duplicate = cloneScenarioRow(current[index]); duplicate.segment_uid = createSegmentUid(); return [...current.slice(0, index + 1), duplicate, ...current.slice(index + 1)]; })}
          onMove={(direction) => mutate((current) => { const target = index + direction; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; })}
          onDelete={() => mutate((current) => current.filter((_, itemIndex) => itemIndex !== index))}
        />)}
      </tbody></table>
    </section>
    {!readOnly && <button type="button" onClick={() => mutate((current) => [...current, createEmptyScenarioRow(current.length + 1)])}>Добавить блок</button>}
  </section>;
}
