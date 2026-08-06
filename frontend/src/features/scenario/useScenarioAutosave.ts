import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { clearScenarioDraft, writeScenarioDraft } from "./draftStorage";
import { createSegmentUid } from "./rowIdentity";
import { ApiError } from "../../shared/api/client";
import type { ScenarioDraft, ScenarioLease, ScenarioRow } from "./types";

export type AutosaveStatus = "idle" | "pending" | "saving" | "error" | "conflict";

interface Options {
  storyId: number;
  userId: number;
  initialRevision: number;
  ensureLease: () => Promise<Pick<ScenarioLease, "edit_session_id" | "lease_token">>;
  save: (payload: { base_revision: number; client_save_id: string; edit_session_id: number; lease_token: string; rows: ScenarioRow[] }) => Promise<{ revision: number }>;
  debounceMs?: number;
  resumeVersion?: number;
  onAcknowledgedRevision?: () => void;
  onRevisionConflict?: (draft: ScenarioDraft) => void | Promise<void>;
}

interface FlushWaiter {
  generation: number;
  resolve: (revision: number) => void;
  reject: (reason: unknown) => void;
}

export function useScenarioAutosave({
  storyId,
  userId,
  initialRevision,
  ensureLease,
  save,
  debounceMs = 800,
  resumeVersion = 0,
  onAcknowledgedRevision,
  onRevisionConflict,
}: Options) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(initialRevision);
  const revisionRef = useRef(initialRevision);
  const timerRef = useRef<number | null>(null);
  const scopeGenerationRef = useRef(0);
  const inFlightRef = useRef<{ generation: number; rows: ScenarioRow[] } | null>(null);
  const queuedRef = useRef<ScenarioRow[] | null>(null);
  const latestRef = useRef<ScenarioRow[] | null>(null);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const retryRequestedRef = useRef(false);
  const processedResumeVersionRef = useRef(0);
  const flushWaitersRef = useRef<FlushWaiter[]>([]);

  const rejectFlushWaiters = useCallback((generation: number, reason: unknown) => {
    const retained: FlushWaiter[] = [];
    for (const waiter of flushWaitersRef.current) {
      if (waiter.generation === generation) waiter.reject(reason);
      else retained.push(waiter);
    }
    flushWaitersRef.current = retained;
  }, []);

  const settleFlushWaiters = useCallback((generation: number, terminalError?: unknown) => {
    if (terminalError !== undefined) {
      rejectFlushWaiters(generation, terminalError);
      return;
    }
    if (generation !== scopeGenerationRef.current) {
      rejectFlushWaiters(
        generation,
        new Error("Ожидание сохранения прервано: область редактора изменилась или размонтирована."),
      );
      return;
    }
    if (
      timerRef.current !== null
      || inFlightRef.current?.generation === generation
      || queuedRef.current !== null
      || dirtyRef.current
      || conflictRef.current
    ) return;

    const revision = revisionRef.current;
    const retained: FlushWaiter[] = [];
    for (const waiter of flushWaitersRef.current) {
      if (waiter.generation === generation) waiter.resolve(revision);
      else retained.push(waiter);
    }
    flushWaitersRef.current = retained;
  }, [rejectFlushWaiters]);

  useLayoutEffect(() => {
    const generation = scopeGenerationRef.current + 1;
    scopeGenerationRef.current = generation;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    inFlightRef.current = null;
    queuedRef.current = null;
    latestRef.current = null;
    dirtyRef.current = false;
    conflictRef.current = false;
    retryRequestedRef.current = false;
    processedResumeVersionRef.current = 0;
    setStatus("idle");
    setError("");
    return () => {
      if (scopeGenerationRef.current !== generation) return;
      scopeGenerationRef.current += 1;
      rejectFlushWaiters(
        generation,
        new Error("Ожидание сохранения прервано: область редактора изменилась или размонтирована."),
      );
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      inFlightRef.current = null;
      queuedRef.current = null;
      latestRef.current = null;
      dirtyRef.current = false;
      conflictRef.current = false;
      retryRequestedRef.current = false;
    };
  }, [rejectFlushWaiters, storyId, userId]);

  useEffect(() => {
    revisionRef.current = initialRevision;
    setRevision(initialRevision);
  }, [initialRevision]);

  const send = useCallback(async (rows: ScenarioRow[], generation = scopeGenerationRef.current) => {
    if (generation !== scopeGenerationRef.current) return;
    const operation = { generation, rows };
    inFlightRef.current = operation;
    setStatus("saving");
    let saved = false;
    let savedLatest = false;
    let terminalError: unknown;
    try {
      const lease = await ensureLease();
      if (generation !== scopeGenerationRef.current || inFlightRef.current !== operation) return;
      const ack = await save({ base_revision: revisionRef.current, client_save_id: createSegmentUid(), ...lease, rows });
      if (generation !== scopeGenerationRef.current || inFlightRef.current !== operation) return;
      const previousRevision = revisionRef.current;
      revisionRef.current = ack.revision;
      setRevision(ack.revision);
      savedLatest = latestRef.current === rows;
      if (savedLatest) {
        latestRef.current = null;
        dirtyRef.current = false;
        try {
          clearScenarioDraft(storyId, userId);
        } catch {
          // Acknowledged delivery stays settled even if auxiliary cleanup changes later.
        }
      }
      setError("");
      saved = true;
      if (ack.revision > previousRevision) {
        try {
          onAcknowledgedRevision?.();
        } catch {
          // Revision effects are not delivery failures and must not resend saved rows.
        }
      }
    } catch (caughtError) {
      if (generation !== scopeGenerationRef.current || inFlightRef.current !== operation) return;
      terminalError = caughtError;
      if (
        caughtError instanceof ApiError
        && caughtError.code === "SCENARIO_REVISION_CONFLICT"
      ) {
        const localRows = structuredClone(latestRef.current ?? rows);
        queuedRef.current = null;
        retryRequestedRef.current = false;
        latestRef.current = localRows;
        dirtyRef.current = true;
        conflictRef.current = true;
        const draft: ScenarioDraft = {
          revision: revisionRef.current,
          rows: localRows,
          saved_at: new Date().toISOString(),
        };
        setError("Локальный текст отличается от актуального текста на сервере.");
        setStatus("conflict");
        void Promise.resolve(onRevisionConflict?.(draft)).catch((refreshError) => {
          if (generation !== scopeGenerationRef.current) return;
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Не удалось загрузить актуальный текст с сервера.",
          );
        });
      } else {
        setError(caughtError instanceof Error ? caughtError.message : "Не удалось сохранить сценарий");
        setStatus("error");
      }
    } finally {
      if (generation !== scopeGenerationRef.current || inFlightRef.current !== operation) return;
      inFlightRef.current = null;
      const queued = queuedRef.current;
      queuedRef.current = null;
      let continuing = false;
      if (queued) {
        retryRequestedRef.current = false;
        void send(queued, generation);
        continuing = true;
      } else if (retryRequestedRef.current && latestRef.current) {
        retryRequestedRef.current = false;
        void send(latestRef.current, generation);
        continuing = true;
      } else {
        retryRequestedRef.current = false;
        if (saved && savedLatest) setStatus("idle");
      }
      settleFlushWaiters(
        generation,
        terminalError !== undefined && !continuing ? terminalError : undefined,
      );
    }
  }, [
    ensureLease,
    onAcknowledgedRevision,
    onRevisionConflict,
    save,
    settleFlushWaiters,
    storyId,
    userId,
  ]);

  const flushPending = useCallback((): Promise<number> => {
    const generation = scopeGenerationRef.current;
    if (conflictRef.current) {
      return Promise.reject(new ApiError(
        "Локальный текст отличается от актуального текста на сервере.",
        409,
        "SCENARIO_REVISION_CONFLICT",
      ));
    }
    if (
      timerRef.current === null
      && inFlightRef.current === null
      && queuedRef.current === null
      && !dirtyRef.current
    ) return Promise.resolve(revisionRef.current);

    const promise = new Promise<number>((resolve, reject) => {
      flushWaitersRef.current.push({ generation, resolve, reject });
    });

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const latest = latestRef.current;
    const inFlight = inFlightRef.current;
    if (dirtyRef.current && latest) {
      if (inFlight?.generation === generation) {
        if (inFlight.rows !== latest && queuedRef.current !== latest) {
          const snapshot = structuredClone(latest);
          latestRef.current = snapshot;
          queuedRef.current = snapshot;
        }
      } else {
        const snapshot = structuredClone(latest);
        latestRef.current = snapshot;
        queuedRef.current = null;
        void send(snapshot, generation);
      }
    }
    settleFlushWaiters(generation);
    return promise;
  }, [send, settleFlushWaiters]);

  const scheduleSave = useCallback((rows: ScenarioRow[]) => {
    if (conflictRef.current) return;
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
    if (conflictRef.current) return;
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

  const enterConflict = useCallback((rows: ScenarioRow[]) => {
    const generation = scopeGenerationRef.current;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    queuedRef.current = null;
    retryRequestedRef.current = false;
    latestRef.current = structuredClone(rows);
    dirtyRef.current = true;
    conflictRef.current = true;
    setStatus("conflict");
    setError("Локальный текст отличается от актуального текста на сервере.");
    rejectFlushWaiters(
      generation,
      new ApiError(
        "Локальный текст отличается от актуального текста на сервере.",
        409,
        "SCENARIO_REVISION_CONFLICT",
      ),
    );
  }, [rejectFlushWaiters]);

  const rebaseConflict = useCallback((rows: ScenarioRow[], baseRevision: number) => {
    conflictRef.current = false;
    revisionRef.current = baseRevision;
    setRevision(baseRevision);
    setError("");
    scheduleSave(rows);
  }, [scheduleSave]);

  const discardConflict = useCallback((serverRevision: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    queuedRef.current = null;
    latestRef.current = null;
    retryRequestedRef.current = false;
    dirtyRef.current = false;
    conflictRef.current = false;
    revisionRef.current = serverRevision;
    setRevision(serverRevision);
    setError("");
    setStatus("idle");
  }, []);

  const resumeDraft = useCallback((draft: ScenarioDraft) => {
    if (conflictRef.current) return;
    revisionRef.current = draft.revision;
    setRevision(draft.revision);
    scheduleSave(draft.rows);
  }, [scheduleSave]);

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
  const isDirty = useCallback(
    () => dirtyRef.current || conflictRef.current,
    [],
  );
  return {
    status,
    error,
    revision,
    revisionRef,
    scheduleSave,
    flushPending,
    retryLatest,
    enterConflict,
    rebaseConflict,
    discardConflict,
    resumeDraft,
    isDirty,
  };
}
