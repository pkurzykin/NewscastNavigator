import { describe, it, expect, vi } from "vitest";
import { EditLeaseController } from "./editLeaseController";
import { entryPolicy } from "./useScenarioAccess";

const credential = { edit_session_id: 1, lease_token: "local", revision: 2, expires_at: "2099-01-01T00:00:00Z" };
describe("scenario owned access", () => {
  it("requires local credentials even when another window belongs to the same actor", async () => {
    const transport = { acquire: vi.fn(async () => credential), release: vi.fn(async () => {}), heartbeat: vi.fn() };
    const controller = new EditLeaseController(1, transport);
    expect(() => controller.getOwnedLease()).toThrow();
    await controller.acquire();
    expect(controller.getOwnedLease()).toEqual(credential);
    expect(transport.acquire).toHaveBeenCalledTimes(1);
  });
  it("checks expiry synchronously and never reacquires to return credentials", async () => {
    let now = Date.parse("2026-01-01");
    const transport = { acquire: vi.fn(async () => ({ ...credential, expires_at: new Date(now + 10).toISOString() })), release: vi.fn(async () => {}), heartbeat: vi.fn() };
    const controller = new EditLeaseController(1, transport, Promise.resolve(), () => now);
    await controller.acquire();
    now += 11;
    expect(() => controller.getOwnedLease()).toThrow();
    expect(transport.acquire).toHaveBeenCalledTimes(1);
  });
  it("reports failed explicit release and retries the same token", async () => {
    const transport = { acquire: vi.fn(async () => credential), release: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined), heartbeat: vi.fn() };
    const controller = new EditLeaseController(1, transport);
    await controller.acquire();
    await expect(controller.release()).rejects.toThrow("offline");
    expect(() => controller.getOwnedLease()).toThrow();
    expect(controller.getSnapshot().error).toBe("offline");
    await controller.release();
    expect(controller.getSnapshot().error).toBe("");
    expect(transport.release).toHaveBeenCalledTimes(2);
    expect(transport.release.mock.calls[1][1]).toEqual(credential);
  });
  it.each([
    [[], "editorial"], [["video_editor"], "explicit"], [["designer", "operator"], "explicit"],
    [["designer", "author"], "editorial"], [["video_editor", "proofreader"], "editorial"],
    [["chief", "designer"], "editorial"], [["chief_editor", "video_editor"], "editorial"],
  ])("chooses entry policy for %j", (codes, expected) => expect(entryPolicy(codes)).toBe(expected));
});
