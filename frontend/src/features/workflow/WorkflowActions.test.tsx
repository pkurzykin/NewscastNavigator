import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkflowActions from "./components/WorkflowActions";
import WorkflowSummary from "./components/WorkflowSummary";
import type { WorkflowReadModel } from "./types";


const primary = {
  code: "confirm_editorial",
  label: "Текст готов",
  method: "POST" as const,
  href: "/api/v1/stories/101/workflow/confirm-editorial",
  emphasis: "primary" as const,
  confirmation: null,
  form: null,
};

const additional = {
  code: "mark_proofread",
  label: "Вычитано",
  method: "POST" as const,
  href: "/api/v1/stories/101/workflow/mark-proofread",
  emphasis: "normal" as const,
  confirmation: null,
  form: null,
};

const actor = {
  id: 4,
  username: "mayak",
  display_name: "Маяк",
  position: "Корректор",
  function_codes: ["author", "proofreader"],
};

const model: WorkflowReadModel = {
  story_id: 101,
  review_request: null,
  editorial_check: null,
  proofread: null,
  changed_after_proofread: false,
  reproofread_request: null,
  primary_action: primary,
  additional_actions: [additional],
};

const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});

afterEach(() => vi.unstubAllGlobals());

describe("WorkflowActions", () => {
  it("renders one coherent ordered block for combined functions", () => {
    render(<WorkflowActions workflow={model} revision={7} onRefresh={vi.fn()} />);

    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Текст готов", "Вычитано"]);
    expect(screen.getByRole("button", { name: "Текст готов" })).toHaveClass("primary");
  });

  it("posts the exact current revision once, disables pending actions and refetches", async () => {
    let resolveRequest!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveRequest = resolve; });
    const fetchMock = vi.fn(() => pending);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<WorkflowActions workflow={model} revision={7} onRefresh={onRefresh} />);

    const button = screen.getByRole("button", { name: "Текст готов" });
    await user.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(primary.href, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ revision: 7 }),
      credentials: "include",
    }));
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Вычитано" })).toBeDisabled();

    resolveRequest(response({ ok: true, event_id: "9", changed_at: "2026-07-15T10:00:00Z", resource: null }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("waits for the editor lease boundary before posting the workflow command", async () => {
    let releaseLease!: () => void;
    const leaseBoundary = new Promise<void>((resolve) => { releaseLease = resolve; });
    const beforeAction = vi.fn(() => leaseBoundary);
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, event_id: "11", changed_at: "2026-07-15T10:00:00Z", resource: null }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<WorkflowActions workflow={model} revision={7} beforeAction={beforeAction} onRefresh={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Текст готов" }));
    expect(beforeAction).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    releaseLease();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("keeps server actions disabled while the local editor is not idle", () => {
    render(<WorkflowActions workflow={model} revision={7} disabled onRefresh={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Текст готов" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Вычитано" })).toBeDisabled();
  });

  it("shows a Russian retryable error and recovers on the next action", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: { code: "TEMP", message: "Сервис временно недоступен", details: {} } }, 503))
      .mockResolvedValueOnce(response({ ok: true, event_id: "10", changed_at: "2026-07-15T10:00:00Z", resource: null }));
    vi.stubGlobal("fetch", fetchMock);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<WorkflowActions workflow={model} revision={7} onRefresh={onRefresh} />);

    await user.click(screen.getByRole("button", { name: "Текст готов" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервис временно недоступен");
    expect(screen.getByRole("button", { name: "Текст готов" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Текст готов" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders no controls when the server provides no actions", () => {
    render(<WorkflowActions workflow={{ ...model, primary_action: null, additional_actions: [] }} revision={7} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("WorkflowSummary", () => {
  it("shows revision-bound marks and the changed-after-proofread warning", () => {
    render(<WorkflowSummary workflow={{
      ...model,
      editorial_check: { revision: 6, actor, at: "2026-07-15T09:00:00Z" },
      proofread: { revision: 6, actor, at: "2026-07-15T09:15:00Z" },
      changed_after_proofread: true,
    }} />);

    expect(screen.getByText(/Редакционная готовность/).parentElement).toHaveTextContent("Маяк");
    expect(screen.getByText(/Редакционная готовность/).parentElement).toHaveTextContent("редакция 6");
    expect(screen.getByText(/Корректура/).parentElement).toHaveTextContent("Маяк");
    expect(screen.getByText("Изменён после вычитки")).toBeInTheDocument();
  });
});
