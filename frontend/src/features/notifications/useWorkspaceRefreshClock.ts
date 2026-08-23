import { useEffect } from "react";

import { NOTIFICATIONS_INVALIDATED_EVENT } from "./api";

export const WORKSPACE_REFRESH_INTERVAL_MS = 5_000;

export function useWorkspaceRefreshClock(intervalMs = WORKSPACE_REFRESH_INTERVAL_MS): void {
  useEffect(() => {
    let active = true;
    let immediateQueued = false;

    const invalidate = () => {
      window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT));
    };
    const requestImmediateRefresh = () => {
      if (immediateQueued || document.visibilityState !== "visible") return;
      immediateQueued = true;
      queueMicrotask(() => {
        immediateQueued = false;
        if (active && document.visibilityState === "visible") invalidate();
      });
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") invalidate();
    }, intervalMs);

    window.addEventListener("focus", requestImmediateRefresh);
    document.addEventListener("visibilitychange", requestImmediateRefresh);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", requestImmediateRefresh);
      document.removeEventListener("visibilitychange", requestImmediateRefresh);
    };
  }, [intervalMs]);
}
