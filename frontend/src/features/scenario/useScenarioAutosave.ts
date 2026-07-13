import { useCallback, useEffect, useRef, useState } from "react";

import { clearScenarioDraft, writeScenarioDraft } from "./draftStorage";
import { createSegmentUid } from "./rowIdentity";
import type { ScenarioLease, ScenarioRow } from "./types";

export type AutosaveStatus = "idle" | "pending" | "saving" | "error";

interface Options {
  storyId: number;
  userId: number;
  initialRevision: number;
  ensureLease: () => Promise<Pick<ScenarioLease, "edit_session_id" | "lease_token">>;
  save: (payload: { base_revision: number; client_save_id: string; edit_session_id: number; lease_token: string; rows: ScenarioRow[] }) => Promise<{ revision: number }>;
  debounceMs?: number;
}

export function useScenarioAutosave({ storyId, userId, initialRevision, ensureLease, save, debounceMs = 800 }: Options) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState("");
  const revisionRef = useRef(initialRevision);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<ScenarioRow[] | null>(null);
  const latestRef = useRef<ScenarioRow[] | null>(null);

  useEffect(() => {
    revisionRef.current = initialRevision;
  }, [initialRevision]);

  const send = useCallback(async (rows: ScenarioRow[]) => {
    inFlightRef.current = true;
    setStatus("saving");
    let saved = false;
    try {
      const lease = await ensureLease();
      const ack = await save({ base_revision: revisionRef.current, client_save_id: createSegmentUid(), ...lease, rows });
      revisionRef.current = ack.revision;
      if (latestRef.current === rows) clearScenarioDraft(storyId, userId);
      setError("");
      saved = true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сохранить сценарий");
      setStatus("error");
    } finally {
      inFlightRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) void send(queued);
      else if (saved && latestRef.current === rows) setStatus("idle");
    }
  }, [ensureLease, save, storyId, userId]);

  const scheduleSave = useCallback((rows: ScenarioRow[]) => {
    const snapshot = structuredClone(rows);
    latestRef.current = snapshot;
    writeScenarioDraft(storyId, userId, revisionRef.current, snapshot);
    setStatus("pending");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (inFlightRef.current) queuedRef.current = snapshot;
      else void send(snapshot);
    }, debounceMs);
  }, [debounceMs, send, storyId, userId]);

  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); }, []);
  return { status, error, revisionRef, scheduleSave };
}
