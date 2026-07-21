import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../features/editor-core/EditorField", () => ({
  EditorCoreField: ({ ariaLabel }: { ariaLabel: string }) => <div aria-label={ariaLabel} />,
}));

import StoryScenarioPage from "./StoryScenarioPage";
import { createDeferred } from "../test/deferred";

const jsonResponse = (payload: unknown) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

const story = (id: number) => ({
  id,
  title: `Story ${id}`,
  rubric: { id: 1, name: "Synthetic rubric" },
  priority: { code: "standard", label: "Стандарт" },
  author: { id: 1, display_name: "Synthetic author" },
  situation: { code: "draft", label: "Черновик" },
});

const scenario = (id: number) => ({
  story: { id, title: `Story ${id}` },
  scenario: { revision: 0, rows: [] },
  edit: { state: "available" },
  captionpanels: null,
});

const requestRecord = (input: RequestInfo | URL, init?: RequestInit) => ({
  path: String(input),
  method: init?.method ?? "GET",
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("StoryScenarioPage lease handoff", () => {
  it("marks every production context with the loaded scenario revision", async () => {
    window.history.replaceState(
      {},
      "",
      "/stories/101/scenario?production_context=video&production_context=titles",
    );
    const opened: Array<{ revision: number; context: string }> = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestRecord(input, init);
      if (request.method === "GET" && request.path === "/api/v1/stories/101") {
        return Promise.resolve(jsonResponse(story(101)));
      }
      if (request.method === "GET" && request.path === "/api/v1/stories/101/scenario") {
        return Promise.resolve(jsonResponse({
          ...scenario(101),
          scenario: { revision: 7, rows: [] },
        }));
      }
      if (request.method === "GET" && request.path === "/api/v1/stories/101/workflow") {
        return Promise.resolve(jsonResponse({
          story_id: 101,
          review_request: null,
          editorial_check: null,
          proofread: null,
          changed_after_proofread: false,
          reproofread_request: null,
          primary_action: null,
          additional_actions: [],
        }));
      }
      if (request.method === "POST" && request.path === "/api/v1/stories/101/scenario/opened") {
        opened.push(JSON.parse(String(init?.body)) as { revision: number; context: string });
        return Promise.resolve(jsonResponse({ ok: true, event_id: null, changed_at: "2026-07-20T10:00:00Z", resource: { type: "scenario", id: 1 } }));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    }));

    render(<StoryScenarioPage storyId={101} activeTab="scenario" userId={1} />);

    await screen.findByRole("button", { name: "Добавить блок" });
    await waitFor(() => expect(opened).toEqual([
      { revision: 7, context: "video" },
      { revision: 7, context: "titles" },
    ]));
  });

  it("retries only a production context whose opened marker failed", async () => {
    window.history.replaceState(
      {},
      "",
      "/stories/101/scenario?production_context=video&production_context=titles",
    );
    const attempts: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestRecord(input, init);
      if (request.method === "GET" && request.path === "/api/v1/stories/101") {
        return Promise.resolve(jsonResponse(story(101)));
      }
      if (request.method === "GET" && request.path === "/api/v1/stories/101/scenario") {
        return Promise.resolve(jsonResponse({ ...scenario(101), scenario: { revision: 7, rows: [] } }));
      }
      if (request.method === "GET" && request.path === "/api/v1/stories/101/workflow") {
        return Promise.resolve(jsonResponse({
          story_id: 101,
          review_request: null,
          editorial_check: null,
          proofread: null,
          changed_after_proofread: false,
          reproofread_request: null,
          primary_action: null,
          additional_actions: [],
        }));
      }
      if (request.method === "POST" && request.path === "/api/v1/stories/101/scenario/opened") {
        const context = (JSON.parse(String(init?.body)) as { context: string }).context;
        attempts.push(context);
        if (context === "video" && attempts.filter((item) => item === "video").length === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: { code: "MARKER_FAILED", message: "marker down", details: {} } }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }));
        }
        return Promise.resolve(jsonResponse({ ok: true, event_id: null, changed_at: "2026-07-20T10:00:00Z", resource: { type: "scenario", id: 1 } }));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    }));
    render(<StoryScenarioPage storyId={101} activeTab="scenario" userId={1} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось отметить открытие актуального сценария");
    expect(attempts).toEqual(["video", "titles"]);
    fireEvent.click(screen.getByRole("button", { name: "Повторить отметку открытия" }));

    await waitFor(() => expect(attempts).toEqual(["video", "titles", "video"]));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("isolates a late marker batch from the next story with the same context", async () => {
    window.history.replaceState({}, "", "/stories/101/scenario?production_context=video");
    const storyB = createDeferred<Response>();
    const openedA = createDeferred<Response>();
    const openedB = createDeferred<Response>();
    const attempts: Array<{ storyId: number; revision: number; context: string }> = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestRecord(input, init);
      if (request.method === "GET" && request.path === "/api/v1/stories/101") {
        return Promise.resolve(jsonResponse(story(101)));
      }
      if (request.method === "GET" && request.path === "/api/v1/stories/202") return storyB.promise;
      if (request.method === "GET" && request.path === "/api/v1/stories/101/scenario") {
        return Promise.resolve(jsonResponse({ ...scenario(101), scenario: { revision: 7, rows: [] } }));
      }
      if (request.method === "GET" && request.path === "/api/v1/stories/202/scenario") {
        return Promise.resolve(jsonResponse({ ...scenario(202), scenario: { revision: 8, rows: [] } }));
      }
      if (request.method === "GET" && request.path.endsWith("/workflow")) {
        return Promise.resolve(jsonResponse({
          story_id: request.path.includes("/202/") ? 202 : 101,
          review_request: null,
          editorial_check: null,
          proofread: null,
          changed_after_proofread: false,
          reproofread_request: null,
          primary_action: null,
          additional_actions: [],
        }));
      }
      if (request.method === "POST" && request.path.endsWith("/scenario/opened")) {
        const payload = JSON.parse(String(init?.body)) as { revision: number; context: string };
        const markerStoryId = request.path.includes("/202/") ? 202 : 101;
        attempts.push({ storyId: markerStoryId, ...payload });
        if (markerStoryId === 101) return openedA.promise;
        if (attempts.filter((attempt) => attempt.storyId === 202).length === 1) return openedB.promise;
        return Promise.resolve(jsonResponse({ ok: true, event_id: null, changed_at: "2026-07-20T10:00:00Z", resource: { type: "scenario", id: 2 } }));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    }));

    const view = render(<StoryScenarioPage storyId={101} activeTab="scenario" userId={1} />);
    await waitFor(() => expect(attempts).toEqual([{ storyId: 101, revision: 7, context: "video" }]));

    window.history.replaceState({}, "", "/stories/202/scenario?production_context=video");
    view.rerender(<StoryScenarioPage storyId={202} activeTab="scenario" userId={1} />);
    await screen.findByRole("status");
    await act(async () => {
      openedA.resolve(jsonResponse({ ok: true, event_id: null, changed_at: "2026-07-20T10:00:00Z", resource: { type: "scenario", id: 1 } }));
      await openedA.promise;
      storyB.resolve(jsonResponse(story(202)));
      await storyB.promise;
    });
    await waitFor(() => expect(attempts.some((attempt) => attempt.storyId === 202)).toBe(true));
    await act(async () => {
      openedB.resolve(new Response(JSON.stringify({ error: { code: "MARKER_FAILED", message: "marker B down", details: {} } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }));
      await openedB.promise;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось отметить открытие актуального сценария");
    expect(attempts.filter((attempt) => attempt.storyId === 202)).toEqual([
      { storyId: 202, revision: 8, context: "video" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Повторить отметку открытия" }));
    await waitFor(() => expect(attempts.filter((attempt) => attempt.storyId === 202)).toEqual([
      { storyId: 202, revision: 8, context: "video" },
      { storyId: 202, revision: 8, context: "video" },
    ]));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("keeps story B behind exact release A across a real child unmount/remount in StrictMode", async () => {
    const storyB = createDeferred<Response>();
    const releaseA = createDeferred<Response>();
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestRecord(input, init);
      requests.push(request);
      if (request.method === "GET" && request.path === "/api/v1/stories/101") return Promise.resolve(jsonResponse(story(101)));
      if (request.method === "GET" && request.path === "/api/v1/stories/202") return storyB.promise;
      if (request.method === "GET" && request.path === "/api/v1/stories/101/scenario") return Promise.resolve(jsonResponse(scenario(101)));
      if (request.method === "GET" && request.path === "/api/v1/stories/202/scenario") return Promise.resolve(jsonResponse(scenario(202)));
      if (request.method === "POST" && request.path === "/api/v1/stories/101/scenario/lease") {
        return Promise.resolve(jsonResponse({ edit_session_id: 1, lease_token: "lease-a", expires_at: "2099-07-15T12:00:00Z", revision: 0 }));
      }
      if (request.method === "DELETE" && request.path === "/api/v1/stories/101/scenario/lease") return releaseA.promise;
      if (request.method === "POST" && request.path === "/api/v1/stories/202/scenario/lease") {
        return Promise.resolve(jsonResponse({ edit_session_id: 2, lease_token: "lease-b", expires_at: "2099-07-15T12:00:00Z", revision: 0 }));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    }));

    const view = render(<StrictMode><StoryScenarioPage storyId={101} activeTab="scenario" userId={1} /></StrictMode>);
    fireEvent.click(await screen.findByRole("button", { name: "Добавить блок" }));
    await waitFor(() => expect(requests).toContainEqual({ path: "/api/v1/stories/101/scenario/lease", method: "POST" }));

    view.rerender(<StrictMode><StoryScenarioPage storyId={202} activeTab="scenario" userId={1} /></StrictMode>);
    await screen.findByRole("status");
    await waitFor(() => expect(requests).toContainEqual({ path: "/api/v1/stories/101/scenario/lease", method: "DELETE" }));
    await act(async () => { storyB.resolve(jsonResponse(story(202))); await storyB.promise; });
    await screen.findAllByRole("heading", { name: "Story 202" });
    fireEvent.click(screen.getByRole("button", { name: "Добавить блок" }));
    await act(async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); });

    expect(requests).not.toContainEqual({ path: "/api/v1/stories/202/scenario/lease", method: "POST" });
    await act(async () => { releaseA.resolve(jsonResponse({ ok: true })); await releaseA.promise; });
    await waitFor(() => expect(requests).toContainEqual({ path: "/api/v1/stories/202/scenario/lease", method: "POST" }));
  });

  it("waits for a late acquire A and its exact release before acquiring B in StrictMode", async () => {
    const storyB = createDeferred<Response>();
    const acquireA = createDeferred<Response>();
    const releaseA = createDeferred<Response>();
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = requestRecord(input, init);
      requests.push(request);
      if (request.method === "GET" && request.path === "/api/v1/stories/101") return Promise.resolve(jsonResponse(story(101)));
      if (request.method === "GET" && request.path === "/api/v1/stories/202") return storyB.promise;
      if (request.method === "GET" && request.path === "/api/v1/stories/101/scenario") return Promise.resolve(jsonResponse(scenario(101)));
      if (request.method === "GET" && request.path === "/api/v1/stories/202/scenario") return Promise.resolve(jsonResponse(scenario(202)));
      if (request.method === "POST" && request.path === "/api/v1/stories/101/scenario/lease") return acquireA.promise;
      if (request.method === "DELETE" && request.path === "/api/v1/stories/101/scenario/lease") return releaseA.promise;
      if (request.method === "POST" && request.path === "/api/v1/stories/202/scenario/lease") {
        return Promise.resolve(jsonResponse({ edit_session_id: 2, lease_token: "lease-b", expires_at: "2099-07-15T12:00:00Z", revision: 0 }));
      }
      throw new Error(`Unexpected request: ${request.method} ${request.path}`);
    }));

    const view = render(<StrictMode><StoryScenarioPage storyId={101} activeTab="scenario" userId={1} /></StrictMode>);
    fireEvent.click(await screen.findByRole("button", { name: "Добавить блок" }));
    await waitFor(() => expect(requests).toContainEqual({ path: "/api/v1/stories/101/scenario/lease", method: "POST" }));

    view.rerender(<StrictMode><StoryScenarioPage storyId={202} activeTab="scenario" userId={1} /></StrictMode>);
    await screen.findByRole("status");
    await act(async () => { storyB.resolve(jsonResponse(story(202))); await storyB.promise; });
    await screen.findAllByRole("heading", { name: "Story 202" });
    fireEvent.click(screen.getByRole("button", { name: "Добавить блок" }));
    await act(async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); });
    expect(requests).not.toContainEqual({ path: "/api/v1/stories/202/scenario/lease", method: "POST" });

    await act(async () => {
      acquireA.resolve(jsonResponse({ edit_session_id: 1, lease_token: "lease-a", expires_at: "2099-07-15T12:00:00Z", revision: 0 }));
      await acquireA.promise;
    });
    await waitFor(() => expect(requests).toContainEqual({ path: "/api/v1/stories/101/scenario/lease", method: "DELETE" }));
    expect(requests).not.toContainEqual({ path: "/api/v1/stories/202/scenario/lease", method: "POST" });

    await act(async () => { releaseA.resolve(jsonResponse({ ok: true })); await releaseA.promise; });
    await waitFor(() => expect(requests).toContainEqual({ path: "/api/v1/stories/202/scenario/lease", method: "POST" }));
  });
});
