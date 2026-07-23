import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import StoryProductionPage from "../../pages/StoryProductionPage";
import { createDeferred } from "../../test/deferred";
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
const secondEditor = {
  id: 5,
  username: "vega",
  display_name: "Вега",
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
  corrections: {
    href: "/api/v1/stories/101/correction-packages",
    total_count: 0,
    open_count: 0,
    awaiting_leadership_review_count: 0,
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

interface FetchDouble {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

const stubFetchWithCorrections = (fallback: FetchDouble) => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const match = String(input).match(/^\/api\/v1\/stories\/(\d+)\/correction-packages$/);
    if (match && (init?.method ?? "GET") === "GET") {
      return Promise.resolve(response({
        story_id: Number(match[1]),
        items: [],
        assignee_options: [chief, editor, designer, author],
        create_action: null,
      }));
    }
    return fallback(input, init);
  }));
};

afterEach(() => vi.unstubAllGlobals());

describe("StoryProductionPage server read model", () => {
  it("renders exact server stages, assignments, material, voiceover and ordered actions", async () => {
    stubFetchWithCorrections(vi.fn().mockResolvedValue(response(model)));

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

  it("runs only server-provided aired, archive and restore actions while aired controls stay enabled", async () => {
    const markAired = {
      ...action("story_mark_aired", "Сдано / вышло в эфир", "primary"),
      href: "/api/v1/stories/101/production/mark-aired",
    };
    const archive = {
      ...action("story_archive", "В архив", "primary"),
      href: "/api/v1/stories/101/archive",
    };
    const restore = {
      ...action("story_restore", "Вернуть в работу", "primary"),
      href: "/api/v1/stories/101/restore",
    };
    const readyForAir: ProductionReadModel = {
      ...model,
      primary_action: markAired,
      additional_actions: [],
    };
    const aired: ProductionReadModel = {
      ...model,
      story: {
        ...model.story,
        situation: { code: "aired", label: "Вышел в эфир" },
        aired_at: "2026-07-23T10:30:00Z",
        primary_action: archive,
        additional_actions: [primary],
      },
      aired: { by: chief, at: "2026-07-23T10:30:00Z" },
      primary_action: archive,
      additional_actions: [primary],
    };
    const archived: ProductionReadModel = {
      ...aired,
      story: {
        ...aired.story,
        situation: { code: "archive", label: "В архиве" },
        archived_at: "2026-07-23T10:40:00Z",
        primary_action: restore,
        additional_actions: [],
      },
      can_manage_assignments: false,
      assignee_options: [],
      primary_action: restore,
      additional_actions: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(readyForAir))
      .mockResolvedValueOnce(response({ ok: true, event_id: "20", changed_at: "2026-07-23T10:30:00Z", resource: { type: "story", id: 101 } }))
      .mockResolvedValueOnce(response(aired))
      .mockResolvedValueOnce(response({ ok: true, event_id: "21", changed_at: "2026-07-23T10:40:00Z", resource: { type: "story", id: 101 } }))
      .mockResolvedValueOnce(response(archived))
      .mockResolvedValueOnce(response({ ok: true, event_id: "22", changed_at: "2026-07-23T10:50:00Z", resource: { type: "story", id: 101 } }))
      .mockResolvedValueOnce(response(aired));
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    await user.click(await screen.findByRole("button", { name: "Сдано / вышло в эфир" }));
    expect(await screen.findByRole("button", { name: "В архив" })).toBeInTheDocument();
    expect(screen.getByLabelText("Название материала")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Начать монтаж" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "В архив" }));
    await user.click(await screen.findByRole("button", { name: "Вернуть в работу" }));
    expect(await screen.findByRole("button", { name: "В архив" })).toBeInTheDocument();

    expect(fetchMock).toHaveBeenNthCalledWith(2, markAired.href, expect.objectContaining({
      method: "POST",
      body: "{}",
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, archive.href, expect.objectContaining({
      method: "POST",
      body: "{}",
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, restore.href, expect.objectContaining({
      method: "POST",
      body: "{}",
    }));
  });

  it("posts revisions only for start commands, is single-flight and refetches both read models", async () => {
    let resolveCommand!: (value: Response) => void;
    const commandPending = new Promise<Response>((resolve) => { resolveCommand = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(model))
      .mockImplementationOnce(() => commandPending)
      .mockResolvedValueOnce(response({ ...model, primary_action: voiceoverReady, additional_actions: [] }));
    stubFetchWithCorrections(fetchMock);
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
    expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path) === model.corrections.href)).toBe(true);
    expect(fetchMock.mock.calls.flatMap((call) => [String(call[0])])).not.toContain("/api/v1/stories/101/scenario");
  });

  it("posts the same current revision for titles start without loading scenario rows", async () => {
    const titlesModel = { ...model, primary_action: { ...titleStart, emphasis: "primary" as const }, additional_actions: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(titlesModel))
      .mockResolvedValueOnce(response({ ok: true, event_id: "14", changed_at: "2026-07-20T10:00:00Z", resource: null }))
      .mockResolvedValueOnce(response({ ...titlesModel, primary_action: null }));
    stubFetchWithCorrections(fetchMock);
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
    stubFetchWithCorrections(fetchMock);
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

  it("adds a normalized material without page reload and refreshes both read models", async () => {
    const refreshed = {
      ...model,
      materials: [...model.materials, { id: 9, title: "Карта", location: "https://example.invalid/map", added_by: chief, added_at: "2026-07-20T10:00:00Z" }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(model))
      .mockResolvedValueOnce(response({ ok: true, event_id: "12", changed_at: "2026-07-20T10:00:00Z", resource: { type: "story_material", id: 9 } }))
      .mockResolvedValueOnce(response(refreshed));
    stubFetchWithCorrections(fetchMock);
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
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => String(path) === model.corrections.href)).toHaveLength(2);
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
    stubFetchWithCorrections(fetchMock);
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

  it("keeps both unseen track contexts on the Scenario link without marking them from production", async () => {
    const unseenModel: ProductionReadModel = {
      ...model,
      video: { ...model.video, has_unseen_scenario_changes: true },
      titles: { ...model.titles, has_unseen_scenario_changes: true },
    };
    const fetchMock = vi.fn().mockResolvedValue(response(unseenModel));
    stubFetchWithCorrections(fetchMock);

    render(<StoryProductionPage storyId={101} />);

    expect(await screen.findByRole("link", { name: "Сценарий" })).toHaveAttribute(
      "href",
      "/stories/101/scenario?production_context=video&production_context=titles",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes("/scenario/opened"))).toBe(false);
  });

  it("does not let an older production GET replace the newest story", async () => {
    const stale = createDeferred<Response>();
    const newest: ProductionReadModel = {
      ...model,
      story: { ...model.story, id: 202, title: "Свежий сюжет" },
      corrections: { ...model.corrections, href: "/api/v1/stories/202/correction-packages" },
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/v1/stories/101/production") return stale.promise;
      if (String(input) === "/api/v1/stories/202/production") return Promise.resolve(response(newest));
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    stubFetchWithCorrections(fetchMock);

    const view = render(<StoryProductionPage storyId={101} />);
    view.rerender(<StoryProductionPage storyId={202} />);
    expect(await screen.findByRole("heading", { name: "Свежий сюжет" })).toBeInTheDocument();

    stale.resolve(response(model));
    await stale.promise;
    await waitFor(() => expect(screen.getByRole("heading", { name: "Свежий сюжет" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: model.story.title })).not.toBeInTheDocument();
  });

  it("does not let an acknowledged mutation from story A invalidate initial load and retry for story B", async () => {
    const commandA = createDeferred<Response>();
    const initialB = createDeferred<Response>();
    const requests: Array<{ path: string; method: string }> = [];
    let storyAGetCount = 0;
    let storyBGetCount = 0;
    const modelB: ProductionReadModel = {
      ...model,
      story: { ...model.story, id: 202, title: "Производственный сюжет B" },
      corrections: { ...model.corrections, href: "/api/v1/stories/202/correction-packages" },
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      requests.push({ path, method });
      if (path === "/api/v1/stories/101/production" && method === "GET") {
        storyAGetCount += 1;
        return storyAGetCount === 1
          ? Promise.resolve(response(model))
          : Promise.reject(new Error("stale story A refresh"));
      }
      if (path === primary.href && method === "POST") return commandA.promise;
      if (path === "/api/v1/stories/202/production" && method === "GET") {
        storyBGetCount += 1;
        return storyBGetCount === 1 ? initialB.promise : Promise.resolve(response(modelB));
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    const view = render(<StoryProductionPage storyId={101} />);

    await user.click(await screen.findByRole("button", { name: "Начать монтаж" }));
    await waitFor(() => expect(requests).toContainEqual({ path: primary.href, method: "POST" }));
    view.rerender(<StoryProductionPage storyId={202} />);
    await waitFor(() => expect(storyBGetCount).toBe(1));
    await act(async () => {
      commandA.resolve(response({ ok: true, event_id: "18", changed_at: "2026-07-20T10:00:00Z", resource: null }));
      await commandA.promise;
      await Promise.resolve();
      initialB.reject(new Error("Загрузка B временно недоступна"));
      await initialB.promise.catch(() => undefined);
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Загрузка B временно недоступна");
    expect(screen.getByRole("button", { name: "Повторить загрузку" })).toBeInTheDocument();
    expect(storyAGetCount).toBe(1);
    await user.click(screen.getByRole("button", { name: "Повторить загрузку" }));

    expect(await screen.findByRole("heading", { name: modelB.story.title })).toBeInTheDocument();
    expect(storyBGetCount).toBe(2);
    expect(storyAGetCount).toBe(1);
  });

  it("does not start a post-ack refresh after unmount in StrictMode", async () => {
    const command = createDeferred<Response>();
    let productionGets = 0;
    let productionPosts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      if (path === "/api/v1/stories/101/production" && method === "GET") {
        productionGets += 1;
        return Promise.resolve(response(model));
      }
      if (path === primary.href && method === "POST") {
        productionPosts += 1;
        return command.promise;
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    const view = render(<StrictMode><StoryProductionPage storyId={101} /></StrictMode>);

    await user.click(await screen.findByRole("button", { name: "Начать монтаж" }));
    await waitFor(() => expect(productionPosts).toBe(1));
    const getsBeforeUnmount = productionGets;
    view.unmount();
    await act(async () => {
      command.resolve(response({ ok: true, event_id: "19", changed_at: "2026-07-20T10:00:00Z", resource: null }));
      await command.promise;
      await Promise.resolve();
    });

    expect(productionGets).toBe(getsBeforeUnmount);
  });

  it("reports an acknowledged material with failed refresh and retries GET without duplicating POST", async () => {
    const refreshed: ProductionReadModel = {
      ...model,
      materials: [...model.materials, {
        id: 9,
        title: "Карта",
        location: "https://example.invalid/map",
        added_by: chief,
        added_at: "2026-07-20T10:00:00Z",
      }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(model))
      .mockResolvedValueOnce(response({ ok: true, event_id: "12", changed_at: "2026-07-20T10:00:00Z", resource: { type: "story_material", id: 9 } }))
      .mockRejectedValueOnce(new Error("refresh down"))
      .mockResolvedValueOnce(response(refreshed));
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    await screen.findByRole("heading", { name: model.story.title });
    await user.type(screen.getByLabelText("Название материала"), "Карта");
    await user.type(screen.getByLabelText("Путь или ссылка"), "https://example.invalid/map");
    await user.click(screen.getByRole("button", { name: "Добавить материал" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Действие выполнено, но данные не обновились");
    await user.click(screen.getByRole("button", { name: "Повторить обновление" }));
    expect(await screen.findByText("Карта", { exact: true })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path, init]) => String(path).endsWith("/materials") && init?.method === "POST")).toHaveLength(1);
  });

  it("reports an acknowledged action with failed refresh and retries GET only", async () => {
    const refreshed: ProductionReadModel = { ...model, primary_action: voiceoverReady, additional_actions: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(model))
      .mockResolvedValueOnce(response({ ok: true, event_id: "13", changed_at: "2026-07-20T10:00:00Z", resource: null }))
      .mockRejectedValueOnce(new Error("refresh down"))
      .mockResolvedValueOnce(response(refreshed));
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    await user.click(await screen.findByRole("button", { name: "Начать монтаж" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Действие выполнено, но данные не обновились");
    await user.click(screen.getByRole("button", { name: "Повторить обновление" }));
    await screen.findByRole("button", { name: "Озвучка готова" });
    expect(fetchMock.mock.calls.filter(([path, init]) => String(path) === primary.href && init?.method === "POST")).toHaveLength(1);
  });

  it("reports an acknowledged assignment with failed refresh and retries GET only", async () => {
    const assignableModel: ProductionReadModel = {
      ...model,
      assignee_options: [...model.assignee_options, secondEditor],
    };
    const refreshed: ProductionReadModel = {
      ...assignableModel,
      assignments: assignableModel.assignments.map((assignment) => assignment.kind === "video_editor"
        ? { ...assignment, user: secondEditor }
        : assignment),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(assignableModel))
      .mockResolvedValueOnce(response({ ok: true, event_id: "14", changed_at: "2026-07-20T10:00:00Z", resource: null }))
      .mockRejectedValueOnce(new Error("refresh down"))
      .mockResolvedValueOnce(response(refreshed));
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    const select = await screen.findByRole("combobox", { name: "Ответственный: Монтажёр" });
    await user.selectOptions(select, String(secondEditor.id));
    const assignment = select.closest(".production-assignment");
    expect(assignment).not.toBeNull();
    await user.click(within(assignment as HTMLElement).getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Действие выполнено, но данные не обновились");
    await user.click(screen.getByRole("button", { name: "Повторить обновление" }));
    await waitFor(() => expect(select).toHaveValue(String(secondEditor.id)));
    expect(fetchMock.mock.calls.filter(([path, init]) => String(path).includes("/assignments/video_editor") && init?.method === "PUT")).toHaveLength(1);
  });

  it("uses one page-level mutation flight across action, material and assignment controls", async () => {
    const command = createDeferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ...model, assignee_options: [...model.assignee_options, secondEditor] }))
      .mockImplementationOnce(() => command.promise)
      .mockResolvedValue(response(model));
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    await user.click(await screen.findByRole("button", { name: "Начать монтаж" }));
    expect(screen.getByRole("button", { name: "Добавить материал" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Ответственный: Монтажёр" })).toBeDisabled();
    command.resolve(response({ ok: true, event_id: "15", changed_at: "2026-07-20T10:00:00Z", resource: null }));
    await command.promise;
  });

  it("preserves a dirty assignment draft across an unrelated production refresh", async () => {
    const assignableModel: ProductionReadModel = {
      ...model,
      assignee_options: [...model.assignee_options, secondEditor],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(assignableModel))
      .mockResolvedValueOnce(response({ ok: true, event_id: "16", changed_at: "2026-07-20T10:00:00Z", resource: null }))
      .mockResolvedValueOnce(response({ ...assignableModel, voiceover: { ready: true, ready_by: chief, ready_at: "2026-07-20T10:00:00Z" } }));
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    const select = await screen.findByRole("combobox", { name: "Ответственный: Монтажёр" });
    await user.selectOptions(select, String(secondEditor.id));
    await user.click(screen.getByRole("button", { name: "Озвучка готова" }));

    await waitFor(() => expect(select).toHaveValue(String(secondEditor.id)));
  });

  it("syncs a clean assignment draft when that server assignment actually changes", async () => {
    const assignableModel: ProductionReadModel = {
      ...model,
      assignee_options: [...model.assignee_options, secondEditor],
    };
    const changed: ProductionReadModel = {
      ...assignableModel,
      assignments: assignableModel.assignments.map((assignment) => assignment.kind === "video_editor"
        ? { ...assignment, user: secondEditor }
        : assignment),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(assignableModel))
      .mockResolvedValueOnce(response({ ok: true, event_id: "17", changed_at: "2026-07-20T10:00:00Z", resource: null }))
      .mockResolvedValueOnce(response(changed));
    stubFetchWithCorrections(fetchMock);
    const user = userEvent.setup();
    render(<StoryProductionPage storyId={101} />);

    const select = await screen.findByRole("combobox", { name: "Ответственный: Монтажёр" });
    expect(select).toHaveValue(String(editor.id));
    await user.click(screen.getByRole("button", { name: "Озвучка готова" }));

    await waitFor(() => expect(select).toHaveValue(String(secondEditor.id)));
  });

  it("compacts completed stages using only server-provided state codes", async () => {
    const completedModel: ProductionReadModel = {
      ...model,
      stages: [
        { code: "voiceover", state: "ready", label: "Озвучка", summary: "Произвольная серверная сводка A" },
        { code: "video", state: "approved", label: "Монтаж", summary: "Произвольная серверная сводка B" },
        { code: "titles", state: "in_progress", label: "Титры", summary: "Титры ещё идут" },
      ],
    };
    stubFetchWithCorrections(vi.fn().mockResolvedValue(response(completedModel)));

    render(<StoryProductionPage storyId={101} />);

    expect(await screen.findByText("Титры ещё идут")).toBeVisible();
    const completed = screen.getByText("Завершено: 2").closest("details");
    expect(completed).not.toBeNull();
    expect(completed).not.toHaveAttribute("open");
    expect(within(completed as HTMLElement).getByText("Произвольная серверная сводка A")).toBeInTheDocument();
    expect(within(completed as HTMLElement).getByText("Произвольная серверная сводка B")).toBeInTheDocument();
  });
});
