import { useCallback, useEffect, useRef, useState } from "react";

import { acquireScenarioLease, heartbeatScenarioLease, releaseScenarioLease } from "./api";
import type { ScenarioLease } from "./types";

export function useEditLease(storyId: number) {
  const [lease, setLease] = useState<ScenarioLease | null>(null);
  const [error, setError] = useState("");
  const leaseRef = useRef<ScenarioLease | null>(null);
  const acquiringRef = useRef<Promise<ScenarioLease> | null>(null);
  const lastActivityRef = useRef(0);

  const acquire = useCallback(async () => {
    lastActivityRef.current = Date.now();
    if (leaseRef.current) return leaseRef.current;
    if (!acquiringRef.current) {
      acquiringRef.current = acquireScenarioLease(storyId)
        .then((next) => { leaseRef.current = next; setLease(next); setError(""); return next; })
        .catch((requestError) => { const message = requestError instanceof Error ? requestError.message : "Не удалось получить право редактирования"; setError(message); throw requestError; })
        .finally(() => { acquiringRef.current = null; });
    }
    return acquiringRef.current;
  }, [storyId]);

  const release = useCallback(async () => {
    const current = leaseRef.current;
    leaseRef.current = null;
    setLease(null);
    if (current) await releaseScenarioLease(storyId, current);
  }, [storyId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = leaseRef.current;
      if (!current || Date.now() - lastActivityRef.current > 90_000) return;
      void heartbeatScenarioLease(storyId, current)
        .then((ack) => { const next = { ...current, expires_at: ack.expires_at }; leaseRef.current = next; setLease(next); })
        .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Не удалось продлить право редактирования"));
    }, 30_000);
    return () => { window.clearInterval(timer); void release().catch(() => undefined); };
  }, [release, storyId]);

  return { lease, error, acquire, release, touch: () => { lastActivityRef.current = Date.now(); } };
}
