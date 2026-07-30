import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ScenarioEditor from "./components/ScenarioEditor";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ScenarioEditor hydration boundary", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not acquire a lease, save, or create a draft while hydrating stored rich text", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/stories/101/scenario") && !init?.method) {
        return response({
          story: { id: 101, title: "Синтетический сюжет" },
          scenario: {
            revision: 4,
            rows: [{
              segment_uid: "seg_00000000-0000-4000-8000-000000000001",
              order_index: 1,
              block_type: "zk",
              text: "Сохранённый текст",
              speaker_text: "",
              file_name: "",
              tc_in: "",
              tc_out: "",
              additional_comment: "",
              structured_data: {},
              formatting: {},
              rich_text: {
                schema_version: 1,
                targets: {
                  text: {
                    editor: "tiptap",
                    text: "Сохранённый текст",
                    html: "<p>Сохранённый текст</p>",
                    doc: {
                      type: "doc",
                      content: [{
                        type: "paragraph",
                        content: [{ type: "text", text: "Сохранённый текст" }],
                      }],
                    },
                  },
                },
              },
            }],
          },
          edit: { state: "available" },
        });
      }
      if (url.endsWith("/api/v1/stories/101/scenario/lease") && init?.method === "POST") {
        return response({
          edit_session_id: 37,
          lease_token: "lease-token-37",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 4,
        });
      }
      if (url.endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT") {
        return response({ ok: true, client_save_id: "save", revision: 5, saved_at: "2026-07-15T12:00:00Z" });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);

    expect(await screen.findByRole("textbox", { name: "Текст блока 1" })).toHaveTextContent("Сохранённый текст");
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    });

    expect(fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith("/scenario/lease") && init?.method === "POST")).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith("/scenario") && init?.method === "PUT")).toHaveLength(0);
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toBeNull();
  });
});
