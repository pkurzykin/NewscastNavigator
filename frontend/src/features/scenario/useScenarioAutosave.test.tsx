import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScenarioAutosave } from "./useScenarioAutosave";
import { EditLeaseController } from "./editLeaseController";
import type { ScenarioRow } from "./types";
import { createDeferred } from "../../test/deferred";
import { ApiError } from "../../shared/api/client";

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

  it("freezes the original local snapshot after a revision conflict until explicit resolution", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValue(
      new ApiError("Сценарий уже изменён", 409, "SCENARIO_REVISION_CONFLICT"),
    );
    const ensureLease = vi.fn().mockResolvedValue({
      edit_session_id: 7,
      lease_token: "lease",
    });
    const onRevisionConflict = vi.fn();
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 4,
      save,
      ensureLease,
      onRevisionConflict,
    }));

    act(() => result.current.scheduleSave([row("исходный локальный текст")]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("conflict");
    expect(onRevisionConflict).toHaveBeenCalledWith(expect.objectContaining({
      revision: 4,
      rows: [expect.objectContaining({ text: "исходный локальный текст" })],
    }));

    act(() => result.current.scheduleSave([row("попытка затереть конфликт")]));
    window.dispatchEvent(new Event("online"));
    act(() => result.current.retryLatest());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(save).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
      .toContain("исходный локальный текст");
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
      .not.toContain("попытка затереть конфликт");
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

  it("flushPending resolves a clean scope at the current revision without acquiring a lease", async () => {
    // Production mutation: starting a save for an already drained scope must fail this test.
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const save = vi.fn().mockResolvedValue({ revision: 12 });
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 11,
      ensureLease,
      save,
    }));

    let resolvedRevision = 0;
    await act(async () => {
      resolvedRevision = await result.current.flushPending();
    });

    expect(resolvedRevision).toBe(11);
    expect(ensureLease).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("flushPending cancels debounce and saves the pending snapshot immediately", async () => {
    // Production mutation: leaving the debounce timer active must delay or duplicate this save.
    vi.useFakeTimers();
    const saveAck = createDeferred<{ revision: number }>();
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const save = vi.fn((_payload: { base_revision: number; rows: ScenarioRow[] }) => saveAck.promise);
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 4,
      ensureLease,
      save,
    }));

    act(() => result.current.scheduleSave([row("без ожидания debounce")]));
    let flush!: Promise<number>;
    await act(async () => {
      flush = result.current.flushPending();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      base_revision: 4,
      rows: [expect.objectContaining({ text: "без ожидания debounce" })],
    });

    let revision = 0;
    await act(async () => {
      saveAck.resolve({ revision: 5 });
      revision = await flush;
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });

    expect(revision).toBe(5);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushPending waits for an old in-flight save and then the newest queued snapshot", async () => {
    // Production mutation: resolving after the first ack or sending the middle snapshot must fail this test.
    vi.useFakeTimers();
    const firstAck = createDeferred<{ revision: number }>();
    const latestAck = createDeferred<{ revision: number }>();
    const save = vi.fn()
      .mockReturnValueOnce(firstAck.promise)
      .mockReturnValueOnce(latestAck.promise);
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 4,
      ensureLease,
      save,
    }));

    act(() => result.current.scheduleSave([row("старая в запросе")]));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    act(() => result.current.scheduleSave([row("промежуточная")]));
    act(() => result.current.scheduleSave([row("последняя редакция")]));

    let flush!: Promise<number>;
    let settled = false;
    await act(async () => {
      flush = result.current.flushPending();
      void flush.finally(() => { settled = true; });
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstAck.resolve({ revision: 5 });
      await firstAck.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(settled).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
      .toContain("последняя редакция");
    expect(save.mock.calls.map(([payload]) => ({
      baseRevision: payload.base_revision,
      text: payload.rows[0].text,
    }))).toEqual([
      { baseRevision: 4, text: "старая в запросе" },
      { baseRevision: 5, text: "последняя редакция" },
    ]);

    let revision = 0;
    await act(async () => {
      latestAck.resolve({ revision: 6 });
      revision = await flush;
    });

    expect(revision).toBe(6);
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toBeNull();
  });

  it("flushPending rejects a network failure and keeps the latest draft", async () => {
    // Production mutation: clearing the draft or resolving on a failed request must fail this test.
    const saveAck = createDeferred<{ revision: number }>();
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const save = vi.fn(() => saveAck.promise);
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 9,
      ensureLease,
      save,
    }));

    act(() => result.current.scheduleSave([row("черновик при сетевой ошибке")]));
    const flush = result.current.flushPending();
    void flush.catch(() => undefined);
    await act(async () => {
      saveAck.reject(new Error("Сеть недоступна"));
      await saveAck.promise.catch(() => undefined);
      await Promise.resolve();
    });

    await expect(flush).rejects.toThrow("Сеть недоступна");
    expect(result.current.status).toBe("error");
    expect(result.current.revisionRef.current).toBe(9);
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
      .toContain("черновик при сетевой ошибке");
  });

  it("flushPending rejects a revision conflict and preserves local conflict state", async () => {
    // Production mutation: treating conflict as a successful drain must fail this test.
    const conflict = new ApiError(
      "Сценарий уже изменён",
      409,
      "SCENARIO_REVISION_CONFLICT",
    );
    const saveAck = createDeferred<{ revision: number }>();
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const save = vi.fn(() => saveAck.promise);
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 14,
      ensureLease,
      save,
    }));

    act(() => result.current.scheduleSave([row("локальная конфликтующая редакция")]));
    const flush = result.current.flushPending();
    void flush.catch(() => undefined);
    await act(async () => {
      saveAck.reject(conflict);
      await saveAck.promise.catch(() => undefined);
      await Promise.resolve();
    });

    await expect(flush).rejects.toBe(conflict);
    expect(result.current.status).toBe("conflict");
    expect(result.current.isDirty()).toBe(true);
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
      .toContain("локальная конфликтующая редакция");
  });

  it.each([
    { label: "story", nextStoryId: 202, nextUserId: 1 },
    { label: "user", nextStoryId: 101, nextUserId: 2 },
  ])("flushPending rejects waiters from an old $label scope and never resolves them with the new revision", async ({
    nextStoryId,
    nextUserId,
  }) => {
    // Production mutation: sharing waiters across scope generations must fail this test.
    const oldAck = createDeferred<{ revision: number }>();
    const newAck = createDeferred<{ revision: number }>();
    const save = vi.fn((scope: string, _payload: unknown) => (
      scope === "101:1" ? oldAck.promise : newAck.promise
    ));
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result, rerender } = renderHook(({ storyId, userId, initialRevision }) => useScenarioAutosave({
      storyId,
      userId,
      initialRevision,
      ensureLease,
      save: (payload) => save(`${storyId}:${userId}`, payload),
    }), {
      initialProps: { storyId: 101, userId: 1, initialRevision: 10 },
    });

    act(() => result.current.scheduleSave([row("черновик старой области")]));
    const oldFlush = result.current.flushPending();
    void oldFlush.catch(() => undefined);
    await act(async () => {
      await Promise.resolve();
      rerender({ storyId: nextStoryId, userId: nextUserId, initialRevision: 20 });
      await Promise.resolve();
    });

    await expect(oldFlush).rejects.toThrow("область");

    act(() => result.current.scheduleSave([row("черновик новой области")]));
    const newFlush = result.current.flushPending();
    await act(async () => {
      newAck.resolve({ revision: 21 });
      await newAck.promise;
    });
    await expect(newFlush).resolves.toBe(21);

    await act(async () => {
      oldAck.resolve({ revision: 11 });
      await oldAck.promise;
      await Promise.resolve();
    });
    expect(result.current.revisionRef.current).toBe(21);
  });

  it("flushPending rejects a waiter when its autosave owner unmounts", async () => {
    // Production mutation: leaving unmounted waiters pending forever must fail this test.
    const saveAck = createDeferred<{ revision: number }>();
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const { result, unmount } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 3,
      ensureLease,
      save: () => saveAck.promise,
    }));

    act(() => result.current.scheduleSave([row("черновик перед unmount")]));
    const flush = result.current.flushPending();
    void flush.catch(() => undefined);
    act(() => unmount());

    await expect(flush).rejects.toThrow("размонтирован");
  });

  it("multiple flushPending callers share one save chain and receive the same final revision", async () => {
    // Production mutation: starting one save per waiter must fail this test.
    const saveAck = createDeferred<{ revision: number }>();
    const ensureLease = vi.fn().mockResolvedValue({ edit_session_id: 7, lease_token: "lease" });
    const save = vi.fn(() => saveAck.promise);
    const { result } = renderHook(() => useScenarioAutosave({
      storyId: 101,
      userId: 1,
      initialRevision: 15,
      ensureLease,
      save,
    }));

    act(() => result.current.scheduleSave([row("одна цепочка сохранения")]));
    const firstFlush = result.current.flushPending();
    const secondFlush = result.current.flushPending();

    await act(async () => {
      saveAck.resolve({ revision: 16 });
      await saveAck.promise;
    });

    await expect(Promise.all([firstFlush, secondFlush])).resolves.toEqual([16, 16]);
    expect(ensureLease).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
