import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATIONS_INVALIDATED_EVENT } from "./api";
import {
  WORKSPACE_REFRESH_INTERVAL_MS,
  useWorkspaceRefreshClock,
} from "./useWorkspaceRefreshClock";

function setVisibility(visibilityState: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
}

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("useWorkspaceRefreshClock", () => {
  it("invalidates the workspace every five seconds while the tab is visible", () => {
    vi.useFakeTimers();
    const invalidated = vi.fn();
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidated);

    renderHook(() => useWorkspaceRefreshClock());
    act(() => vi.advanceTimersByTime(WORKSPACE_REFRESH_INTERVAL_MS));

    expect(invalidated).toHaveBeenCalledTimes(1);
    window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidated);
  });

  it("does not invalidate from an interval while the tab is hidden", () => {
    vi.useFakeTimers();
    const invalidated = vi.fn();
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidated);
    setVisibility("hidden");

    renderHook(() => useWorkspaceRefreshClock());
    act(() => vi.advanceTimersByTime(WORKSPACE_REFRESH_INTERVAL_MS * 2));

    expect(invalidated).not.toHaveBeenCalled();
    window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidated);
  });

  it("invalidates immediately once when focus and visibility return together", async () => {
    vi.useFakeTimers();
    const invalidated = vi.fn();
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidated);
    setVisibility("hidden");
    renderHook(() => useWorkspaceRefreshClock());

    setVisibility("visible");
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(invalidated).toHaveBeenCalledTimes(1);
    window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidated);
  });

  it("removes its interval and document listeners on cleanup", async () => {
    vi.useFakeTimers();
    const invalidated = vi.fn();
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidated);
    const { unmount } = renderHook(() => useWorkspaceRefreshClock());

    unmount();
    act(() => vi.advanceTimersByTime(WORKSPACE_REFRESH_INTERVAL_MS));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(invalidated).not.toHaveBeenCalled();
    window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, invalidated);
  });
});
