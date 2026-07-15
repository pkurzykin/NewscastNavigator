import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditLease } from "./useEditLease";
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

describe("useEditLease lifecycle", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
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
    act(() => {
      dispatchPageTransition("pagehide", true);
      dispatchPageTransition("pageshow", true);
    });
    const resumedAcquisition = result.current.acquire();
    const resumedOutcome = resumedAcquisition.then((lease) => ({ status: "resolved", lease }), () => ({ status: "rejected", lease: null }));

    expect(acquireCount).toBe(2);
    await act(async () => {
      staleAcquire.resolve(response({
        edit_session_id: 91,
        lease_token: "stale-lease-token-91",
        expires_at: "2026-07-15T12:00:00Z",
        revision: 9,
      }));
      await staleAcquire.promise;
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
});
