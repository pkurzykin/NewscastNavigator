import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import StoriesPage from "../../pages/StoriesPage";


const author = {
  id: 3,
  username: "lira",
  display_name: "Лира",
  position: "Корреспондент",
  function_codes: ["author"],
};
const nextAuthor = {
  id: 4,
  username: "mayak",
  display_name: "Маяк",
  position: "Корректор",
  function_codes: ["author", "proofreader"],
};
const managementAction = {
  code: "story_management_update",
  label: "Изменить автора или приоритет",
  method: "PATCH",
  href: "/api/v1/stories/101/management",
  emphasis: "normal",
  confirmation: null,
  form: null,
};
const rubricCreateAction = {
  code: "rubric_create",
  label: "Создать рубрику",
  method: "POST",
  href: "/api/v1/rubrics",
  emphasis: "normal",
  confirmation: null,
  form: null,
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ack(type: string, id: number): Response {
  return response({
    ok: true,
    event_id: type === "story" ? "event-1" : null,
    changed_at: "2026-07-30T09:00:00Z",
    resource: { type, id },
  });
}

describe("story and rubric management", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("changes the author and manages rubrics through canonical refetches", async () => {
    let currentAuthor = author;
    let nextRubricId = 9;
    let rubrics = [
      {
        id: 7,
        name: "Новости",
        is_active: true,
        update_action: {
          code: "rubric_update",
          label: "Изменить рубрику",
          method: "PATCH",
          href: "/api/v1/rubrics/7",
          emphasis: "normal",
          confirmation: null,
          form: null,
        },
      },
    ];
    let storyLoads = 0;
    let optionLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/me/actions") {
        return response({ items: [], total: 0 });
      }
      if (url.pathname === "/api/v1/stories/create-options") {
        optionLoads += 1;
        return response({
          rubrics: rubrics.filter((item) => item.is_active).map(({ id, name }) => ({ id, name })),
          authors: [author, nextAuthor],
          priority_options: [
            { code: "standard", label: "Стандарт" },
            { code: "high", label: "Высокий" },
          ],
          create_action: null,
          rubric_management: {
            items: rubrics,
            create_action: rubricCreateAction,
          },
        });
      }
      if (url.pathname === "/api/v1/stories" && (!init?.method || init.method === "GET")) {
        storyLoads += 1;
        return response({
          items: [{
            id: 101,
            title: "Синтетический сюжет",
            priority: { code: "standard", label: "Стандарт" },
            rubric: { id: 7, name: rubrics[0].name },
            author: currentAuthor,
            situation: { code: "active", label: "В работе" },
            assignments: [],
            created_at: "2026-07-30T08:00:00Z",
            updated_at: "2026-07-30T09:00:00Z",
            aired_at: null,
            archived_at: null,
            lifecycle_actions: [],
            management: {
              action: managementAction,
              author_options: [author, nextAuthor],
              priority_options: [
                { code: "standard", label: "Стандарт" },
                { code: "high", label: "Высокий" },
              ],
            },
          }],
          total: 1,
        });
      }
      if (url.pathname === managementAction.href && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({ author_user_id: nextAuthor.id });
        currentAuthor = nextAuthor;
        return ack("story", 101);
      }
      if (url.pathname === "/api/v1/rubrics" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        rubrics = [
          ...rubrics,
          {
            id: nextRubricId,
            name: body.name,
            is_active: true,
            update_action: {
              code: "rubric_update",
              label: "Изменить рубрику",
              method: "PATCH",
              href: `/api/v1/rubrics/${nextRubricId}`,
              emphasis: "normal",
              confirmation: null,
              form: null,
            },
          },
        ];
        return ack("rubric", nextRubricId++);
      }
      if (url.pathname === "/api/v1/rubrics/7" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        rubrics = rubrics.map((item) => item.id === 7 ? { ...item, ...body } : item);
        return ack("rubric", 7);
      }
      throw new Error(`Unexpected request: ${init?.method || "GET"} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<StoriesPage onOpenScenario={vi.fn()} />);

    const authorSelect = await screen.findByRole("combobox", {
      name: "Автор сюжета Синтетический сюжет",
    });
    await user.selectOptions(authorSelect, String(nextAuthor.id));
    await waitFor(() => expect(screen.getByRole("combobox", {
      name: "Автор сюжета Синтетический сюжет",
    })).toHaveValue(String(nextAuthor.id)));
    expect(storyLoads).toBe(2);

    await user.click(screen.getByRole("button", { name: "Рубрики" }));
    const dialog = screen.getByRole("dialog", { name: "Управление рубриками" });
    await user.type(within(dialog).getByLabelText("Название новой рубрики"), "Новая рубрика");
    await user.click(within(dialog).getByRole("button", { name: "Создать рубрику" }));
    expect(await within(dialog).findByDisplayValue("Новая рубрика")).toBeInTheDocument();

    const rubricName = within(dialog).getByRole("textbox", { name: "Название рубрики Новости" });
    await user.clear(rubricName);
    await user.type(rubricName, "Главные новости");
    await user.click(within(dialog).getByRole("button", { name: "Сохранить рубрику Новости" }));
    expect(await within(dialog).findByDisplayValue("Главные новости")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Отключить рубрику Главные новости" }));
    expect(await within(dialog).findByText("Отключена")).toBeInTheDocument();
    expect(optionLoads).toBe(4);
    expect(storyLoads).toBe(5);
  });

  it("keeps author and rubric management static for an ordinary user", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/me/actions") return response({ items: [], total: 0 });
      if (url.pathname === "/api/v1/stories/create-options") {
        return response({
          rubrics: [{ id: 7, name: "Новости" }],
          authors: [author],
          priority_options: [{ code: "standard", label: "Стандарт" }],
          create_action: null,
          rubric_management: null,
        });
      }
      if (url.pathname === "/api/v1/stories") {
        return response({
          items: [{
            id: 101,
            title: "Обычный сюжет",
            priority: { code: "standard", label: "Стандарт" },
            rubric: { id: 7, name: "Новости" },
            author,
            situation: { code: "active", label: "В работе" },
            assignments: [],
            created_at: "2026-07-30T08:00:00Z",
            updated_at: "2026-07-30T09:00:00Z",
            aired_at: null,
            archived_at: null,
            lifecycle_actions: [],
            management: null,
          }],
          total: 1,
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }));

    render(<StoriesPage onOpenScenario={vi.fn()} />);

    expect(await screen.findByText("Лира")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Автор сюжета/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Рубрики" })).not.toBeInTheDocument();
  });
});
