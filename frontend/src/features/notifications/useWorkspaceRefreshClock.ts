import { useEffect } from "react";

import { NOTIFICATIONS_INVALIDATED_EVENT } from "./api";

export const WORKSPACE_REFRESH_INTERVAL_MS = 5_000;

export function useWorkspaceRefreshClock(intervalMs = WORKSPACE_REFRESH_INTERVAL_MS): void {
  useEffect(() => {
    let active = true;
    let immediateQueued = false;
    let intervalId: number | undefined;

    const invalidate = () => {
      window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT));
    };
    const stopInterval = () => {
      if (intervalId === undefined) return;
      window.clearInterval(intervalId);
      intervalId = undefined;
    };
    const startInterval = () => {
      if (intervalId !== undefined) return;
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "visible") invalidate();
      }, intervalMs);
    };
    const requestImmediateRefresh = () => {
      if (immediateQueued || document.visibilityState !== "visible") return;
      immediateQueued = true;
      queueMicrotask(() => {
        immediateQueued = false;
        if (active && document.visibilityState === "visible") invalidate();
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startInterval();
        requestImmediateRefresh();
        return;
      }
      stopInterval();
    };
    const handleFocus = () => {
      if (document.visibilityState !== "visible") return;
      startInterval();
      requestImmediateRefresh();
    };

    if (document.visibilityState === "visible") startInterval();

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      stopInterval();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intervalMs]);
}
