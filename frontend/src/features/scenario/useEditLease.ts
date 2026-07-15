import { useCallback, useEffect, useRef, useState } from "react";

import { acquireScenarioLease, heartbeatScenarioLease, releaseScenarioLease } from "./api";
import type { ScenarioLease } from "./types";

export function useEditLease(storyId: number) {
  const [lease, setLease] = useState<ScenarioLease | null>(null);
  const [error, setError] = useState("");
  const leaseRef = useRef<ScenarioLease | null>(null);
  const acquiringRef = useRef<{ generation: number; promise: Promise<ScenarioLease> } | null>(null);
  const lastActivityRef = useRef(0);
  const exitingRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);

  const releaseWithKeepalive = useCallback((current: ScenarioLease) => {
    void releaseScenarioLease(storyId, current, true).catch(() => {
      // Page-exit delivery is best effort; the server TTL expires an undelivered lease.
    });
  }, [storyId]);

  const acquire = useCallback(async () => {
    if (exitingRef.current) throw new Error("Редактор сценария закрыт");
    lastActivityRef.current = Date.now();
    if (leaseRef.current) return leaseRef.current;
    const generation = lifecycleGenerationRef.current;
    if (acquiringRef.current?.generation !== generation) {
      let acquisition!: Promise<ScenarioLease>;
      acquisition = acquireScenarioLease(storyId)
        .then((next) => {
          if (exitingRef.current || lifecycleGenerationRef.current !== generation) {
            releaseWithKeepalive(next);
            throw new Error("Редактор сценария закрыт");
          }
          leaseRef.current = next;
          setLease(next);
          setError("");
          return next;
        })
        .catch((requestError) => {
          if (!exitingRef.current && lifecycleGenerationRef.current === generation) {
            const message = requestError instanceof Error ? requestError.message : "Не удалось получить право редактирования";
            setError(message);
          }
          throw requestError;
        })
        .finally(() => {
          if (acquiringRef.current?.promise === acquisition) acquiringRef.current = null;
        });
      acquiringRef.current = { generation, promise: acquisition };
    }
    return acquiringRef.current.promise;
  }, [releaseWithKeepalive, storyId]);

  const release = useCallback(async () => {
    const current = leaseRef.current;
    leaseRef.current = null;
    setLease(null);
    if (current) await releaseScenarioLease(storyId, current);
  }, [storyId]);

  const releaseForPageExit = useCallback(() => {
    exitingRef.current = true;
    lifecycleGenerationRef.current += 1;
    const current = leaseRef.current;
    leaseRef.current = null;
    if (!current) return;
    releaseWithKeepalive(current);
  }, [releaseWithKeepalive]);

  const resumeFromPageCache = useCallback((event: PageTransitionEvent) => {
    if (!event.persisted) return;
    exitingRef.current = false;
    setLease(null);
    setError("");
  }, []);

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
    window.addEventListener("pageshow", resumeFromPageCache);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", releaseForPageExit);
      window.removeEventListener("pageshow", resumeFromPageCache);
      releaseForPageExit();
    };
  }, [releaseForPageExit, resumeFromPageCache, storyId]);

  return { lease, error, acquire, release, touch: () => { lastActivityRef.current = Date.now(); } };
}
