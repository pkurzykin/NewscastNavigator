export function entryPolicy(codes: readonly string[]): "editorial" | "explicit" {
  return codes.some((code) => code === "designer" || code === "video_editor")
    && !codes.some((code) => ["author", "proofreader", "chief", "chief_editor"].includes(code))
    ? "explicit" : "editorial";
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchScenarioAccess } from "./api";
import type { ScenarioLease, ScenarioSnapshot } from "./types";

type Phase = "read" | "acquiring" | "editing" | "leaving" | "blocked" | "reentry-required" | "release-error";
interface Options {
  loaded?: boolean;
  storyId: number;
  userId: number;
  functions: readonly string[];
  edit: ScenarioSnapshot["edit"];
  revision: () => number;
  lease: { acquire(): Promise<ScenarioLease>; getOwnedLease(allowIdleFlush?: boolean): ScenarioLease; setIdleHandler?(handler: (() => void) | null): void; release(): Promise<void> };
  hasPendingInput?(): boolean;
  flush(): Promise<unknown>;
  onRevisionMismatch(revision: number): Promise<void>;
}

export function useScenarioAccess(options: Options) {
  const ref = useRef(options); ref.current = options;
  const [phase, setPhase] = useState<Phase>("read");
  const phaseRef = useRef<Phase>("read");
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(options.edit);
  const editRef = useRef(options.edit);
  const epoch = useRef(0);
  const alive = useRef(true);
  const acquiring = useRef<Promise<boolean> | null>(null);
  const pollInFlight = useRef<Promise<void> | null>(null);
  const transition = useCallback((next: Phase) => { phaseRef.current = next; setPhase(next); }, []);
  const canMutate = useCallback(() => {
    if (phaseRef.current !== "editing" || editRef.current.state === "archived") return false;
    try { ref.current.lease.getOwnedLease(); return true; } catch { return false; }
  }, []);
  const getOwnedLease = useCallback(async () => {
    if (!["editing", "leaving"].includes(phaseRef.current)) throw new Error("Сценарий открыт для чтения. Войдите в редактирование.");
    return ref.current.lease.getOwnedLease(true);
  }, []);
  const canDeliver = useCallback(() => {
    if (!["editing", "leaving"].includes(phaseRef.current)) return false;
    try { ref.current.lease.getOwnedLease(true); return true; } catch { return false; }
  }, []);
  const refreshAccess = useCallback((): Promise<void> => {
    if (ref.current.loaded === false || document.visibilityState === "hidden") return Promise.resolve();
    if (pollInFlight.current) return pollInFlight.current;
    const generation = epoch.current;
    const pending = fetchScenarioAccess(ref.current.storyId).then((next) => {
      if (!alive.current || epoch.current !== generation || next.story_id !== ref.current.storyId) return;
      editRef.current = next.edit; setEdit(next.edit);
      let local: ScenarioLease | null = null;
      try { local = ref.current.lease.getOwnedLease(true); } catch { /* no current local token */ }
      if (phaseRef.current === "editing" && (!local || next.edit.state === "archived"
        || next.edit.edit_session_id !== local.edit_session_id)) {
        epoch.current += 1;
        transition("reentry-required");
        setError("Право редактирования утрачено. Локальный текст сохранён; войдите повторно.");
        void ref.current.lease.release().catch(() => undefined);
      }
    }).catch((caught) => {
      if (alive.current && epoch.current === generation) setError(caught instanceof Error ? caught.message : "Не удалось обновить доступ");
    }).finally(() => { if (pollInFlight.current === pending) pollInFlight.current = null; });
    pollInFlight.current = pending;
    return pending;
  }, [transition]);
  const requestEdit = useCallback((): Promise<boolean> => {
    if (canMutate()) return Promise.resolve(true);
    if (acquiring.current) return acquiring.current;
    if (editRef.current.state === "archived" || phaseRef.current === "leaving" || phaseRef.current === "release-error") return Promise.resolve(false);
    const generation = ++epoch.current;
    const expected = ref.current.revision();
    transition("acquiring"); setError("");
    const pending = ref.current.lease.acquire().then(async (local) => {
      if (!alive.current || epoch.current !== generation) return false;
      if (local.revision !== expected) {
        transition("reentry-required");
        setError("Сценарий изменился. Сравните локальный кандидат с актуальным текстом.");
        await ref.current.lease.release();
        await ref.current.onRevisionMismatch(local.revision);
        return false;
      }
      editRef.current = { state: "mine", edit_session_id: local.edit_session_id, expires_at: local.expires_at };
      setEdit(editRef.current);
      transition("editing");
      return true;
    }).catch((caught) => {
      if (alive.current && epoch.current === generation) {
        transition("blocked");
        setError(caught instanceof Error ? caught.message : "Не удалось получить право редактирования");
        void refreshAccess();
      }
      return false;
    }).finally(() => { if (acquiring.current === pending) acquiring.current = null; });
    acquiring.current = pending;
    return pending;
  }, [canMutate, refreshAccess, transition]);
  const leaveEditing = useCallback(async () => {
    if (phaseRef.current === "read") return;
    if (ref.current.hasPendingInput?.()) {
      const error = new Error("Сначала завершите локальный ввод или скопируйте сохранённый кандидат. Редактирование остаётся включено.");
      setError(error.message); throw error;
    }
    const retryRelease = phaseRef.current === "release-error";
    if (phaseRef.current === "leaving") throw new Error("Выход из редактирования уже выполняется");
    ++epoch.current; transition("leaving"); setError("");
    let flushed = retryRelease;
    try {
      if (!retryRelease) await ref.current.flush();
      flushed = true;
      await ref.current.lease.release();
      transition("read");
      editRef.current = { state: "available" }; setEdit(editRef.current);
      void refreshAccess();
    } catch (caught) {
      transition(flushed ? "release-error" : "editing");
      setError(caught instanceof Error ? caught.message : "Не удалось завершить редактирование");
      throw caught;
    }
  }, [refreshAccess, transition]);
  useEffect(() => {
    const idle = () => { if (phaseRef.current === "editing") void leaveEditing().catch(() => undefined); };
    ref.current.lease.setIdleHandler?.(idle);
    return () => ref.current.lease.setIdleHandler?.(null);
  }, [leaveEditing, options.storyId, options.userId]);
  useLayoutEffect(() => {
    alive.current = true; ++epoch.current; phaseRef.current = "read"; setPhase("read");
    editRef.current = ref.current.edit; setEdit(ref.current.edit);
    setError(""); acquiring.current = null; pollInFlight.current = null;
    return () => { alive.current = false; ++epoch.current; };
  }, [options.storyId, options.userId]);
  useLayoutEffect(() => {
    if (["read", "blocked"].includes(phaseRef.current)) {
      editRef.current = ref.current.edit; setEdit(ref.current.edit);
    }
  }, [options.edit.state, options.edit.edit_session_id, options.loaded]);
  useEffect(() => {
    const refresh = () => { void refreshAccess(); };
    const timer = window.setInterval(refresh, 5000);
    const expiryTimer = window.setInterval(() => {
      if (phaseRef.current === "editing" && !canMutate()) {
        if (canDeliver()) { void leaveEditing().catch(() => undefined); return; }
        transition("reentry-required");
        setError("Право редактирования истекло. Локальный текст сохранён; войдите повторно.");
      }
    }, 1000);
    refresh();
    window.addEventListener("focus", refresh); window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer); window.clearInterval(expiryTimer);
      window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [options.storyId, options.userId, options.loaded, canMutate, canDeliver, leaveEditing, refreshAccess, transition]);
  const revoke = useCallback(() => {
    ++epoch.current; transition("reentry-required");
    setError("Право редактирования утрачено. Локальный текст сохранён; войдите повторно.");
    void ref.current.lease.release().catch(() => undefined);
  }, [transition]);
  return { revoke, phase, error, edit, policy: entryPolicy(options.functions), canMutate, canDeliver, getOwnedLease, requestEdit, leaveEditing, refreshAccess };
}
