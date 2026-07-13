import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ScenarioEditor from "./components/ScenarioEditor";
import { createDeferred } from "../../test/deferred";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("ScenarioEditor autosave", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("preserves input made while an acknowledgement-only save is in flight", async () => {
    const pendingSave = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario") && init?.method === "PUT") return pendingSave.promise;
      if (url.endsWith("/scenario/lease")) return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2026-07-12T12:00:00Z", revision: 0 });
      if (url.endsWith("/scenario")) {
        return response({
          story: { id: 101, title: "Синтетический сюжет" },
          scenario: { revision: 0, rows: [{ segment_uid: "seg_00000000-0000-4000-8000-000000000001", order_index: 1, block_type: "zk", text: "Базовый текст", speaker_text: "", file_name: "", tc_in: "", tc_out: "", additional_comment: "", structured_data: {}, formatting: {}, rich_text: { schema_version: 1, targets: {} } }] },
          edit: { state: "available" },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(editor);
    await user.type(editor, " до запроса");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await user.type(editor, " после запроса");

    await act(async () => {
      pendingSave.resolve(response({ ok: true, client_save_id: "save", revision: 1, saved_at: "2026-07-12T12:00:00Z" }));
      await pendingSave.promise;
    });

    expect(editor).toHaveTextContent("Базовый текст до запроса после запроса");
  });
});
