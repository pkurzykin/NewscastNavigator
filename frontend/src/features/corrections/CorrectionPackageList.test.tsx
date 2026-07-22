import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import StoryProductionPage from "../../pages/StoryProductionPage";
import { createDeferred } from "../../test/deferred";
import CorrectionPackageDialog from "./components/CorrectionPackageDialog";
import CorrectionPackageList from "./components/CorrectionPackageList";
import type {
  CorrectionAction,
  CorrectionPackageCreatePayload,
  CorrectionPackagesResponse,
} from "./types";
import type { ProductionReadModel } from "../production/types";


const chief = {
  id: 1,
  username: "astra",
  display_name: "Астра",
  position: "Начальник",
  function_codes: ["chief"],
};
const editor = {
  id: 2,
  username: "orion",
  display_name: "Орион",
  position: "Монтажёр",
  function_codes: ["video_editor"],
};
const designer = {
  id: 3,
  username: "runa",
  display_name: "Руна",
  position: "Дизайнер",
  function_codes: ["designer"],
};

const correctionAction = (
  code: string,
  label: string,
  href: string,
  options: Partial<CorrectionAction> = {},
): CorrectionAction => ({
  code,
  label,
  method: "POST",
  href,
  emphasis: "normal",
  confirmation: null,
  form: null,
  part_id: null,
  part_scope: null,
  ...options,
});

const createAction = correctionAction(
  "correction_package_create",
  "Создать пакет правок",
  "/api/v1/stories/101/correction-packages",
  { form: "correction_package" },
);
const videoComplete = correctionAction(
  "correction_part_complete",
  "Правки выполнены — ролик готов",
  "/api/v1/stories/101/correction-packages/12/parts/21/complete",
  { emphasis: "primary", part_id: 21, part_scope: "video" },
);
const returnText = correctionAction(
  "correction_part_return",
  "Вернуть часть в работу",
  "/api/v1/stories/101/correction-packages/12/parts/20/return",
  { form: "return_reason", part_id: 20, part_scope: "text" },
);
const closePackage = correctionAction(
  "correction_package_close",
  "Закрыть пакет правок",
  "/api/v1/stories/101/correction-packages/12/close",
  { emphasis: "primary" },
);

const corrections: CorrectionPackagesResponse = {
  story_id: 101,
  assignee_options: [chief, editor, designer],
  create_action: createAction,
  items: [
    {
      id: 12,
      source: "external",
      created_by: chief,
      created_at: "2026-07-22T09:30:00Z",
      parts: [
        {
          id: 20,
          scope: "text",
          description: "Уточнить формулировку",
          assignee: chief,
          state: "done",
          completed_by: chief,
          completed_at: "2026-07-22T10:00:00Z",
        },
        {
          id: 21,
          scope: "video",
          description: "Заменить финальный план",
          assignee: editor,
          state: "pending",
          completed_by: null,
          completed_at: null,
        },
      ],
      all_parts_complete: false,
      awaiting_leadership_review: false,
      closed_by: null,
      closed_at: null,
      primary_action: videoComplete,
      additional_actions: [returnText],
    },
  ],
};

const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});

const ack = response({
  ok: true,
  event_id: "501",
  changed_at: "2026-07-22T10:10:00Z",
  resource: { type: "correction_part", id: 21 },
});

const production: ProductionReadModel = {
  story: {
    id: 101,
    title: "Синтетический сюжет с правками",
    priority: { code: "high", label: "Высокий" },
    rubric: { id: 7, name: "Новости" },
    author: chief,
    situation: { code: "video_ready", label: "Ролик готов · ожидает просмотра" },
    assignments: [{ kind: "video_editor", user: editor }, { kind: "designer", user: designer }],
    created_at: "2026-07-22T08:00:00Z",
    aired_at: null,
    archived_at: null,
    primary_action: null,
    additional_actions: [],
  },
  scenario_revision: 4,
  assignments: [{ kind: "video_editor", user: editor }, { kind: "designer", user: designer }],
  assignee_options: [chief, editor, designer],
  can_manage_assignments: true,
  materials: [],
  corrections: {
    href: "/api/v1/stories/101/correction-packages",
    total_count: 1,
    open_count: 1,
    awaiting_leadership_review_count: 0,
  },
  voiceover: { ready: false, ready_by: null, ready_at: null },
  video: {
    started_by: editor,
    started_at: "2026-07-22T08:30:00Z",
    ready_by: null,
    ready_at: null,
    approved_for_titles_by: null,
    approved_for_titles_at: null,
    last_opened_revision: 4,
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
  stages: [
    { code: "voiceover", state: "pending", label: "Озвучка", summary: "Не готова" },
    { code: "video", state: "in_progress", label: "Монтаж", summary: "Правки в работе" },
    { code: "titles", state: "blocked", label: "Титры", summary: "Ожидают ролик" },
  ],
  primary_action: null,
  additional_actions: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("CorrectionPackageList", () => {
  it("renders the whole server package and its ordered actions without calculating gates", () => {
    render(
      <CorrectionPackageList
        model={corrections}
        loading={false}
        error=""
        mutationPending={false}
        onRetry={vi.fn()}
        onMutate={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    const packageCard = screen.getByRole("article", { name: "Пакет правок №12" });
    expect(within(packageCard).getByText("Внешний пакет")).toBeInTheDocument();
    expect(within(packageCard).getByText(/Создал: Астра/)).toBeInTheDocument();
    expect(within(packageCard).getByText("Уточнить формулировку")).toBeInTheDocument();
    expect(within(packageCard).getByText("Заменить финальный план")).toBeInTheDocument();
    expect(within(packageCard).getByText(/Выполнил: Астра/)).toBeInTheDocument();
    expect(within(packageCard).getByText(/Ответственный: Орион/)).toBeInTheDocument();
    expect(within(packageCard).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Правки выполнены — ролик готов",
      "Вернуть часть в работу",
    ]);
    expect(within(packageCard).getByRole("button", { name: "Правки выполнены — ролик готов" })).toHaveClass("primary");
    expect(document.querySelectorAll(".correction-package-actions .primary")).toHaveLength(1);
  });

  it("builds one internal multi-part payload with add/remove rows", async () => {
    const submit = vi.fn<(payload: CorrectionPackageCreatePayload) => Promise<void>>().mockResolvedValue();
    const user = userEvent.setup();
    render(
      <CorrectionPackageDialog
        open
        action={createAction}
        assigneeOptions={[editor, designer]}
        initialScope="video"
        mutationPending={false}
        onClose={vi.fn()}
        onSubmit={submit}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Новый пакет правок" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Область правки")).toHaveLength(1);
    expect(screen.getByLabelText("Область правки")).toHaveValue("video");
    await user.type(screen.getByLabelText("Описание правки"), "  Исправить монтаж  ");
    await user.selectOptions(screen.getByLabelText("Ответственный"), String(editor.id));
    await user.click(screen.getByRole("button", { name: "Добавить часть" }));
    const scopes = screen.getAllByLabelText("Область правки");
    const descriptions = screen.getAllByLabelText("Описание правки");
    const assignees = screen.getAllByLabelText("Ответственный");
    expect(scopes).toHaveLength(2);
    await user.selectOptions(scopes[1], "titles");
    await user.type(descriptions[1], "Поправить титры");
    await user.selectOptions(assignees[1], String(designer.id));
    await user.click(screen.getByRole("button", { name: "Удалить часть 1" }));
    expect(screen.getAllByLabelText("Область правки")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Создать пакет" }));

    expect(submit).toHaveBeenCalledWith({
      source: "internal",
      parts: [{ scope: "titles", description: "Поправить титры", assignee_user_id: designer.id }],
    });
  });

  it("uses server action scope for combined completion, return reason and close payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ack);
    vi.stubGlobal("fetch", fetchMock);
    const onMutate = async (mutation: () => Promise<unknown>) => { await mutation(); };
    const user = userEvent.setup();
    const view = render(
      <CorrectionPackageList
        model={corrections}
        loading={false}
        error=""
        mutationPending={false}
        onRetry={vi.fn()}
        onMutate={onMutate}
        onCreate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Правки выполнены — ролик готов" }));
    expect(fetchMock).toHaveBeenLastCalledWith(videoComplete.href, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ completion_action: "video_ready" }),
    }));
    await user.click(screen.getByRole("button", { name: "Вернуть часть в работу" }));
    await user.type(screen.getByLabelText("Причина возврата"), "  Остался скачок  ");
    await user.click(screen.getByRole("button", { name: "Вернуть в работу" }));
    expect(fetchMock).toHaveBeenLastCalledWith(returnText.href, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ reason: "Остался скачок" }),
    }));

    view.rerender(
      <CorrectionPackageList
        model={{
          ...corrections,
          items: [{
            ...corrections.items[0],
            all_parts_complete: true,
            awaiting_leadership_review: true,
            primary_action: closePackage,
            additional_actions: [],
          }],
        }}
        loading={false}
        error=""
        mutationPending={false}
        onRetry={vi.fn()}
        onMutate={onMutate}
        onCreate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Закрыть пакет правок" }));
    expect(fetchMock).toHaveBeenLastCalledWith(closePackage.href, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({}),
    }));
  });

  it("disables all package controls during the shared page mutation flight", () => {
    render(
      <CorrectionPackageList
        model={corrections}
        loading={false}
        error="Пакеты временно недоступны"
        mutationPending
        onRetry={vi.fn()}
        onMutate={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Создать пакет правок" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Правки выполнены — ролик готов" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Вернуть часть в работу" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Повторить загрузку пакетов" })).toBeDisabled();
  });

  it("renders a server-provided archived read-only package without inventing actions", () => {
    render(
      <CorrectionPackageList
        model={{
          ...corrections,
          create_action: null,
          assignee_options: [],
          items: corrections.items.map((item) => ({ ...item, primary_action: null, additional_actions: [] })),
        }}
        loading={false}
        error=""
        mutationPending={false}
        onRetry={vi.fn()}
        onMutate={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText("Заменить финальный план")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать пакет правок" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Правки выполнены — ролик готов" })).not.toBeInTheDocument();
  });
});

describe("StoryProductionPage correction integration", () => {
  it("shows a retryable correction error without replacing the production page", async () => {
    let correctionGets = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/v1/stories/101/production") return Promise.resolve(response(production));
      if (path === production.corrections.href) {
        correctionGets += 1;
        return correctionGets === 1
          ? Promise.reject(new Error("Пакеты временно недоступны"))
          : Promise.resolve(response(corrections));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    expect(await screen.findByRole("heading", { name: production.story.title })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Пакеты временно недоступны");
    await user.click(screen.getByRole("button", { name: "Повторить загрузку пакетов" }));
    expect(await screen.findByText("Заменить финальный план")).toBeInTheDocument();
    expect(correctionGets).toBe(2);
  });

  it("keeps a correction mutation single-flight and retries only GET after ack refresh failure", async () => {
    const command = createDeferred<Response>();
    let productionGets = 0;
    let correctionGets = 0;
    let completePosts = 0;
    const reviewed: CorrectionPackagesResponse = {
      ...corrections,
      items: [{
        ...corrections.items[0],
        parts: corrections.items[0].parts.map((part) => ({
          ...part,
          state: "done" as const,
          completed_by: part.completed_by ?? editor,
          completed_at: part.completed_at ?? "2026-07-22T10:10:00Z",
        })),
        all_parts_complete: true,
        awaiting_leadership_review: true,
        primary_action: closePackage,
        additional_actions: [],
      }],
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/v1/stories/101/production" && method === "GET") {
        productionGets += 1;
        return Promise.resolve(response(production));
      }
      if (path === production.corrections.href && method === "GET") {
        correctionGets += 1;
        if (correctionGets === 1) return Promise.resolve(response(corrections));
        if (correctionGets === 2) return Promise.reject(new Error("refresh down"));
        return Promise.resolve(response(reviewed));
      }
      if (path === videoComplete.href && method === "POST") {
        completePosts += 1;
        return command.promise;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    const complete = await screen.findByRole("button", { name: "Правки выполнены — ролик готов" });
    await user.click(complete);
    fireEvent.click(complete);
    expect(completePosts).toBe(1);
    expect(screen.getByRole("button", { name: "Создать пакет правок" })).toBeDisabled();
    command.resolve(ack);

    expect(await screen.findByRole("alert")).toHaveTextContent("Действие выполнено, но данные не обновились");
    await user.click(screen.getByRole("button", { name: "Повторить обновление" }));
    expect(await screen.findByText("Исполнители закончили — нужен просмотр руководства")).toBeInTheDocument();
    expect(completePosts).toBe(1);
    expect(productionGets).toBe(3);
    expect(correctionGets).toBe(3);
  });
});
