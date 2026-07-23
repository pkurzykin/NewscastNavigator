import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ArchivePage from "../../pages/ArchivePage";
import StoriesPage from "../../pages/StoriesPage";
import ScenarioEditor from "../scenario/components/ScenarioEditor";
import { createDeferred } from "../../test/deferred";


const author = {
  id: 4,
  username: "lira",
  display_name: "Лира",
  position: "Корреспондент",
  function_codes: ["author"],
};
const chiefAuthor = {
  id: 5,
  username: "iskra",
  display_name: "Искра",
  position: "Шеф-редактор",
  function_codes: ["author", "chief_editor"],
};
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});
const story = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  title: "Синтетический сюжет",
  priority: { code: "standard", label: "Стандарт" },
  rubric: { id: 7, name: "Новости" },
  author,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: "2026-07-23T10:00:00Z",
  aired_at: null,
  archived_at: null,
  lifecycle_actions: [],
  ...overrides,
});
const emptyActions = { items: [], total: 0 };


afterEach(() => vi.unstubAllGlobals());


describe("story completion UI", () => {
  it("creates through server options, retains values/focus on error and opens the scenario on success", async () => {
    let createAttempt = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/me/actions?limit=20") {
        return Promise.resolve(response(emptyActions));
      }
      if (path.startsWith("/api/v1/stories?")) {
        return Promise.resolve(response({ items: [], total: 0 }));
      }
      if (path === "/api/v1/stories/create-options") {
        return Promise.resolve(response({
          rubrics: [{ id: 7, name: "Новости" }],
          authors: [author, chiefAuthor],
          create_action: {
            code: "story_create",
            label: "Создать сюжет",
            method: "POST",
            href: "/api/v1/stories",
            emphasis: "primary",
            confirmation: null,
            form: "story_create",
          },
        }));
      }
      if (path === "/api/v1/stories" && init?.method === "POST") {
        createAttempt += 1;
        return Promise.resolve(
          createAttempt === 1
            ? response({ error: { code: "RUBRIC_INACTIVE", message: "Рубрика недоступна" } }, 409)
            : response({
              ok: true,
              event_id: "90",
              changed_at: "2026-07-23T10:00:00Z",
              resource: { type: "story", id: 909 },
            }),
        );
      }
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onOpenScenario = vi.fn();
    const user = userEvent.setup();

    render(<StoriesPage onOpenScenario={onOpenScenario} />);

    const trigger = await screen.findByRole("button", { name: "Создать сюжет" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Новый сюжет" });
    expect(within(dialog).getByLabelText("Название")).toHaveFocus();
    await user.type(within(dialog).getByLabelText("Название"), "Синтетический новый сюжет");
    await user.selectOptions(within(dialog).getByLabelText("Рубрика"), "7");
    await user.selectOptions(within(dialog).getByLabelText("Автор"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Создать" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Рубрика недоступна");
    expect(within(dialog).getByLabelText("Название")).toHaveValue("Синтетический новый сюжет");
    expect(within(dialog).getByLabelText("Автор")).toHaveValue("5");
    expect(within(dialog).getByLabelText("Название")).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Создать" }));
    await waitFor(() => expect(onOpenScenario).toHaveBeenCalledWith(909));
    const createCalls = fetchMock.mock.calls.filter(([path]) => String(path) === "/api/v1/stories");
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0][1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        title: "Синтетический новый сюжет",
        rubric_id: 7,
        author_user_id: 5,
      }),
    }));
  });

  it("submits the selected server-scoped author even when it is the only eligible option", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/me/actions?limit=20") return Promise.resolve(response(emptyActions));
      if (path.startsWith("/api/v1/stories?")) return Promise.resolve(response({ items: [], total: 0 }));
      if (path === "/api/v1/stories/create-options") {
        return Promise.resolve(response({
          rubrics: [{ id: 7, name: "Новости" }],
          authors: [author],
          create_action: {
            code: "story_create",
            label: "Создать сюжет",
            method: "POST",
            href: "/api/v1/stories",
            emphasis: "primary",
            confirmation: null,
            form: "story_create",
          },
        }));
      }
      if (path === "/api/v1/stories" && init?.method === "POST") {
        return Promise.resolve(response({
          ok: true,
          event_id: "single-author-create",
          changed_at: "2026-07-23T10:00:00Z",
          resource: { type: "story", id: 910 },
        }));
      }
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onOpenScenario = vi.fn();
    const user = userEvent.setup();
    render(<StoriesPage onOpenScenario={onOpenScenario} />);

    await user.click(await screen.findByRole("button", { name: "Создать сюжет" }));
    const authorSelect = screen.getByLabelText("Автор");
    expect(authorSelect).toBeDisabled();
    expect(within(authorSelect).getAllByRole("option")).toHaveLength(1);
    expect(within(authorSelect).getByRole("option", { name: "Лира · Корреспондент" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Название"), "Сюжет единственного чужого автора");
    await user.click(screen.getByRole("button", { name: "Создать" }));

    await waitFor(() => expect(onOpenScenario).toHaveBeenCalledWith(910));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/stories", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        title: "Сюжет единственного чужого автора",
        rubric_id: 7,
        author_user_id: author.id,
      }),
    }));
  });

  it("ignores a stale list response after a newer query has rendered", async () => {
    const stale = createDeferred<Response>();
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/v1/me/actions?limit=20") return Promise.resolve(response(emptyActions));
      if (path === "/api/v1/stories/create-options") {
        return Promise.resolve(response({ rubrics: [], authors: [], create_action: null }));
      }
      if (path.startsWith("/api/v1/stories?")) {
        listCalls += 1;
        return listCalls === 1
          ? stale.promise
          : Promise.resolve(response({ items: [story({ id: 202, title: "Свежий список" })], total: 1 }));
      }
      throw new Error(`unexpected ${path}`);
    }));
    const user = userEvent.setup();
    render(<StoriesPage onOpenScenario={vi.fn()} />);

    await user.type(screen.getByLabelText("Поиск"), "свежий");
    expect(await screen.findByText("Свежий список")).toBeInTheDocument();
    await act(async () => {
      stale.resolve(response({ items: [story({ id: 303, title: "Устаревший список" })], total: 1 }));
    });
    expect(screen.queryByText("Устаревший список")).not.toBeInTheDocument();
    expect(screen.getByText("Свежий список")).toBeInTheDocument();
  });

  it("keeps an archived row on restore error, retries, then refetches it away", async () => {
    let restoreAttempts = 0;
    let archiveLoads = 0;
    const archivedStory = story({
      archived_at: "2026-07-23T11:00:00Z",
      aired_at: "2026-07-23T10:30:00Z",
      situation: { code: "archive", label: "В архиве" },
      lifecycle_actions: [{
        code: "story_restore",
        label: "Вернуть в работу",
        method: "POST",
        href: "/api/v1/stories/101/restore",
        emphasis: "primary",
        confirmation: null,
        form: null,
      }],
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/v1/stories?")) {
        archiveLoads += 1;
        return Promise.resolve(response({
          items: archiveLoads === 1 ? [archivedStory] : [],
          total: archiveLoads === 1 ? 1 : 0,
        }));
      }
      if (path === "/api/v1/stories/101/restore" && init?.method === "POST") {
        restoreAttempts += 1;
        return Promise.resolve(
          restoreAttempts === 1
            ? response({ error: { code: "LOCKED", message: "Повторите восстановление" } }, 409)
            : response({ ok: true, event_id: "91", changed_at: "2026-07-23T12:00:00Z", resource: { type: "story", id: 101 } }),
        );
      }
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ArchivePage onOpenScenario={vi.fn()} />);

    const restore = await screen.findByRole("button", { name: "Вернуть в работу: Синтетический сюжет" });
    await user.click(restore);
    expect(await screen.findByRole("alert")).toHaveTextContent("Повторите восстановление");
    expect(screen.getByText("Синтетический сюжет")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Вернуть в работу: Синтетический сюжет" }));
    await waitFor(() => expect(screen.queryByText("Синтетический сюжет")).not.toBeInTheDocument());
    expect(archiveLoads).toBe(2);
  });

  it("renders archived scenario read-only without lease, save or mutation affordances", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/stories/101/scenario") {
        return Promise.resolve(response({
          story: story({
            archived_at: "2026-07-23T11:00:00Z",
            situation: { code: "archive", label: "В архиве" },
          }),
          scenario: {
            revision: 3,
            rows: [{
              segment_uid: "seg_00000000-0000-4000-8000-000000000001",
              order_index: 1,
              block_type: "zk",
              text: "Архивный текст",
              speaker_text: "",
              file_name: "",
              tc_in: "",
              tc_out: "",
              additional_comment: "",
              structured_data: {},
              formatting: {},
              rich_text: { schema_version: 1 },
            }],
          },
          edit: { state: "archived", edit_session_id: null, holder: null, expires_at: null },
          captionpanels: {
            eligible: false,
            last_opened_revision: null,
            changed_since_last_open: false,
            diff_session_id: null,
          },
        }));
      }
      if (path === "/api/v1/stories/101/workflow") {
        return Promise.resolve(response({
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
      throw new Error(`unexpected ${path} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={4} />);

    expect(await screen.findByText("Архивный текст")).toBeInTheDocument();
    expect(screen.getByText(/Архивный сценарий доступен только для чтения/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить блок" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
});
