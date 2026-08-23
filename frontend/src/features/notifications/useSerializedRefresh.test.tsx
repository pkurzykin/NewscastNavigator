import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeferred } from "../../test/deferred";
import { useSerializedRefresh } from "./useSerializedRefresh";

afterEach(() => {
  vi.useRealTimers();
});

describe("useSerializedRefresh", () => {
  it("runs at most one load at once and runs one queued refresh after it settles", async () => {
    const pending = createDeferred<void>();
    const refresh = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSerializedRefresh(refresh));

    act(() => {
      result.current.refreshNow();
      result.current.refreshNow();
      result.current.refreshNow();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith(0);

    pending.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenLastCalledWith(0);
  });

  it("uses a newer generation after superseding an in-flight refresh", async () => {
    const pending = createDeferred<void>();
    const refresh = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const { result } = renderHook(() => useSerializedRefresh(refresh));

    act(() => result.current.refreshNow());
    act(() => {
      result.current.supersede();
      result.current.refreshNow();
    });
    pending.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenNthCalledWith(1, 0);
    expect(refresh).toHaveBeenNthCalledWith(2, 1);
  });

  it("uses the latest callback when a queued refresh starts", async () => {
    const pending = createDeferred<void>();
    const staleLoad = vi.fn().mockReturnValue(pending.promise);
    const freshLoad = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ load }: { load: (generation: number) => Promise<void> }) => useSerializedRefresh(load),
      { initialProps: { load: staleLoad } },
    );

    act(() => result.current.refreshNow());
    rerender({ load: freshLoad });
    act(() => result.current.refreshNow());
    pending.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    expect(staleLoad).toHaveBeenCalledTimes(1);
    expect(freshLoad).toHaveBeenCalledWith(0);
  });

  it("does not start a queued refresh after unmount", async () => {
    const pending = createDeferred<void>();
    const refresh = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useSerializedRefresh(refresh));

    act(() => {
      result.current.refreshNow();
      result.current.refreshNow();
    });
    unmount();
    pending.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
