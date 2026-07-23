import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import StoryProductionPage from "../../pages/StoryProductionPage";
import { createDeferred } from "../../test/deferred";
import ExternalApprovalCycles from "./components/ExternalApprovalCycles";
import ExternalResultDialog from "./components/ExternalResultDialog";
import type { ExternalApprovalReadModel } from "./types";


const chief = {
  id: 1,
  username: "astra",
  display_name: "Астра",
  position: "Начальник",
  function_codes: ["chief"],
};
const author = {
  id: 4,
  username: "lira",
  display_name: "Лира",
  position: "Корреспондент",
  function_codes: ["author"],
};
const editor = {
  id: 5,
  username: "orion",
  display_name: "Орион",
  position: "Монтажёр",
  function_codes: ["video_editor"],
};
const action = (code: string, href: string, form: null | "external_result" = null) => ({
  code,
  label: code === "external_approval_send"
    ? "Отправить на внешнее согласование"
    : code === "external_approval_approved"
      ? "Согласовано"
      : "Есть правки",
  method: "POST" as const,
  href,
  emphasis: "primary" as const,
  confirmation: null,
  form,
});
const model: ExternalApprovalReadModel = {
  story_id: 101,
  items: [
    {
      id: 3,
      cycle_no: 3,
      sent_by: chief,
      sent_at: "2026-07-23T10:00:00Z",
      result: "pending",
      decided_by: null,
      decided_at: null,
      correction_package_id: null,
      primary_action: action("external_approval_approved", "/api/v1/stories/101/external-approval-cycles/3/result"),
      additional_actions: [
        action("external_approval_changes_requested", "/api/v1/stories/101/external-approval-cycles/3/result", "external_result"),
      ],
    },
    {
      id: 2,
      cycle_no: 2,
      sent_by: chief,
      sent_at: "2026-07-22T10:00:00Z",
      result: "changes_requested",
      decided_by: chief,
      decided_at: "2026-07-22T11:00:00Z",
      correction_package_id: 44,
      primary_action: null,
      additional_actions: [],
    },
    {
      id: 1,
      cycle_no: 1,
      sent_by: chief,
      sent_at: "2026-07-21T10:00:00Z",
      result: "approved",
      decided_by: chief,
      decided_at: "2026-07-21T11:00:00Z",
      correction_package_id: null,
      primary_action: null,
      additional_actions: [],
    },
  ],
  assignee_options: [author, editor],
  send_action: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("ExternalApprovalCycles", () => {
  it("renders repeated pending, approved and changes-requested cycles only from server data", () => {
    render(
      <ExternalApprovalCycles
        model={model}
        loading={false}
        error=""
        mutationPending={false}
        onRetry={vi.fn()}
        onMutate={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Цикл №/).map((item) => item.textContent)).toEqual([
      "Цикл №3", "Цикл №2", "Цикл №1",
    ]);
    expect(screen.getByText("Ожидается результат")).toBeInTheDocument();
    expect(screen.getByText("Есть правки", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Согласовано", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Согласовано" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Есть правки" })).toBeInTheDocument();
  });

  it("shows loading/error/retry, executes server actions and keeps archived/non-leadership data read-only", async () => {
    const onRetry = vi.fn();
    const onMutate = vi.fn(async (mutation: () => Promise<unknown>) => {
      await mutation();
    });
    const { rerender } = render(
      <ExternalApprovalCycles
        model={null}
        loading
        error=""
        mutationPending={false}
        onRetry={onRetry}
        onMutate={onMutate}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Загрузка согласований");

    rerender(
      <ExternalApprovalCycles
        model={null}
        loading={false}
        error="Сервис недоступен"
        mutationPending={false}
        onRetry={onRetry}
        onMutate={onMutate}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetry).toHaveBeenCalledOnce();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    rerender(
      <ExternalApprovalCycles
        model={model}
        loading={false}
        error=""
        mutationPending={false}
        onRetry={onRetry}
        onMutate={onMutate}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Согласовано" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/v1/stories/101/external-approval-cycles/3/result",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ result: "approved", parts: [] }),
      }),
    ));

    rerender(
      <ExternalApprovalCycles
        model={{ ...model, items: model.items.map((item) => ({ ...item, primary_action: null, additional_actions: [] })) }}
        loading={false}
        error=""
        mutationPending={false}
        onRetry={onRetry}
        onMutate={onMutate}
      />,
    );
    expect(screen.queryByRole("button", { name: "Согласовано" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Есть правки" })).not.toBeInTheDocument();
  });

  it("rejects empty parts and submits exact add/remove multi-part payload with focus return and retry", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Открыть";
    document.body.append(trigger);
    trigger.focus();
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error("Результат не сохранён"))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    const { rerender } = render(
      <ExternalResultDialog
        open
        action={model.items[0].additional_actions[0]}
        assigneeOptions={[author, editor]}
        mutationPending={false}
        onClose={onClose}
        onSubmit={submit}
      />,
    );
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(screen.getByLabelText("Описание правки")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Зафиксировать результат" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Описание правки"), "  Уточнить текст  ");
    await userEvent.selectOptions(screen.getByLabelText("Ответственный"), String(author.id));
    await userEvent.click(screen.getByRole("button", { name: "Добавить часть" }));
    const descriptions = screen.getAllByLabelText("Описание правки");
    const assignees = screen.getAllByLabelText("Ответственный");
    await userEvent.type(descriptions[1], "Сократить ролик");
    await userEvent.selectOptions(assignees[1], String(editor.id));
    await userEvent.click(screen.getByRole("button", { name: "Добавить часть" }));
    const removeButtons = screen.getAllByRole("button", { name: "Удалить часть" });
    await userEvent.click(removeButtons[removeButtons.length - 1]);
    expect(screen.getAllByLabelText("Описание правки")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Зафиксировать результат" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Результат не сохранён");
    expect(screen.getAllByLabelText("Описание правки")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Зафиксировать результат" }));
    expect(submit).toHaveBeenLastCalledWith({
      result: "changes_requested",
      parts: [
        { scope: "text", description: "Уточнить текст", assignee_user_id: author.id },
        { scope: "text", description: "Сократить ролик", assignee_user_id: editor.id },
      ],
    });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <ExternalResultDialog
        open={false}
        action={null}
        assigneeOptions={[author, editor]}
        mutationPending={false}
        onClose={onClose}
        onSubmit={submit}
      />,
    );
    expect(trigger).toHaveFocus();

    rerender(
      <ExternalResultDialog
        open
        action={model.items[0].additional_actions[0]}
        assigneeOptions={[author, editor]}
        mutationPending={false}
        onClose={onClose}
        onSubmit={submit}
      />,
    );
    const close = screen.getByRole("button", { name: "Закрыть" });
    close.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Отмена" })).toHaveFocus();
  });
});

describe("StoryProductionPage external approval integration", () => {
  const production = {
    story: {
      id: 101,
      title: "Сюжет",
      priority: { code: "standard", label: "Стандарт" },
      rubric: { id: 1, name: "Новости" },
      author,
      situation: { code: "production_pending", label: "Производство не начато" },
      assignments: [],
      created_at: "2026-07-23T09:00:00Z",
      aired_at: null,
      archived_at: null,
      primary_action: null,
      additional_actions: [],
    },
    scenario_revision: 0,
    assignments: [],
    assignee_options: [chief, author, editor],
    can_manage_assignments: true,
    materials: [],
    corrections: {
      href: "/api/v1/stories/101/correction-packages",
      total_count: 0,
      open_count: 0,
      awaiting_leadership_review_count: 0,
    },
    external_approval: {
      href: "/api/v1/stories/101/external-approval-cycles",
      total_count: 3,
      pending_cycle_no: 3,
      last_result: "pending",
    },
    voiceover: { ready: false, ready_by: null, ready_at: null },
    video: {
      started_by: null,
      started_at: null,
      ready_by: null,
      ready_at: null,
      approved_for_titles_by: null,
      approved_for_titles_at: null,
      last_opened_revision: null,
      has_unseen_scenario_changes: false,
    },
    titles: {
      initial_gate_satisfied: false,
      started_by: null,
      started_at: null,
      ready_by: null,
      ready_at: null,
      accepted_by: null,
      accepted_at: null,
      last_opened_revision: null,
      has_unseen_scenario_changes: false,
    },
    aired: null,
    stages: [],
    primary_action: null,
    additional_actions: [],
  };
  const corrections = {
    story_id: 101,
    items: [],
    assignee_options: [author, editor],
    create_action: null,
  };
  const json = (payload: unknown) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  it("uses one coordinator to refetch production, corrections and external after success", async () => {
    const sendModel = {
      story_id: 101,
      items: [],
      assignee_options: [author, editor],
      send_action: action("external_approval_send", "/api/v1/stories/101/external-approval-cycles/send"),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(production))
      .mockResolvedValueOnce(json(corrections))
      .mockResolvedValueOnce(json(sendModel))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json(production))
      .mockResolvedValueOnce(json(corrections))
      .mockResolvedValueOnce(json(model));
    vi.stubGlobal("fetch", fetchMock);

    render(<StoryProductionPage storyId={101} />);
    await userEvent.click(await screen.findByRole("button", { name: "Отправить на внешнее согласование" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    expect(fetchMock.mock.calls.slice(4).map(([path]) => String(path))).toEqual([
      "/api/v1/stories/101/production",
      "/api/v1/stories/101/correction-packages",
      "/api/v1/stories/101/external-approval-cycles",
    ]);
  });

  it("isolates stale external responses when the story changes", async () => {
    const stale = createDeferred<Response>();
    const current = { ...model, story_id: 202, items: [] };
    const production202 = {
      ...production,
      story: { ...production.story, id: 202, title: "Другой сюжет" },
      corrections: { ...production.corrections, href: "/api/v1/stories/202/correction-packages" },
      external_approval: { ...production.external_approval, href: "/api/v1/stories/202/external-approval-cycles" },
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/v1/stories/101/production") return Promise.resolve(json(production));
      if (path === "/api/v1/stories/101/correction-packages") return Promise.resolve(json(corrections));
      if (path === "/api/v1/stories/101/external-approval-cycles") return stale.promise;
      if (path === "/api/v1/stories/202/production") return Promise.resolve(json(production202));
      if (path === "/api/v1/stories/202/correction-packages") return Promise.resolve(json({ ...corrections, story_id: 202 }));
      if (path === "/api/v1/stories/202/external-approval-cycles") return Promise.resolve(json(current));
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<StrictMode><StoryProductionPage storyId={101} /></StrictMode>);
    expect(await screen.findByRole("heading", { name: "Сюжет" })).toBeInTheDocument();
    rerender(<StrictMode><StoryProductionPage storyId={202} /></StrictMode>);
    expect(await screen.findByRole("heading", { name: "Другой сюжет" })).toBeInTheDocument();
    await act(async () => stale.resolve(json(model)));
    expect(screen.queryByText("Цикл №3")).not.toBeInTheDocument();
  });
});
