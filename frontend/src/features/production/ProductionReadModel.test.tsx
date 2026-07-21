import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import StoryProductionPage from "../../pages/StoryProductionPage";
import type { ProductionReadModel } from "./types";


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
const author = {
  id: 4,
  username: "lira",
  display_name: "Лира",
  position: "Корреспондент",
  function_codes: ["author"],
};

const action = (
  code: string,
  label: string,
  emphasis: "primary" | "normal" = "normal",
  form: null | "correction_package" = null,
) => ({
  code,
  label,
  method: "POST" as const,
  href: `/api/v1/stories/101/production/${code.split("_").join("/")}`,
  emphasis,
  confirmation: null,
  form,
});

const primary = {
  ...action("video_start", "Начать монтаж", "primary"),
  href: "/api/v1/stories/101/production/video/start",
};
const titleStart = {
  ...action("titles_start", "Начать титры"),
  href: "/api/v1/stories/101/production/titles/start",
};
const voiceoverReady = {
  ...action("voiceover_ready", "Озвучка готова"),
  href: "/api/v1/stories/101/production/voiceover/ready",
};

const model: ProductionReadModel = {
  story: {
    id: 101,
    title: "Синтетический производственный сюжет",
    priority: { code: "high", label: "Высокий" },
    rubric: { id: 7, name: "Тестовая рубрика" },
    author,
    situation: { code: "active", label: "В работе" },
    assignments: [
      { kind: "video_editor", user: editor },
      { kind: "designer", user: designer },
    ],
    created_at: "2026-07-20T09:00:00Z",
    aired_at: null,
    archived_at: null,
    primary_action: primary,
    additional_actions: [titleStart, voiceoverReady],
  },
  scenario_revision: 7,
  assignments: [
    { kind: "video_editor", user: editor },
    { kind: "designer", user: designer },
  ],
  assignee_options: [chief, editor, designer, author],
  can_manage_assignments: true,
  materials: [
    {
      id: 8,
      title: "Исходная съёмка",
      location: "smb://news/source.mov",
      added_by: author,
      added_at: "2026-07-20T09:15:00Z",
    },
  ],
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
    initial_gate_satisfied: true,
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
    { code: "voiceover", state: "pending", label: "Озвучка", summary: "Сервер: запись ещё не готова" },
    { code: "video", state: "available", label: "Монтаж", summary: "Сервер: можно начинать по черновику" },
    { code: "titles", state: "available", label: "Титры", summary: "Сервер: первоначальный допуск открыт" },
  ],
  primary_action: primary,
  additional_actions: [titleStart, voiceoverReady],
};

const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});

afterEach(() => vi.unstubAllGlobals());

describe("StoryProductionPage server read model", () => {
  it("renders exact server stages, assignments, material, voiceover and ordered actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(model)));

    render(<StoryProductionPage storyId={101} />);

    expect(await screen.findByRole("heading", { name: model.story.title })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Сценарий|Производство|История/ })).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Производство" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Сервер: запись ещё не готова")).toBeInTheDocument();
    expect(screen.getByText("Сервер: можно начинать по черновику")).toBeInTheDocument();
    expect(screen.getByText("Исходная съёмка")).toBeInTheDocument();
    expect(screen.getByText("smb://news/source.mov")).toBeInTheDocument();
    expect(screen.getByText(/Добавил: Лира/)).toBeInTheDocument();
    expect(screen.getByText("Не готова")).toBeInTheDocument();
    const actionRegion = screen.getByRole("region", { name: "Действия производства" });
    expect(within(actionRegion).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Начать монтаж", "Начать титры", "Озвучка готова",
    ]);
    expect(within(actionRegion).getByRole("button", { name: "Начать монтаж" })).toHaveClass("primary");
    expect(screen.queryByText(/редакция 7/i)).not.toBeInTheDocument();
  });

  it("posts revisions only for start commands, is single-flight and refetches production only", async () => {
    let resolveCommand!: (value: Response) => void;
    const commandPending = new Promise<Response>((resolve) => { resolveCommand = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(model))
      .mockImplementationOnce(() => commandPending)
      .mockResolvedValueOnce(response({ ...model, primary_action: voiceoverReady, additional_actions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    const start = await screen.findByRole("button", { name: "Начать монтаж" });
    await user.click(start);
    fireEvent.click(start);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, primary.href, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ revision: 7 }),
      credentials: "include",
    }));
    expect(screen.getByRole("button", { name: "Начать титры" })).toBeDisabled();
    resolveCommand(response({ ok: true, event_id: "10", changed_at: "2026-07-20T10:00:00Z", resource: null }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/stories/101/production", expect.anything());
    expect(fetchMock.mock.calls.flatMap((call) => [String(call[0])])).not.toContain("/api/v1/stories/101/scenario");
  });

  it("posts the same current revision for titles start without loading scenario rows", async () => {
    const titlesModel = { ...model, primary_action: { ...titleStart, emphasis: "primary" as const }, additional_actions: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(titlesModel))
      .mockResolvedValueOnce(response({ ok: true, event_id: "14", changed_at: "2026-07-20T10:00:00Z", resource: null }))
      .mockResolvedValueOnce(response({ ...titlesModel, primary_action: null }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    await user.click(await screen.findByRole("button", { name: "Начать титры" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(2, titleStart.href, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ revision: 7 }),
    }));
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes("/scenario"))).toBe(false);
  });

  it("shows a retryable initial error and keeps the rendered page during command errors", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Производство временно недоступно"))
      .mockResolvedValueOnce(response(model))
      .mockResolvedValueOnce(response({ error: { code: "VIDEO_BUSY", message: "Монтаж уже меняется", details: {} } }, 409))
      .mockResolvedValueOnce(response({ ok: true, event_id: "11", changed_at: "2026-07-20T10:00:00Z", resource: null }))
      .mockResolvedValueOnce(response(model));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Производство временно недоступно");
    await user.click(screen.getByRole("button", { name: "Повторить загрузку" }));
    expect(await screen.findByRole("heading", { name: model.story.title })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Начать монтаж" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Монтаж уже меняется");
    expect(screen.getByRole("heading", { name: model.story.title })).toBeInTheDocument();
    expect(screen.getByText("Исходная съёмка")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Начать монтаж" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adds a normalized material without page reload and refreshes only production", async () => {
    const refreshed = {
      ...model,
      materials: [...model.materials, { id: 9, title: "Карта", location: "https://example.invalid/map", added_by: chief, added_at: "2026-07-20T10:00:00Z" }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(model))
      .mockResolvedValueOnce(response({ ok: true, event_id: "12", changed_at: "2026-07-20T10:00:00Z", resource: { type: "story_material", id: 9 } }))
      .mockResolvedValueOnce(response(refreshed));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    await screen.findByRole("heading", { name: model.story.title });
    await user.type(screen.getByLabelText("Название материала"), "Карта");
    await user.type(screen.getByLabelText("Путь или ссылка"), "https://example.invalid/map");
    await user.click(screen.getByRole("button", { name: "Добавить материал" }));

    await waitFor(() => expect(screen.getByText("Карта")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/stories/101/materials", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ title: "Карта", location: "https://example.invalid/map" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/stories/101/production", expect.anything());
  });

  it("submits the compact voiceover correction form with an assignee option", async () => {
    const notReadyAction = {
      ...action("voiceover_not_ready", "Вернуть озвучку в работу", "primary", "correction_package"),
      href: "/api/v1/stories/101/production/voiceover/not-ready",
    };
    const readyModel: ProductionReadModel = {
      ...model,
      voiceover: { ready: true, ready_by: author, ready_at: "2026-07-20T09:40:00Z" },
      primary_action: notReadyAction,
      additional_actions: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(readyModel))
      .mockResolvedValueOnce(response({ ok: true, event_id: "13", changed_at: "2026-07-20T10:00:00Z", resource: null }))
      .mockResolvedValueOnce(response({ ...model, primary_action: voiceoverReady, additional_actions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    expect(await screen.findByText("Готова")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Озвучка" })).getByText(/Лира/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Вернуть озвучку в работу" }));
    await user.type(screen.getByLabelText("Что исправить в озвучке"), "Перезаписать финальную фразу");
    await user.selectOptions(screen.getByLabelText("Ответственный за правку"), String(editor.id));
    await user.click(screen.getByRole("button", { name: "Создать правку и вернуть" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(2, notReadyAction.href, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ description: "Перезаписать финальную фразу", assignee_user_id: editor.id }),
    }));
    expect(await screen.findByText("Не готова")).toBeInTheDocument();
  });
});
