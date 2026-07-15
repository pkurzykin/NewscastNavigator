import { useCallback, useEffect, useRef, useState } from "react";

import { acquireScenarioLease, heartbeatScenarioLease, releaseScenarioLease } from "./api";
import type { ScenarioLease } from "./types";

export function useEditLease(storyId: number) {
  const [lease, setLease] = useState<ScenarioLease | null>(null);
  const [error, setError] = useState("");
  const leaseRef = useRef<ScenarioLease | null>(null);
  const acquiringRef = useRef<Promise<ScenarioLease> | null>(null);
  const lastActivityRef = useRef(0);
  const exitingRef = useRef(false);

  const releaseWithKeepalive = useCallback((current: ScenarioLease) => {
    void releaseScenarioLease(storyId, current, true).catch(() => {
      // Page-exit delivery is best effort; the server TTL expires an undelivered lease.
    });
  }, [storyId]);

  const acquire = useCallback(async () => {
    if (exitingRef.current) throw new Error("Редактор сценария закрыт");
    lastActivityRef.current = Date.now();
    if (leaseRef.current) return leaseRef.current;
    if (!acquiringRef.current) {
      acquiringRef.current = acquireScenarioLease(storyId)
        .then((next) => {
          if (exitingRef.current) {
            releaseWithKeepalive(next);
            throw new Error("Редактор сценария закрыт");
          }
          leaseRef.current = next;
          setLease(next);
          setError("");
          return next;
        })
        .catch((requestError) => {
          if (!exitingRef.current) {
            const message = requestError instanceof Error ? requestError.message : "Не удалось получить право редактирования";
            setError(message);
          }
          throw requestError;
        })
        .finally(() => { acquiringRef.current = null; });
    }
    return acquiringRef.current;
  }, [releaseWithKeepalive, storyId]);

  const release = useCallback(async () => {
    const current = leaseRef.current;
    leaseRef.current = null;
    setLease(null);
    if (current) await releaseScenarioLease(storyId, current);
  }, [storyId]);

  const releaseForPageExit = useCallback(() => {
    exitingRef.current = true;
    const current = leaseRef.current;
    leaseRef.current = null;
    if (!current) return;
    releaseWithKeepalive(current);
  }, [releaseWithKeepalive]);

  useEffect(() => {
    exitingRef.current = false;
    const timer = window.setInterval(() => {
      const current = leaseRef.current;
      if (!current || Date.now() - lastActivityRef.current > 90_000) return;
      void heartbeatScenarioLease(storyId, current)
        .then((ack) => { const next = { ...current, expires_at: ack.expires_at }; leaseRef.current = next; setLease(next); })
        .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Не удалось продлить право редактирования"));
    }, 30_000);
    window.addEventListener("pagehide", releaseForPageExit);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", releaseForPageExit);
      releaseForPageExit();
    };
  }, [releaseForPageExit, storyId]);

  return { lease, error, acquire, release, touch: () => { lastActivityRef.current = Date.now(); } };
}
