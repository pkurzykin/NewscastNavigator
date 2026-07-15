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
});
