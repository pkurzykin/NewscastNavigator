import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScenarioAccess } from "./useScenarioAccess";
import { createDeferred } from "../../test/deferred";
import type { ScenarioLease } from "./types";
const local = { edit_session_id: 10, lease_token: "private", expires_at: "2099-01-01T00:00:00Z", revision: 1 };
function setup(acquire = vi.fn(async () => local)) {
  let owned: ScenarioLease | null = null;
  const lease = { lease: null as ScenarioLease | null, acquire: async () => (owned = await acquire()), getOwnedLease: () => { if (!owned) throw new Error("no lease"); return owned; }, release: vi.fn(async () => { owned = null; }) };
  const options = { storyId: 1, userId: 1, functions: ["author"], edit: { state: "available" as const }, revision: () => 1, lease, flush: vi.fn(async () => {}), onRevisionMismatch: vi.fn(async () => {}) };
  return { options, acquire };
}
afterEach(() => vi.unstubAllGlobals());
function poll(edit = { state: "available" }) { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ story_id: 1, revision: 1, edit }), { status: 200 }))); }
describe("useScenarioAccess", () => {
 it("does not acquire on viewing and coalesces simultaneous edit intent", async () => {
  poll(); const pending = createDeferred<ScenarioLease>(); const fixture = setup(vi.fn(() => pending.promise));
  const { result } = renderHook(() => useScenarioAccess(fixture.options));
  expect(result.current.canMutate()).toBe(false);
  expect(fixture.acquire).not.toHaveBeenCalled();
  let a!: Promise<boolean>; let b!: Promise<boolean>;
  act(() => { a = result.current.requestEdit(); b = result.current.requestEdit(); });
  expect(result.current.canMutate()).toBe(false);
  await act(async () => { pending.resolve(local); await Promise.all([a, b]); });
  expect(fixture.acquire).toHaveBeenCalledTimes(1);
  expect(result.current.canMutate()).toBe(true);
 });
 it("keeps revision mismatch closed instead of writing a stale candidate", async () => {
  poll(); const fixture = setup(vi.fn(async () => ({ ...local, revision: 2 })));
  const { result } = renderHook(() => useScenarioAccess(fixture.options));
  await act(async () => { expect(await result.current.requestEdit()).toBe(false); });
  expect(result.current.canMutate()).toBe(false);
  expect(fixture.options.onRevisionMismatch).toHaveBeenCalledWith(2);
 });
 it("does not call release until both save coordinators flush successfully", async () => {
  poll(); const fixture = setup(); const flush = createDeferred<void>(); fixture.options.flush = vi.fn(() => flush.promise);
  const { result } = renderHook(() => useScenarioAccess(fixture.options));
  await act(async () => { await result.current.requestEdit(); });
  let leaving!: Promise<void>;
  act(() => { leaving = result.current.leaveEditing(); });
  expect(result.current.canMutate()).toBe(false);
  expect(fixture.options.lease.release).not.toHaveBeenCalled();
  await act(async () => { flush.resolve(); await leaving; });
  expect(fixture.options.lease.release).toHaveBeenCalledOnce();
  expect(result.current.phase).toBe("read");
 });
 it("polls access independently of the scenario and blocks same-user other session", async () => {
  poll({ state: "mine", edit_session_id: 99 } as never); const fixture = setup();
  const { result } = renderHook(() => useScenarioAccess(fixture.options));
  await waitFor(() => expect(result.current.edit.edit_session_id).toBe(99));
  expect(result.current.canMutate()).toBe(false);
  expect(fixture.acquire).not.toHaveBeenCalled();
 });
});

it("does not release while a separately buffered input still needs reconciliation", async () => {
 poll(); const fixture = setup();
 const { result } = renderHook(() => useScenarioAccess({ ...fixture.options, hasPendingInput: () => true }));
 await act(async () => { await result.current.requestEdit(); });
 await act(async () => { await expect(result.current.leaveEditing()).rejects.toThrow(); });
 expect(result.current.phase).toBe("editing");
 expect(fixture.options.flush).not.toHaveBeenCalled();
 expect(fixture.options.lease.release).not.toHaveBeenCalled();
});
