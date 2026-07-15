import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScenarioAutosave } from "./useScenarioAutosave";
import { EditLeaseController } from "./editLeaseController";
import type { ScenarioRow } from "./types";
import { createDeferred } from "../../test/deferred";

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
  it("publishes the loaded and acknowledged revision to workflow consumers", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ revision: 8 });
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result, rerender } = renderHook(({ initialRevision }) => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision,
      save,
      ensureLease,
    }), { initialProps: { initialRevision: 0 } });

    rerender({ initialRevision: 7 });
    expect(result.current.revision).toBe(7);

    act(() => result.current.scheduleSave([row("редакция восемь")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); });

    expect(result.current.revision).toBe(8);
  });
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

  it("retries the latest dirty snapshot after BFCache release beats an in-flight save", async () => {
    vi.useFakeTimers();
    let rejectFirst!: (reason: Error) => void;
    const firstSave = new Promise<{ revision: number }>((_, reject) => { rejectFirst = reject; });
    const save = vi.fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ revision: 1 });
    const ensureLease = vi.fn()
      .mockResolvedValueOnce({ edit_session_id: 7, lease_token: "lease-a" })
      .mockResolvedValueOnce({ edit_session_id: 8, lease_token: "lease-b" });
    const { result, rerender } = renderHook(({ resumeVersion }) => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 0,
      save,
      ensureLease,
      resumeVersion,
    }), { initialProps: { resumeVersion: 0 } });

    act(() => result.current.scheduleSave([row("последний локальный текст")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ resumeVersion: 1 });
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectFirst(new Error("Lease released during pagehide"));
      await firstSave.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({
      edit_session_id: 8,
      lease_token: "lease-b",
      rows: [expect.objectContaining({ text: "последний локальный текст" })],
    });
    expect(result.current.status).toBe("idle");
  });

  it("does not retry or save when BFCache restore has no dirty snapshot", async () => {
    const save = vi.fn().mockResolvedValue({ revision: 1 });
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { rerender } = renderHook(({ resumeVersion }) => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 0,
      save,
      ensureLease,
      resumeVersion,
    }), { initialProps: { resumeVersion: 0 } });

    await act(async () => {
      rerender({ resumeVersion: 1 });
      await Promise.resolve();
    });

    expect(ensureLease).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("processes one resume edge despite unstable save callbacks and error rerenders", async () => {
    vi.useFakeTimers();
    const thirdSave = new Promise<{ revision: number }>(() => undefined);
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("initial failure"))
      .mockRejectedValueOnce(new Error("resume failure"))
      .mockReturnValue(thirdSave);
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result, rerender } = renderHook(({ resumeVersion, nonce }) => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 0,
      ensureLease,
      save: (payload) => save(payload),
      resumeVersion,
      debounceMs: 800 + nonce - nonce,
    }), { initialProps: { resumeVersion: 0, nonce: 0 } });

    act(() => result.current.scheduleSave([row("edge-triggered resume")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ resumeVersion: 1, nonce: 1 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending debounce when resume retries the dirty snapshot immediately", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ revision: 1 });
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result, rerender } = renderHook(({ resumeVersion }) => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 0,
      ensureLease,
      save,
      resumeVersion,
    }), { initialProps: { resumeVersion: 0 } });

    act(() => result.current.scheduleSave([row("resume before debounce")]));
    await act(async () => {
      rerender({ resumeVersion: 1 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(900); await Promise.resolve(); });

    expect(ensureLease).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.revisionRef.current).toBe(1);
  });

  it("processes the same resume edge once for each story and user scope", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result, rerender } = renderHook(({ storyId, resumeVersion }) => useScenarioAutosave({
      storyId,
      userId: 1,
      initialRevision: 0,
      ensureLease,
      save: (payload) => save(storyId, payload),
      resumeVersion,
    }), { initialProps: { storyId: 101, resumeVersion: 0 } });

    act(() => result.current.scheduleSave([row("story A draft")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); });
    await act(async () => { rerender({ storyId: 101, resumeVersion: 1 }); await Promise.resolve(); });

    await act(async () => { rerender({ storyId: 202, resumeVersion: 0 }); await Promise.resolve(); });
    act(() => result.current.scheduleSave([row("story B draft")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); });
    await act(async () => { rerender({ storyId: 202, resumeVersion: 1 }); await Promise.resolve(); });

    expect(save.mock.calls.map(([storyId, payload]) => [storyId, payload.rows[0].text])).toEqual([
      [101, "story A draft"],
      [101, "story A draft"],
      [202, "story B draft"],
      [202, "story B draft"],
    ]);
  });

  it("does not leak an in-flight story A queue into story B and saves B with lease B", async () => {
    vi.useFakeTimers();
    const saveA = createDeferred<{ revision: number }>();
    const save = vi.fn((storyId: number, _payload: unknown) => storyId === 101 ? saveA.promise : Promise.resolve({ revision: 1 }));
    const ensureLease = vi.fn((storyId: number) => Promise.resolve(storyId === 101
      ? { edit_session_id: 1, lease_token: "lease-a" }
      : { edit_session_id: 2, lease_token: "lease-b" }));
    const { result, rerender } = renderHook(({ storyId }) => useScenarioAutosave({
      storyId,
      userId: 1,
      initialRevision: 0,
      ensureLease: () => ensureLease(storyId),
      save: (payload) => save(storyId, payload),
    }), { initialProps: { storyId: 101 } });

    act(() => result.current.scheduleSave([row("story A in flight")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); });
    act(() => result.current.scheduleSave([row("story A queued")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); });

    await act(async () => { rerender({ storyId: 202 }); await Promise.resolve(); });
    act(() => result.current.scheduleSave([row("story B latest")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); await Promise.resolve(); });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([202, expect.objectContaining({
      edit_session_id: 2,
      lease_token: "lease-b",
      rows: [expect.objectContaining({ text: "story B latest" })],
    })]);

    await act(async () => { saveA.resolve({ revision: 1 }); await saveA.promise; await Promise.resolve(); });
    expect(save.mock.calls.filter(([storyId]) => storyId === 101)).toHaveLength(1);
  });

  it("invalidates server-expired A before online autosave acquires B and preserves the draft until B ack", async () => {
    let now = Date.parse("2026-07-15T12:00:00Z");
    const releaseA = createDeferred<void>();
    const saveB = createDeferred<{ revision: number }>();
    let acquireCount = 0;
    const transport = {
      acquire: vi.fn(async () => {
        acquireCount += 1;
        return acquireCount === 1
          ? { edit_session_id: 1, lease_token: "lease-a", expires_at: "2026-07-15T12:01:30Z", revision: 0 }
          : { edit_session_id: 2, lease_token: "lease-b", expires_at: "2026-07-15T12:05:00Z", revision: 0 };
      }),
      heartbeat: vi.fn().mockRejectedValue(new Error("offline")),
      release: vi.fn(() => releaseA.promise),
    };
    const controller = new EditLeaseController(101, transport, Promise.resolve(), () => now);
    const save = vi.fn((payload) => {
      expect(payload).toMatchObject({ edit_session_id: 2, lease_token: "lease-b" });
      return saveB.promise;
    });
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 0,
      ensureLease: controller.acquire,
      save,
    }));

    await controller.acquire();
    now = Date.parse("2026-07-15T12:00:30Z");
    controller.touch();
    controller.heartbeatTick();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    now = Date.parse("2026-07-15T12:01:00Z");
    controller.touch();
    now = Date.parse("2026-07-15T12:01:31Z");
    controller.touch();

    act(() => result.current.scheduleSave([row("latest offline rows")]));
    act(() => window.dispatchEvent(new Event("online")));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(controller.getSnapshot().lease).toBeNull();
    expect(transport.release).toHaveBeenCalledWith(101, expect.objectContaining({ edit_session_id: 1 }), false);
    expect(acquireCount).toBe(1);
    expect(save).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toContain("latest offline rows");

    await act(async () => {
      releaseA.resolve();
      await releaseA.promise;
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().lease).toMatchObject({ edit_session_id: 2, lease_token: "lease-b" });
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toContain("latest offline rows");

    await act(async () => {
      saveB.resolve({ revision: 1 });
      await saveB.promise;
      await Promise.resolve();
    });
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toBeNull();
  });
});
