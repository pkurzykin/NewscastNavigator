import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScenarioAutosave } from "./useScenarioAutosave";
import type { ScenarioRow } from "./types";

const row = (text: string): ScenarioRow => ({
  segment_uid: "seg_00000000-0000-4000-8000-000000000001",
  order_index: 1,
  block_type: "zk",
  text,
  speaker_text: "",
  file_name: "",
  tc_in: "",
  tc_out: "",
  additional_comment: "",
  structured_data: {},
  formatting: {},
  rich_text: { schema_version: 1, targets: {} },
});

describe("useScenarioAutosave", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
    } satisfies Storage });
  });
  afterEach(() => vi.useRealTimers());
  it("sends one in-flight snapshot and then only the newest queued snapshot", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: { revision: number }) => void;
    const firstSave = new Promise<{ revision: number }>((resolve) => { resolveFirst = resolve; });
    const save = vi.fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ revision: 2 });
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });

    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 0,
      save,
      ensureLease,
    }));

    act(() => result.current.scheduleSave([row("первая")]))
    act(() => { vi.advanceTimersByTime(800); });
    await act(async () => { await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);

    act(() => result.current.scheduleSave([row("вторая")]))
    act(() => result.current.scheduleSave([row("третья")]))
    act(() => { vi.advanceTimersByTime(800); });
    await act(async () => { await Promise.resolve(); });

    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst({ revision: 1 }); await Promise.resolve(); await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].rows[0].text).toBe("третья");
  });

  it("keeps an error draft and never exposes a server row replacement callback", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValue(new Error("Сеть недоступна"));
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 0,
      save,
      ensureLease,
    }));

    act(() => result.current.scheduleSave([row("локальный текст")]))
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Сеть недоступна");
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toContain("локальный текст");
  });

  it("retries the latest local draft when the browser comes online", async () => {
    vi.useFakeTimers();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockResolvedValueOnce({ revision: 1 });
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 0,
      save,
      ensureLease,
    }));

    act(() => result.current.scheduleSave([row("локальный текст")]))
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); });
    expect(result.current.status).toBe("error");

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].rows[0].text).toBe("локальный текст");
    expect(result.current.status).toBe("idle");
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toBeNull();
  });
});
