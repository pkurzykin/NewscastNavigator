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
  resumeVersion?: number;
}

export function useScenarioAutosave({ storyId, userId, initialRevision, ensureLease, save, debounceMs = 800, resumeVersion = 0 }: Options) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState("");
  const revisionRef = useRef(initialRevision);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<ScenarioRow[] | null>(null);
  const latestRef = useRef<ScenarioRow[] | null>(null);
  const dirtyRef = useRef(false);
  const retryRequestedRef = useRef(false);
  const processedResumeVersionRef = useRef(0);

  useEffect(() => {
    revisionRef.current = initialRevision;
  }, [initialRevision]);

  const send = useCallback(async (rows: ScenarioRow[]) => {
    inFlightRef.current = true;
    setStatus("saving");
    let saved = false;
    let savedLatest = false;
    try {
      const lease = await ensureLease();
      const ack = await save({ base_revision: revisionRef.current, client_save_id: createSegmentUid(), ...lease, rows });
      revisionRef.current = ack.revision;
      savedLatest = latestRef.current === rows;
      if (savedLatest) { clearScenarioDraft(storyId, userId); latestRef.current = null; dirtyRef.current = false; }
      setError("");
      saved = true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сохранить сценарий");
      setStatus("error");
    } finally {
      inFlightRef.current = false;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) {
        retryRequestedRef.current = false;
        void send(queued);
      } else if (retryRequestedRef.current && latestRef.current) {
        retryRequestedRef.current = false;
        void send(latestRef.current);
      } else {
        retryRequestedRef.current = false;
        if (saved && savedLatest) setStatus("idle");
      }
    }
  }, [ensureLease, save, storyId, userId]);

  const scheduleSave = useCallback((rows: ScenarioRow[]) => {
    const snapshot = structuredClone(rows);
    latestRef.current = snapshot;
    dirtyRef.current = true;
    writeScenarioDraft(storyId, userId, revisionRef.current, snapshot);
    setStatus("pending");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (inFlightRef.current) queuedRef.current = snapshot;
      else void send(snapshot);
    }, debounceMs);
  }, [debounceMs, send, storyId, userId]);

  const retryLatest = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const rows = latestRef.current;
    if (!rows) return;
    if (inFlightRef.current) retryRequestedRef.current = true;
    else void send(rows);
  }, [send]);

  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); }, []);
  useEffect(() => {
    window.addEventListener("online", retryLatest);
    return () => window.removeEventListener("online", retryLatest);
  }, [retryLatest]);
  useEffect(() => {
    if (resumeVersion <= 0 || resumeVersion <= processedResumeVersionRef.current) return;
    processedResumeVersionRef.current = resumeVersion;
    retryLatest();
  }, [resumeVersion, retryLatest]);
  return { status, error, revisionRef, scheduleSave, retryLatest, isDirty: () => dirtyRef.current };
}
