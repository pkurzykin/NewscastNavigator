import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditLease } from "./useEditLease";
import { EditLeaseController, EditLeaseLifecycleCancelledError } from "./editLeaseController";
import { createDeferred } from "../../test/deferred";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function dispatchPageTransition(type: "pagehide" | "pageshow", persisted: boolean) {
  const event = new Event(type);
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

const leasePayload = (id: number, token = `lease-token-${id}`) => ({
  edit_session_id: id,
  lease_token: token,
  expires_at: `2026-07-15T12:${String(id).padStart(2, "0")}:00Z`,
  revision: id,
});

const releaseAck = () => response({
  ok: true,
  event_id: null,
  changed_at: "2026-07-15T12:00:00Z",
  resource: null,
});

describe("useEditLease lifecycle", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("releases an acquired lease through unload-surviving transport without removing the local draft", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") {
        return response({
          edit_session_id: 37,
          lease_token: "lease-token-37",
          expires_at: "2026-07-15T12:00:00Z",
          revision: 4,
        });
      }
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") {
        return response({ ok: true, event_id: null, changed_at: "2026-07-15T12:00:00Z", resource: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const draftKey = "newscast:scenario-draft:101:1";
    const draftValue = JSON.stringify({ revision: 4, rows: [{ text: "Локальная правка" }] });
    window.localStorage.setItem(draftKey, draftValue);
    const { result, unmount } = renderHook(() => useEditLease(101), { wrapper: StrictMode });

    await act(async () => {
      await result.current.acquire();
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    });
    const [, releaseInit] = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")!;
    expect(releaseInit).toMatchObject({
      method: "DELETE",
      keepalive: true,
      body: JSON.stringify({ edit_session_id: 37, lease_token: "lease-token-37" }),
    });
    expect(window.localStorage.getItem(draftKey)).toBe(draftValue);
    unmount();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it("immediately releases a lease that finishes acquiring after page exit", async () => {
    const pendingAcquire = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") {
        return pendingAcquire.promise;
      }
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") {
        return response({ ok: true, event_id: null, changed_at: "2026-07-15T12:00:00Z", resource: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useEditLease(101), { wrapper: StrictMode });

    const acquisition = result.current.acquire();
    const acquisitionOutcome = acquisition.then(() => "resolved", () => "rejected");
    await act(async () => { await Promise.resolve(); });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    unmount();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);

    await act(async () => {
      pendingAcquire.resolve(response({
        edit_session_id: 81,
        lease_token: "late-lease-token-81",
        expires_at: "2026-07-15T12:00:00Z",
        revision: 9,
      }));
      await pendingAcquire.promise;
    });

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    });
    const [, releaseInit] = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")!;
    expect(releaseInit).toMatchObject({
      method: "DELETE",
      keepalive: true,
      body: JSON.stringify({ edit_session_id: 81, lease_token: "late-lease-token-81" }),
    });
    expect(await acquisitionOutcome).toBe("rejected");
    expect(result.current.lease).toBeNull();
  });

  it("starts a new lease generation after returning from the back-forward cache", async () => {
    const staleAcquire = createDeferred<Response>();
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") {
        acquireCount += 1;
        if (acquireCount === 1) return staleAcquire.promise;
        if (acquireCount === 2) {
          return response({
            edit_session_id: 92,
            lease_token: "resumed-lease-token-92",
            expires_at: "2026-07-15T12:01:00Z",
            revision: 10,
          });
        }
      }
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") {
        return response({ ok: true, event_id: null, changed_at: "2026-07-15T12:01:00Z", resource: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const draftKey = "newscast:scenario-draft:101:1";
    const draftValue = JSON.stringify({ revision: 9, rows: [{ text: "BFCache draft" }] });
    window.localStorage.setItem(draftKey, draftValue);
    const { result, unmount } = renderHook(() => useEditLease(101), { wrapper: StrictMode });

    const staleAcquisition = result.current.acquire();
    const staleOutcome = staleAcquisition.then(() => "resolved", () => "rejected");
    await act(async () => { await Promise.resolve(); });
    act(() => {
      dispatchPageTransition("pagehide", true);
      dispatchPageTransition("pageshow", true);
    });
    const resumedAcquisition = result.current.acquire();
    const resumedOutcome = resumedAcquisition.then((lease) => ({ status: "resolved", lease }), () => ({ status: "rejected", lease: null }));

    expect(acquireCount).toBe(1);
    await act(async () => {
      staleAcquire.resolve(response({
        edit_session_id: 91,
        lease_token: "stale-lease-token-91",
        expires_at: "2026-07-15T12:00:00Z",
        revision: 9,
      }));
      await staleAcquire.promise;
      await Promise.resolve();
      await resumedOutcome;
    });

    expect(await staleOutcome).toBe("rejected");
    expect(await resumedOutcome).toEqual({
      status: "resolved",
      lease: expect.objectContaining({ edit_session_id: 92, lease_token: "resumed-lease-token-92" }),
    });
    expect(result.current.lease).toEqual(expect.objectContaining({ edit_session_id: 92, lease_token: "resumed-lease-token-92" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    });

    act(() => dispatchPageTransition("pagehide", false));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(2);
    });
    const releaseBodies = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "DELETE")
      .map(([, init]) => init?.body);
    expect(releaseBodies).toEqual([
      JSON.stringify({ edit_session_id: 91, lease_token: "stale-lease-token-91" }),
      JSON.stringify({ edit_session_id: 92, lease_token: "resumed-lease-token-92" }),
    ]);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE").every(([, init]) => init?.keepalive === true)).toBe(true);
    expect(window.localStorage.getItem(draftKey)).toBe(draftValue);
    unmount();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(2);
  });

  it("keeps lease B when a deferred heartbeat for A resolves after BFCache resume", async () => {
    vi.useFakeTimers();
    const heartbeatA = createDeferred<Response>();
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/lease/heartbeat")) return heartbeatA.promise;
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(++acquireCount));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    act(() => { result.current.touch(); vi.advanceTimersByTime(30_000); });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/lease/heartbeat"))).toHaveLength(1);
    act(() => { dispatchPageTransition("pagehide", true); dispatchPageTransition("pageshow", true); });
    await act(async () => { await result.current.acquire(); });

    await act(async () => {
      heartbeatA.resolve(response({ ok: true, expires_at: "2026-07-15T13:00:00Z" }));
      await heartbeatA.promise;
      await Promise.resolve();
    });

    expect(result.current.lease).toMatchObject({ edit_session_id: 2, lease_token: "lease-token-2" });
    await expect(result.current.acquire()).resolves.toMatchObject({ edit_session_id: 2 });
    expect(acquireCount).toBe(2);
    expect(result.current.error).toBe("");
    unmount();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(2);
  });

  it("does not resurrect A when its deferred heartbeat resolves before resumed acquire B", async () => {
    vi.useFakeTimers();
    const heartbeatA = createDeferred<Response>();
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/lease/heartbeat")) return heartbeatA.promise;
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(++acquireCount));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    act(() => { result.current.touch(); vi.advanceTimersByTime(30_000); });
    act(() => { dispatchPageTransition("pagehide", true); dispatchPageTransition("pageshow", true); });
    await act(async () => {
      heartbeatA.resolve(response({ ok: true, expires_at: "2026-07-15T13:00:00Z" }));
      await heartbeatA.promise;
      await Promise.resolve();
    });

    expect(result.current.lease).toBeNull();
    await act(async () => { await result.current.acquire(); });
    expect(acquireCount).toBe(2);
    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
  });

  it("ignores a deferred heartbeat error from A after lease B becomes current", async () => {
    vi.useFakeTimers();
    const heartbeatA = createDeferred<Response>();
    let heartbeatCount = 0;
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/lease/heartbeat")) {
        heartbeatCount += 1;
        return heartbeatCount === 1
          ? heartbeatA.promise
          : response({ ok: true, expires_at: "2026-07-15T14:00:00Z" });
      }
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(++acquireCount));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    act(() => { result.current.touch(); vi.advanceTimersByTime(30_000); });
    act(() => { dispatchPageTransition("pagehide", true); dispatchPageTransition("pageshow", true); });
    await act(async () => { await result.current.acquire(); });
    await act(async () => {
      heartbeatA.reject(new Error("stale heartbeat A"));
      await heartbeatA.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
    expect(result.current.error).toBe("");
    act(() => { result.current.touch(); vi.advanceTimersByTime(30_000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(heartbeatCount).toBe(2);
    expect(result.current.lease).toMatchObject({ edit_session_id: 2, expires_at: "2026-07-15T14:00:00Z" });
    expect(result.current.error).toBe("");
  });

  it("coalesces heartbeat ticks and never starts H2 while H1 is pending", async () => {
    vi.useFakeTimers();
    const heartbeat1 = createDeferred<Response>();
    let heartbeatCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/lease/heartbeat")) {
        heartbeatCount += 1;
        return heartbeatCount === 1 ? heartbeat1.promise : response({ ok: true, expires_at: "2026-07-15T14:00:00Z" });
      }
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(1));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    act(() => { result.current.touch(); vi.advanceTimersByTime(60_000); });
    expect(heartbeatCount).toBe(1);
    await act(async () => {
      heartbeat1.resolve(response({ ok: true, expires_at: "2026-07-15T13:00:00Z" }));
      await heartbeat1.promise;
      await Promise.resolve();
    });
    act(() => { result.current.touch(); vi.advanceTimersByTime(30_000); });
    expect(heartbeatCount).toBe(2);
  });

  it("invalidates a pending acquire when explicit release is requested", async () => {
    const pendingAcquire = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return pendingAcquire.promise;
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    const acquisition = result.current.acquire();
    await act(async () => { await Promise.resolve(); });
    const release = result.current.release();
    await act(async () => {
      pendingAcquire.resolve(response(leasePayload(1)));
      await pendingAcquire.promise;
      await release;
    });

    await expect(acquisition).rejects.toThrow("закрыт");
    expect(result.current.lease).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it("waits for explicit DELETE A before starting acquire B", async () => {
    const pendingDelete = createDeferred<Response>();
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(++acquireCount));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return pendingDelete.promise;
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    const release = result.current.release();
    const acquisition = result.current.acquire();
    expect(acquireCount).toBe(1);
    await act(async () => {
      pendingDelete.resolve(releaseAck());
      await release;
      await acquisition;
    });
    expect(acquireCount).toBe(2);
    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
  });

  it("drains stale acquire A and its release before BFCache acquire B", async () => {
    const staleAcquire = createDeferred<Response>();
    const staleDelete = createDeferred<Response>();
    let active: number | null = null;
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") {
        acquireCount += 1;
        if (active !== null) return new Response(JSON.stringify({ error: { message: "HELD" } }), { status: 409 });
        active = acquireCount;
        return acquireCount === 1 ? staleAcquire.promise : response(leasePayload(acquireCount));
      }
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") {
        const body = JSON.parse(String(init.body));
        if (body.edit_session_id === active) active = null;
        return staleDelete.promise;
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    const acquisitionA = result.current.acquire();
    await act(async () => { await Promise.resolve(); });
    act(() => { dispatchPageTransition("pagehide", true); dispatchPageTransition("pageshow", true); });
    const acquisitionB = result.current.acquire();
    expect(acquireCount).toBe(1);
    await act(async () => {
      staleAcquire.resolve(response(leasePayload(1)));
      await staleAcquire.promise;
      await Promise.resolve();
    });
    expect(acquireCount).toBe(1);
    await act(async () => {
      staleDelete.resolve(releaseAck());
      await staleDelete.promise;
      await acquisitionB;
    });
    await expect(acquisitionA).rejects.toThrow();
    expect(acquireCount).toBe(2);
    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
  });

  it("releases inactive A and reacquires B on the next edit", async () => {
    vi.useFakeTimers();
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(++acquireCount));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      if (url.endsWith("/lease/heartbeat")) return response({ ok: true, expires_at: "2026-07-15T13:00:00Z" });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    act(() => { vi.advanceTimersByTime(120_000); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.lease).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    await act(async () => { await result.current.acquire(); });
    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
  });

  it("returns one canonical promise for same-epoch acquire callers", async () => {
    const pendingAcquire = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/scenario/lease") && init?.method === "POST") return pendingAcquire.promise;
      if (String(input).endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    const first = result.current.acquire();
    const second = result.current.acquire();
    expect(first).toBe(second);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => {
      pendingAcquire.resolve(response(leasePayload(1)));
      await first;
    });
  });

  it("isolates lease state, errors, and operations across storyId changes", async () => {
    vi.useFakeTimers();
    const oldHeartbeat = createDeferred<Response>();
    const oldRelease = createDeferred<Response>();
    const requestOrder: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/stories/101/") && url.endsWith("/lease/heartbeat")) return oldHeartbeat.promise;
      if (url.includes("/stories/101/") && url.endsWith("/scenario/lease") && init?.method === "POST") {
        requestOrder.push("acquire-101");
        return response(leasePayload(1));
      }
      if (url.includes("/stories/101/") && url.endsWith("/scenario/lease") && init?.method === "DELETE") {
        requestOrder.push("release-101");
        return oldRelease.promise;
      }
      if (url.includes("/stories/202/") && url.endsWith("/scenario/lease") && init?.method === "POST") {
        requestOrder.push("acquire-202");
        return response(leasePayload(2));
      }
      if (url.includes("/stories/202/") && url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ storyId }) => useEditLease(storyId), { initialProps: { storyId: 101 } });

    await act(async () => { await result.current.acquire(); });
    act(() => { result.current.touch(); vi.advanceTimersByTime(30_000); });
    rerender({ storyId: 202 });
    expect(result.current.lease).toBeNull();
    expect(result.current.error).toBe("");
    const acquisition202 = result.current.acquire();
    await act(async () => { await Promise.resolve(); });
    expect(requestOrder).toEqual(["acquire-101", "release-101"]);
    await act(async () => {
      oldRelease.resolve(releaseAck());
      await oldRelease.promise;
      await acquisition202;
    });
    await act(async () => {
      oldHeartbeat.reject(new Error("old story heartbeat"));
      await oldHeartbeat.promise.catch(() => undefined);
    });

    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
    expect(result.current.error).toBe("");
    expect(requestOrder).toEqual(["acquire-101", "release-101", "acquire-202"]);
  });

  it("waits for a late story-101 acquire and exact release before acquiring story 202", async () => {
    const acquire101 = createDeferred<Response>();
    const release101 = createDeferred<Response>();
    const requestOrder: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/stories/101/") && url.endsWith("/scenario/lease") && init?.method === "POST") {
        requestOrder.push("acquire-101");
        return acquire101.promise;
      }
      if (url.includes("/stories/101/") && url.endsWith("/scenario/lease") && init?.method === "DELETE") {
        requestOrder.push("release-101");
        return release101.promise;
      }
      if (url.includes("/stories/202/") && url.endsWith("/scenario/lease") && init?.method === "POST") {
        requestOrder.push("acquire-202");
        return response(leasePayload(2));
      }
      if (url.includes("/stories/202/") && url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ storyId }) => useEditLease(storyId), { initialProps: { storyId: 101 } });

    const stale101 = result.current.acquire();
    const staleOutcome = stale101.then(() => "resolved", () => "rejected");
    await act(async () => { await Promise.resolve(); });
    rerender({ storyId: 202 });
    const acquisition202 = result.current.acquire();
    await act(async () => { await Promise.resolve(); });
    expect(requestOrder).toEqual(["acquire-101"]);

    await act(async () => {
      acquire101.resolve(response(leasePayload(1)));
      await acquire101.promise;
      await Promise.resolve();
    });
    expect(requestOrder).toEqual(["acquire-101", "release-101"]);

    await act(async () => {
      release101.resolve(releaseAck());
      await release101.promise;
      await acquisition202;
    });
    expect(await staleOutcome).toBe("rejected");
    expect(requestOrder).toEqual(["acquire-101", "release-101", "acquire-202"]);
    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
    expect(result.current.error).toBe("");
  });

  it("does not publish after StrictMode cleanup and coalesces duplicate exit release", async () => {
    vi.useFakeTimers();
    const heartbeat = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/lease/heartbeat")) return heartbeat.promise;
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(1));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useEditLease(101), { wrapper: StrictMode });

    await act(async () => { await result.current.acquire(); });
    act(() => { result.current.touch(); vi.advanceTimersByTime(30_000); });
    act(() => dispatchPageTransition("pagehide", true));
    unmount();
    await act(async () => {
      heartbeat.resolve(response({ ok: true, expires_at: "2026-07-15T13:00:00Z" }));
      await heartbeat.promise;
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it("does not reactivate a terminal document on pageshow persisted=false", async () => {
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") {
        acquireCount += 1;
        return response(leasePayload(acquireCount));
      }
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    act(() => {
      dispatchPageTransition("pagehide", false);
      dispatchPageTransition("pageshow", false);
    });

    await expect(result.current.acquire()).rejects.toBeInstanceOf(Error);
    expect(acquireCount).toBe(1);
    expect(result.current.lease).toBeNull();
  });

  it("invalidates inactive A before touch and acquire can refresh its activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    let acquireCount = 0;
    const releaseA = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(++acquireCount));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseA.promise;
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    vi.setSystemTime(new Date("2026-07-15T12:02:00Z"));
    act(() => result.current.touch());
    const acquisitionB = result.current.acquire();

    expect(result.current.lease).toBeNull();
    expect(acquireCount).toBe(1);
    await act(async () => {
      releaseA.resolve(releaseAck());
      await releaseA.promise;
      await acquisitionB;
    });
    expect(acquireCount).toBe(2);
    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
  });

  it("invalidates inactive A before direct acquire returns a local credential", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(++acquireCount));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    vi.setSystemTime(new Date("2026-07-15T12:02:00Z"));
    await act(async () => { await result.current.acquire(); });

    expect(acquireCount).toBe(2);
    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
  });

  it("detaches a credential after a typed terminal heartbeat response and reacquires", async () => {
    vi.useFakeTimers();
    let acquireCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/lease/heartbeat")) {
        return new Response(JSON.stringify({ error: { code: "SCENARIO_LEASE_EXPIRED", message: "Lease expired" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return response(leasePayload(++acquireCount));
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") return releaseAck();
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    await act(async () => { await result.current.acquire(); });
    act(() => { result.current.touch(); vi.advanceTimersByTime(30_000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.lease).toBeNull();
    expect(result.current.error).toBe("Lease expired");
    await act(async () => { await result.current.acquire(); });
    expect(acquireCount).toBe(2);
    expect(result.current.lease).toMatchObject({ edit_session_id: 2 });
  });

  it("keeps typed lifecycle cancellation when stale-acquire release transport fails", async () => {
    const pendingAcquire = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease") && init?.method === "POST") return pendingAcquire.promise;
      if (url.endsWith("/scenario/lease") && init?.method === "DELETE") throw new Error("release transport failed");
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useEditLease(101));

    const acquisition = result.current.acquire();
    await act(async () => { await Promise.resolve(); });
    act(() => dispatchPageTransition("pagehide", true));
    await act(async () => {
      pendingAcquire.resolve(response(leasePayload(1)));
      await pendingAcquire.promise;
      await Promise.resolve();
    });

    await expect(acquisition).rejects.toBeInstanceOf(EditLeaseLifecycleCancelledError);
    expect(result.current.lease).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  });

  it("does not publish to the external store when a late heartbeat settles after suspension", async () => {
    const heartbeat = createDeferred<{ ok: true; expires_at: string }>();
    const transport = {
      acquire: vi.fn().mockResolvedValue(leasePayload(1)),
      heartbeat: vi.fn().mockReturnValue(heartbeat.promise),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new EditLeaseController(101, transport);
    const subscriber = vi.fn();
    controller.subscribe(subscriber);

    await controller.acquire();
    controller.touch();
    controller.heartbeatTick();
    await controller.suspend();
    const publicationsAfterSuspend = subscriber.mock.calls.length;
    expect(transport.release).toHaveBeenCalledTimes(1);

    heartbeat.resolve({ ok: true, expires_at: "2026-07-15T14:00:00Z" });
    await heartbeat.promise;
    await Promise.resolve();

    expect(subscriber).toHaveBeenCalledTimes(publicationsAfterSuspend);
    expect(controller.getSnapshot().lease).toBeNull();
  });
});
