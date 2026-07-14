import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import StoryHistoryPage from "../../pages/StoryHistoryPage";
import HistoryTimeline from "./components/HistoryTimeline";
import type { EditSessionHistoryItem, StoryHistoryResponse } from "./types";


const author = { id: 1, username: "lira", display_name: "Лира", position: "Корреспондент", function_codes: ["author"] };
const chief = { id: 2, username: "astra", display_name: "Астра", position: "Начальник", function_codes: ["chief"] };
const story = {
  id: 101,
  title: "Синтетическая история",
  priority: { code: "standard", label: "Обычный" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: "2026-07-12T09:00:00Z",
  archived_at: null,
};

const restoreAction = {
  code: "restore_scenario_session",
  label: "Восстановить",
  method: "POST" as const,
  href: "/api/v1/stories/101/history/edit-sessions/7/restore",
  emphasis: "danger" as const,
  confirmation: "Восстановление создаст новую актуальную редакцию. Последующая история сохранится.",
  form: null,
};

const firstSession: EditSessionHistoryItem = {
  kind: "edit_session",
  id: 7,
  actor: author,
  started_at: "2026-07-12T10:00:00Z",
  ended_at: "2026-07-12T10:05:00Z",
  from_revision: 0,
  to_revision: 3,
  diff_summary: { added: 1, removed: 0, changed: 1, moved: 1, total: 2 },
  diff_href: "/api/v1/stories/101/history/edit-sessions/7",
  available_actions: [restoreAction],
};

const restoredSession: EditSessionHistoryItem = {
  ...firstSession,
  id: 8,
  actor: chief,
  started_at: "2026-07-12T11:00:00Z",
  ended_at: "2026-07-12T11:00:00Z",
  from_revision: 5,
  to_revision: 6,
  diff_summary: { added: 0, removed: 1, changed: 1, moved: 0, total: 2 },
  diff_href: "/api/v1/stories/101/history/edit-sessions/8",
  available_actions: [{ ...restoreAction, href: "/api/v1/stories/101/history/edit-sessions/8/restore" }],
};

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("history timeline", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads one grouped session, shows semantic diff and restores append-only after confirmation", async () => {
    let historyLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/v1/stories/101/history" && (!init?.method || init.method === "GET")) {
        historyLoads += 1;
        const payload: StoryHistoryResponse = {
          story,
          items: historyLoads === 1 ? [firstSession] : [restoredSession, firstSession],
          next_cursor: null,
        };
        return response(payload);
      }
      if (path === firstSession.diff_href && (!init?.method || init.method === "GET")) {
        return response({
          story,
          session: firstSession,
          changes: [
            {
              segment_uid: "seg_1",
              kind: "changed",
              moved: true,
              changed_fields: ["text"],
              before: { order_index: 1, block_type: "zk", text: "Исходный текст" },
              after: { order_index: 2, block_type: "zk", text: "Итоговая правка" },
            },
            {
              segment_uid: "seg_2",
              kind: "added",
              moved: false,
              changed_fields: [],
              before: null,
              after: { order_index: 1, block_type: "snh", text: "Добавленный блок" },
            },
          ],
        });
      }
      if (path === restoreAction.href && init?.method === "POST") {
        return response({ ok: true, event_id: null, changed_at: "2026-07-12T11:00:00Z", resource: { type: "scenario", id: 3 } });
      }
      throw new Error(`Unexpected request: ${init?.method || "GET"} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<StoryHistoryPage storyId={101} />);

    expect(await screen.findByRole("heading", { name: story.title })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Лира")).toBeInTheDocument();
    expect(screen.getByText(/Добавлено: 1/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Показать изменения" }));
    expect(await screen.findByText("Итоговая правка")).toBeInTheDocument();
    expect(screen.getByText("Добавленный блок")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Восстановить" }));
    const dialog = screen.getByRole("dialog", { name: "Восстановить состояние сценария" });
    const confirm = within(dialog).getByRole("button", { name: "Создать новую актуальную редакцию" });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Восстановить" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Восстановить" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Отмена" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Создать новую актуальную редакцию" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Создать новую актуальную редакцию" }));

    await waitFor(() => expect(historyLoads).toBe(2));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("Астра")).toBeInTheDocument();
    expect(screen.getByText("Лира")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      restoreAction.href,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not derive restore rights on the client", () => {
    render(
      <HistoryTimeline
        items={[{ ...firstSession, available_actions: [] }]}
        nextCursor={null}
        loadingMore={false}
        onLoadMore={() => undefined}
        onShowDiff={() => undefined}
        onRestore={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "Показать изменения" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Восстановить" })).not.toBeInTheDocument();
  });
});
