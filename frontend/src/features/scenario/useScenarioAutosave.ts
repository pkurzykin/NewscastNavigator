import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
  const scopeGenerationRef = useRef(0);
  const inFlightRef = useRef<{ generation: number } | null>(null);
  const queuedRef = useRef<ScenarioRow[] | null>(null);
  const latestRef = useRef<ScenarioRow[] | null>(null);
  const dirtyRef = useRef(false);
  const retryRequestedRef = useRef(false);
  const processedResumeVersionRef = useRef(0);

  useLayoutEffect(() => {
    const generation = scopeGenerationRef.current + 1;
    scopeGenerationRef.current = generation;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    inFlightRef.current = null;
    queuedRef.current = null;
    latestRef.current = null;
    dirtyRef.current = false;
    retryRequestedRef.current = false;
    processedResumeVersionRef.current = 0;
    setStatus("idle");
    setError("");
    return () => {
      if (scopeGenerationRef.current !== generation) return;
      scopeGenerationRef.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      inFlightRef.current = null;
      queuedRef.current = null;
      latestRef.current = null;
      dirtyRef.current = false;
      retryRequestedRef.current = false;
    };
  }, [storyId, userId]);

  useEffect(() => {
    revisionRef.current = initialRevision;
  }, [initialRevision]);

  const send = useCallback(async (rows: ScenarioRow[], generation = scopeGenerationRef.current) => {
    if (generation !== scopeGenerationRef.current) return;
    const operation = { generation };
    inFlightRef.current = operation;
    setStatus("saving");
    let saved = false;
    let savedLatest = false;
    try {
      const lease = await ensureLease();
      if (generation !== scopeGenerationRef.current || inFlightRef.current !== operation) return;
      const ack = await save({ base_revision: revisionRef.current, client_save_id: createSegmentUid(), ...lease, rows });
      if (generation !== scopeGenerationRef.current || inFlightRef.current !== operation) return;
      revisionRef.current = ack.revision;
      savedLatest = latestRef.current === rows;
      if (savedLatest) { clearScenarioDraft(storyId, userId); latestRef.current = null; dirtyRef.current = false; }
      setError("");
      saved = true;
    } catch (requestError) {
      if (generation !== scopeGenerationRef.current || inFlightRef.current !== operation) return;
      setError(requestError instanceof Error ? requestError.message : "Не удалось сохранить сценарий");
      setStatus("error");
    } finally {
      if (generation !== scopeGenerationRef.current || inFlightRef.current !== operation) return;
      inFlightRef.current = null;
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued) {
        retryRequestedRef.current = false;
        void send(queued, generation);
      } else if (retryRequestedRef.current && latestRef.current) {
        retryRequestedRef.current = false;
        void send(latestRef.current, generation);
      } else {
        retryRequestedRef.current = false;
        if (saved && savedLatest) setStatus("idle");
      }
    }
  }, [ensureLease, save, storyId, userId]);

  const scheduleSave = useCallback((rows: ScenarioRow[]) => {
    const generation = scopeGenerationRef.current;
    const snapshot = structuredClone(rows);
    latestRef.current = snapshot;
    dirtyRef.current = true;
    writeScenarioDraft(storyId, userId, revisionRef.current, snapshot);
    setStatus("pending");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (generation !== scopeGenerationRef.current) return;
      timerRef.current = null;
      if (inFlightRef.current?.generation === generation) queuedRef.current = snapshot;
      else void send(snapshot, generation);
    }, debounceMs);
  }, [debounceMs, send, storyId, userId]);

  const retryLatest = useCallback(() => {
    const generation = scopeGenerationRef.current;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const rows = latestRef.current;
    if (!rows) return;
    if (inFlightRef.current?.generation === generation) retryRequestedRef.current = true;
    else void send(rows, generation);
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
