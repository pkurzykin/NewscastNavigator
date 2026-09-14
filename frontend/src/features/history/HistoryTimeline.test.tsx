import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import StoryHistoryPage, { mergeHistorySessions } from "../../pages/StoryHistoryPage";
import { createDeferred } from "../../test/deferred";
import HistoryTimeline from "./components/HistoryTimeline";
import ScenarioSessionDiff from "./components/ScenarioSessionDiff";
import type {
  EditSessionHistoryItem,
  ScenarioSessionDiffResponse,
  StoryHistoryResponse,
  WorkflowEventHistoryItem,
} from "./types";


const author = { id: 1, username: "lira", display_name: "Лира", position: "Корреспондент", function_codes: ["author"] };
const chief = { id: 2, username: "astra", display_name: "Астра", position: "Начальник", function_codes: ["chief"] };
const story = {
  id: 101,
  title: "Синтетическая история",
  duration_text: null,
  priority: { code: "standard", label: "Стандарт" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: "2026-07-12T09:00:00Z",
  updated_at: "2026-07-12T10:00:00Z",
  archived_at: null,
  management: null,
};

const restoreAction = {
  code: "restore_scenario_session",
  label: "Восстановить",
  method: "POST" as const,
  href: "/api/v1/stories/101/history/edit-sessions/7/restore",
  emphasis: "danger" as const,
  confirmation: "Выбранное состояние станет актуальным. Последующая история сохранится.",
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

const metadataEvent: WorkflowEventHistoryItem = {
  kind: "workflow_event",
  id: 33,
  event_code: "story_metadata_changed",
  label: "Изменены данные сюжета",
  summary: "Название: «До» → «После»; рубрика: «Новости» → «Репортаж»",
  actor: author,
  at: "2026-07-12T10:06:00Z",
  diff_href: null,
  available_actions: [],
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

const olderSession: EditSessionHistoryItem = {
  ...firstSession,
  id: 4,
  actor: chief,
  started_at: "2026-07-11T08:00:00Z",
  ended_at: "2026-07-11T08:05:00Z",
  from_revision: 8,
  to_revision: 9,
  diff_href: "/api/v1/stories/101/history/edit-sessions/4",
  available_actions: [],
};

const cursorSessionAboveTarget: EditSessionHistoryItem = {
  ...firstSession,
  id: 6,
  started_at: "2026-07-11T09:00:00Z",
  ended_at: "2026-07-11T09:05:00Z",
  from_revision: 6,
  to_revision: 7,
  diff_href: "/api/v1/stories/101/history/edit-sessions/6",
  available_actions: [],
};

const cursorSessionBelowTarget: EditSessionHistoryItem = {
  ...firstSession,
  id: 3,
  started_at: "2026-07-11T07:00:00Z",
  ended_at: "2026-07-11T07:05:00Z",
  from_revision: 3,
  to_revision: 4,
  diff_href: "/api/v1/stories/101/history/edit-sessions/3",
  available_actions: [],
};

function diffText(text: string) {
  return (_: string, element: Element | null) => element?.matches("p[data-side]") === true && element.textContent === text;
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

function errorResponse(message: string, status = 409): Response {
  return new Response(JSON.stringify({ error: { code: "HISTORY_TEST_ERROR", message, details: {} } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("history timeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("keeps notification-specific metadata when its edit-session id is already listed", () => {
    const ordinary = {
      ...firstSession,
      id: 19,
      from_revision: 2,
      to_revision: 7,
      diff_summary: { added: 9, removed: 8, changed: 7, moved: 6, total: 30 },
      diff_href: "/api/v1/stories/101/history/edit-sessions/19",
    } satisfies EditSessionHistoryItem;
    const notification = {
      ...ordinary,
      from_revision: 4,
      diff_summary: { added: 0, removed: 1, changed: 2, moved: 3, total: 6 },
      diff_href: "/api/v1/stories/101/history/notifications/77",
    } satisfies EditSessionHistoryItem;

    expect(mergeHistorySessions([ordinary], [notification])).toEqual([notification]);
    expect(mergeHistorySessions([notification], [ordinary])).toEqual([notification]);
  });

  it("renders semantic workflow events without internal codes or raw payload", () => {
    render(
      <HistoryTimeline
        items={[metadataEvent, firstSession]}
        nextCursor={null}
        loadingMore={false}
        onLoadMore={() => undefined}
        onShowDiff={() => undefined}
        onRestore={() => undefined}
      />
    );

    const events = screen.getAllByRole("article");
    expect(within(events[0]).getByRole("heading", { name: "Изменены данные сюжета" })).toBeInTheDocument();
    expect(within(events[0]).getByText(metadataEvent.summary!)).toBeInTheDocument();
    expect(within(events[0]).getByText(/Лира · Корреспондент/)).toBeInTheDocument();
    expect(screen.queryByText("story_metadata_changed")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("payload");
    expect(within(events[1]).getByRole("button", { name: "Показать изменения" })).toBeInTheDocument();
  });

  it("opens a query-addressed session that is absent from the first history page", async () => {
    window.history.replaceState({}, "", "/stories/101/history?session=4");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/stories/101/history") {
        return response({
          story,
          items: url.searchParams.get("cursor")
            ? [cursorSessionAboveTarget, olderSession, cursorSessionBelowTarget]
            : [firstSession],
          next_cursor: url.searchParams.get("cursor") ? null : "older-page-cursor",
        } satisfies StoryHistoryResponse);
      }
      if (url.pathname === olderSession.diff_href) {
        return response({
          story,
          session: olderSession,
          changes: [{
            segment_uid: "seg_query_target",
            kind: "changed",
            moved: false,
            changed_fields: ["text"],
            before: { order_index: 1, block_type: "zk", text: "Старая адресная редакция" },
            after: { order_index: 1, block_type: "zk", text: "Нужная адресная редакция" },
          }],
        } satisfies ScenarioSessionDiffResponse);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StoryHistoryPage storyId={101} />);

    expect(await screen.findByText(diffText("Нужная адресная редакция"))).toBeInTheDocument();
    expect(screen.queryByText(/Редакции\s+\d+\s+→\s+\d+/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать более ранние изменения" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      olderSession.diff_href,
      expect.objectContaining({ credentials: "include" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Показать более ранние изменения" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Показать более ранние изменения" })).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.queryByText(/Редакции\s+\d+\s+→\s+\d+/i)).not.toBeInTheDocument();
  });

  it("opens the exact persisted notification comparison instead of the edit-session baseline", async () => {
    window.history.replaceState({}, "", "/stories/101/history?notification=77");
    const sessionBaseline = {
      ...firstSession,
      id: 19,
      from_revision: 2,
      to_revision: 7,
      diff_summary: { added: 9, removed: 8, changed: 7, moved: 6, total: 30 },
      diff_href: "/api/v1/stories/101/history/edit-sessions/19",
      available_actions: [],
    } satisfies EditSessionHistoryItem;
    const notificationComparison = {
      story,
      session: {
        ...sessionBaseline,
        from_revision: 4,
        diff_summary: { added: 0, removed: 1, changed: 2, moved: 3, total: 6 },
        diff_href: "/api/v1/stories/101/history/notifications/77",
      },
      changes: [{
        segment_uid: "seg_notification",
        kind: "changed" as const,
        moved: false,
        changed_fields: ["text"],
        before: {
          order_index: 1,
          block_type: "zk",
          text: "Текст последнего открытия",
        },
        after: {
          order_index: 1,
          block_type: "zk",
          text: "Точный текст уведомления",
        },
      }],
    } satisfies ScenarioSessionDiffResponse;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/stories/101/history") {
        return response({
          story,
          items: [sessionBaseline],
          next_cursor: null,
        } satisfies StoryHistoryResponse);
      }
      if (url.pathname === "/api/v1/stories/101/history/notifications/77") {
        return response(notificationComparison);
      }
      if (url.pathname === sessionBaseline.diff_href) {
        return response({
          story,
          session: sessionBaseline,
          changes: [{
            segment_uid: "seg_notification",
            kind: "changed",
            moved: false,
            changed_fields: ["text"],
            before: {
              order_index: 1,
              block_type: "zk",
              text: "Начало сеанса",
            },
            after: {
              order_index: 1,
              block_type: "zk",
              text: "Точный текст уведомления",
            },
          }],
        } satisfies ScenarioSessionDiffResponse);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StoryHistoryPage storyId={101} />);

    expect(await screen.findByText(diffText("Текст последнего открытия"))).toBeInTheDocument();
    expect(screen.getByText(diffText("Точный текст уведомления"))).toBeInTheDocument();
    expect(screen.getByText("Сохранённые состояния 4 → 7")).toBeInTheDocument();
    expect(screen.getByText("Добавлено: 0")).toBeInTheDocument();
    expect(screen.getByText("Удалено: 1")).toBeInTheDocument();
    expect(screen.getByText("Изменено: 2")).toBeInTheDocument();
    expect(screen.getByText("Перемещено: 3")).toBeInTheDocument();
    expect(screen.queryByText("Добавлено: 9")).not.toBeInTheDocument();
    expect(screen.queryByText("Начало сеанса")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/stories/101/history/notifications/77",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      sessionBaseline.diff_href,
      expect.anything(),
    );
  });

  it("keeps normal history visible and retries a failed addressed detail", async () => {
    window.history.replaceState({}, "", "/stories/101/history?session=4");
    let detailRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/stories/101/history") {
        return response({ story, items: [firstSession], next_cursor: null } satisfies StoryHistoryResponse);
      }
      if (url.pathname === olderSession.diff_href) {
        detailRequests += 1;
        if (detailRequests === 1) {
          return errorResponse("Сравнение временно недоступно", 503);
        }
        return response({
          story,
          session: olderSession,
          changes: [{
            segment_uid: "seg_retry_target",
            kind: "changed",
            moved: false,
            changed_fields: ["text"],
            before: { order_index: 1, block_type: "zk", text: "До повтора" },
            after: { order_index: 1, block_type: "zk", text: "После успешного повтора" },
          }],
        } satisfies ScenarioSessionDiffResponse);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<StoryHistoryPage storyId={101} />);

    expect(await screen.findByText("Лира")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Не удалось открыть выбранные изменения");
    expect(alert).toHaveTextContent("Сравнение временно недоступно");
    expect(alert).toHaveTextContent("Обычная история остаётся доступна");
    await user.click(screen.getByRole("button", { name: "Повторить открытие изменений" }));

    expect(await screen.findByText(diffText("После успешного повтора"))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Редакции\s+\d+\s+→\s+\d+/i)).not.toBeInTheDocument();
    expect(detailRequests).toBe(2);
  });

  it("keeps a newer card collapse when an addressed retry finishes", async () => {
    window.history.replaceState({}, "", "/stories/101/history?session=7");
    const pendingAddressedRetry = createDeferred<Response>();
    const pendingCardRequest = createDeferred<Response>();
    let detailRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/stories/101/history") {
        return Promise.resolve(response({ story, items: [firstSession], next_cursor: null } satisfies StoryHistoryResponse));
      }
      if (url.pathname === firstSession.diff_href) {
        detailRequests += 1;
        if (detailRequests === 1) return Promise.resolve(errorResponse("Сравнение временно недоступно", 503));
        if (detailRequests === 2) return pendingAddressedRetry.promise;
        if (detailRequests === 3) return pendingCardRequest.promise;
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const addressedDetail = {
      story,
      session: firstSession,
      changes: [{
        segment_uid: "seg_addressed_retry",
        kind: "changed" as const,
        moved: false,
        changed_fields: ["text"],
        before: { order_index: 1, block_type: "zk", text: "До адресного повтора" },
        after: { order_index: 1, block_type: "zk", text: "После адресного повтора" },
      }],
    } satisfies ScenarioSessionDiffResponse;

    render(<StoryHistoryPage storyId={101} />);

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Повторить открытие изменений" }));
    await user.click(screen.getByRole("button", { name: "Показать изменения" }));
    await user.click(screen.getByRole("button", { name: "Скрыть изменения" }));

    pendingAddressedRetry.resolve(response(addressedDetail));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Показать изменения" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Изменения сценария" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Показать изменения" }));
    expect(await screen.findByText(diffText("После адресного повтора"))).toBeInTheDocument();
    expect(detailRequests).toBe(3);
    pendingCardRequest.resolve(response(addressedDetail));
    await waitFor(() => expect(screen.getByText(diffText("После адресного повтора"))).toBeInTheDocument());
  });

  it("ignores an invalid addressed session and keeps the ordinary history view", async () => {
    window.history.replaceState({}, "", "/stories/101/history?session=not-a-session");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname !== "/api/v1/stories/101/history") {
        throw new Error(`Unexpected request: ${url.pathname}`);
      }
      return response({ story, items: [firstSession], next_cursor: null } satisfies StoryHistoryResponse);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StoryHistoryPage storyId={101} />);

    expect(await screen.findByText("Лира")).toBeInTheDocument();
    expect(screen.queryByText(diffText("Нужная адресная редакция"))).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders readable semantic fields and the saved-state anchor without raw snapshot data", () => {
    const diff: ScenarioSessionDiffResponse = {
      story,
      session: firstSession,
      changes: [{
        segment_uid: "seg_all_fields",
        kind: "changed",
        moved: true,
        changed_fields: [
          "block_type",
          "text",
          "speaker_text",
          "file_name",
          "tc_in",
          "tc_out",
          "additional_comment",
          "structured_data",
          "formatting",
          "rich_text",
        ],
        before: {
          order_index: 1,
          block_type: "zk_geo",
          text: "Старый текст",
          speaker_text: "Скрытое старое ФИО\nСкрытая старая должность",
          file_name: "before.mov",
          tc_in: "00:01",
          tc_out: "00:05",
          additional_comment: "Старый комментарий",
          structured_data: {
            geo: "Староград",
            file_bundles: [
              { file_name: "before.mov", tc_in: "00:01", tc_out: "00:05" },
              { file_name: "before-extra.mov", tc_in: "00:06", tc_out: "00:09" },
            ],
          },
          formatting: { targets: { text: { bold: false } } },
          rich_text: { schema_version: 1, targets: { text: { text: "Старый текст" } } },
        },
        after: {
          order_index: 3,
          block_type: "zk_geo",
          text: "Новый текст",
          speaker_text: "Скрытое новое ФИО\nСкрытая новая должность",
          file_name: "after.mov",
          tc_in: "00:06",
          tc_out: "00:12",
          additional_comment: "Новый комментарий",
          structured_data: { geo: "Новоград" },
          formatting: { targets: { text: { bold: true } } },
          rich_text: { schema_version: 1, targets: { text: { text: "Новый текст" } } },
        },
      }],
    };

    render(<ScenarioSessionDiff diff={diff} />);

    expect(screen.getByText("Строка: 1 → 3")).toBeInTheDocument();
    expect(screen.getByText("Сохранённые состояния 0 → 3")).toBeInTheDocument();
    expect(screen.getByText("Гео")).toBeInTheDocument();
    expect(screen.getByText(diffText("Староград"))).toBeInTheDocument();
    expect(screen.getByText(diffText("Новоград"))).toBeInTheDocument();
    expect(screen.getByText("Имя файла / TC")).toBeInTheDocument();
    expect(screen.getByText(
      diffText("before.mov · 00:01–00:05\nbefore-extra.mov · 00:06–00:09"),
    )).toBeInTheDocument();
    expect(screen.getByText(diffText("after.mov · 00:06–00:12"))).toBeInTheDocument();
    expect(screen.getByText(diffText("Старый комментарий"))).toBeInTheDocument();
    expect(screen.getByText(diffText("Новый комментарий"))).toBeInTheDocument();
    expect(screen.queryByText(/Скрытое (?:старое|новое)/)).not.toBeInTheDocument();

    for (const forbidden of [
      "Структурированные данные",
      "Форматирование",
      "Расширенный текст",
      "schema_version",
      "targets",
    ]) {
      expect(screen.queryByText(new RegExp(forbidden, "i"))).not.toBeInTheDocument();
    }
  });

  it("applies only semantic formatting changes to their before and after values", () => {
    const diff: ScenarioSessionDiffResponse = {
      story,
      session: restoredSession,
      changes: [{
        segment_uid: "seg_formatting",
        kind: "changed",
        moved: false,
        changed_fields: ["formatting"],
        before: {
          order_index: 1,
          block_type: "zk",
          text: "Одинаковый текст",
          formatting: { targets: { text: { bold: false } } },
        },
        after: {
          order_index: 1,
          block_type: "zk",
          text: "Одинаковый текст",
          formatting: { targets: { text: { bold: true } } },
        },
      }],
    };

    render(<ScenarioSessionDiff diff={diff} />);

    const beforeText = screen.getByText("Одинаковый текст", { selector: "[data-side='before']" });
    const afterText = screen.getByText("Одинаковый текст", { selector: "[data-side='after']" });
    expect(beforeText).not.toHaveStyle({ fontWeight: "700" });
    expect(afterText).toHaveStyle({ fontWeight: "700" });
    expect(screen.getByText("Сохранённые состояния 5 → 6")).toBeInTheDocument();
  });

  it("renders allowlisted selection-level TipTap marks without raw HTML or arbitrary styles", () => {
    const text = "Обычный жирный курсив цвет безопасный";
    const diff: ScenarioSessionDiffResponse = {
      story,
      session: restoredSession,
      changes: [{
        segment_uid: "seg_inline_formatting",
        kind: "changed",
        moved: false,
        changed_fields: ["rich_text"],
        before: {
          order_index: 1,
          block_type: "zk",
          text,
          rich_text: {
            targets: {
              text: {
                text,
                html: text,
                doc: {
                  type: "doc",
                  content: [{
                    type: "paragraph",
                    content: [{ type: "text", text }],
                  }],
                },
              },
            },
          },
        },
        after: {
          order_index: 1,
          block_type: "zk",
          text,
          rich_text: {
            targets: {
              text: {
                text,
                html: "<script>RAW HTML</script>",
                doc: {
                  type: "doc",
                  content: [{
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Обычный " },
                      { type: "text", text: "жирный", marks: [{ type: "bold" }] },
                      {
                        type: "text",
                        text: " курсив",
                        marks: [{ type: "italic" }, { type: "strike" }],
                      },
                      {
                        type: "text",
                        text: " цвет",
                        marks: [
                          { type: "textStyle", attrs: { fontFamily: "Arial", style: "font-size:999px" } },
                          { type: "highlight", attrs: { color: "#ffff00", style: "position:fixed" } },
                        ],
                      },
                      {
                        type: "text",
                        text: " безопасный",
                        marks: [
                          { type: "internalMark", attrs: { style: "display:none" } },
                          { type: "textStyle", attrs: { fontFamily: "url(javascript:alert(1))" } },
                          { type: "highlight", attrs: { color: "expression(alert(1))" } },
                        ],
                      },
                    ],
                  }],
                },
              },
            },
          },
        },
      }],
    };

    render(<ScenarioSessionDiff diff={diff} />);

    expect(screen.getByText("жирный")).toHaveStyle({ fontWeight: "700" });
    expect(screen.getByText("курсив")).toHaveStyle({
      fontStyle: "italic",
      textDecoration: "line-through",
    });
    expect(screen.getByText("цвет")).toHaveStyle({
      fontFamily: "Arial, sans-serif",
      backgroundColor: "#ffff00",
    });
    const safe = screen.getByText("безопасный");
    expect(safe).toHaveStyle({
      fontFamily: '"PT Sans", Arial, sans-serif',
      backgroundColor: "#ffffff",
    });
    expect(safe.getAttribute("style")).not.toMatch(
      /javascript|expression|font-size|position|display/,
    );
    expect(screen.queryByText(/RAW HTML/)).not.toBeInTheDocument();
  });

  it("shows complete semantic snapshots for added and removed rows without changed fields", () => {
    const diff: ScenarioSessionDiffResponse = {
      story,
      session: firstSession,
      changes: [
        {
          segment_uid: "seg_added_snh",
          kind: "added",
          moved: false,
          changed_fields: [],
          before: null,
          after: {
            order_index: 2,
            block_type: "snh",
            text: "",
            speaker_text: "Тестов Тест\nЭксперт лаборатории",
            file_name: "speaker.mov",
            tc_in: "00:02",
            tc_out: "00:08",
            additional_comment: "Крупный план",
            structured_data: { source: "synthetic" },
            formatting: { targets: { speaker_fio: { bold: true } } },
            rich_text: { schema_version: 1, targets: { speaker_fio: { text: "Тестов Тест" } } },
          },
        },
        {
          segment_uid: "seg_removed_geo",
          kind: "removed",
          moved: false,
          changed_fields: [],
          before: {
            order_index: 4,
            block_type: "zk_geo",
            text: "Удалённый текст",
            speaker_text: "Удалённый спикер",
            file_name: "removed.mov",
            tc_in: "00:10",
            tc_out: "00:16",
            additional_comment: "Удалённый комментарий",
            structured_data: { geo: "Староград" },
            formatting: { targets: { text: { italic: true } } },
            rich_text: { schema_version: 1, targets: { text: { text: "Удалённый текст" } } },
          },
          after: null,
        },
      ],
    };

    render(<ScenarioSessionDiff diff={diff} />);

    const addedRow = screen.getByText("Добавлен блок · строка 2").closest("li");
    const removedRow = screen.getByText("Удалён блок · строка 4").closest("li");
    expect(addedRow).not.toBeNull();
    expect(removedRow).not.toBeNull();

    expect(within(addedRow!).getByText("СНХ")).toBeInTheDocument();
    expect(
      within(within(addedRow!).getByRole("region", { name: "ФИО" })).getByText("Тестов Тест"),
    ).toBeInTheDocument();
    expect(
      within(within(addedRow!).getByRole("region", { name: "Должность" }))
        .getByText("Эксперт лаборатории"),
    ).toBeInTheDocument();
    expect(within(addedRow!).getByText("speaker.mov · 00:02–00:08")).toBeInTheDocument();
    expect(within(addedRow!).getByText("Крупный план")).toBeInTheDocument();
    expect(within(removedRow!).getByText("ЗК+гео")).toBeInTheDocument();
    expect(within(removedRow!).getByText(diffText("Староград"))).toBeInTheDocument();
    expect(within(removedRow!).getByText("Удалённый текст")).toBeInTheDocument();
    expect(within(removedRow!).getByText("removed.mov · 00:10–00:16")).toBeInTheDocument();
    expect(within(removedRow!).getByText("Удалённый комментарий")).toBeInTheDocument();
    expect(screen.queryByText(/schema_version|targets/i)).not.toBeInTheDocument();
  });

  it("explains how to recover from an initial load failure and retries successfully", async () => {
    let historyLoads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path !== "/api/v1/stories/101/history") throw new Error(`Unexpected request: ${path}`);
      historyLoads += 1;
      if (historyLoads === 1) return errorResponse("История временно недоступна", 503);
      return response({ story, items: [firstSession], next_cursor: null } satisfies StoryHistoryResponse);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<StoryHistoryPage storyId={101} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("История временно недоступна");
    expect(alert).toHaveTextContent("Проверьте соединение и повторите загрузку.");
    await user.click(screen.getByRole("button", { name: "Повторить загрузку" }));

    expect(await screen.findByRole("heading", { name: story.title })).toBeInTheDocument();
    expect(historyLoads).toBe(2);
  });

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
    expect(await screen.findByText(diffText("Итоговая правка"))).toBeInTheDocument();
    expect(screen.getByText("Добавленный блок")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Восстановить" }));
    const dialog = screen.getByRole("dialog", { name: "Восстановить состояние сценария" });
    expect(within(dialog).queryByText(/редакци/i)).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Восстановить состояние" });
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Восстановить" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Восстановить" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Восстановить состояние" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Отмена" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Восстановить состояние" }));

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

  it("appends an opaque-cursor page without replacing newer sessions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname !== "/api/v1/stories/101/history") throw new Error(`Unexpected request: ${url}`);
      return response({
        story,
        items: url.searchParams.get("cursor") ? [firstSession] : [restoredSession],
        next_cursor: url.searchParams.get("cursor") ? null : "opaque-session-cursor",
      } satisfies StoryHistoryResponse);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<StoryHistoryPage storyId={101} />);

    expect(await screen.findByText("Астра")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Показать более ранние изменения" }));
    expect(await screen.findByText("Лира")).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), window.location.origin).searchParams.get("cursor") === "opaque-session-cursor")).toBe(true);
  });

  it("deduplicates an in-flight diff request", async () => {
    let resolveDiff!: (value: Response) => void;
    const pendingDiff = new Promise<Response>((resolve) => { resolveDiff = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/v1/stories/101/history") {
        return response({ story, items: [firstSession], next_cursor: null } satisfies StoryHistoryResponse);
      }
      if (path === firstSession.diff_href) return pendingDiff;
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StoryHistoryPage storyId={101} />);

    const showDiff = await screen.findByRole("button", { name: "Показать изменения" });
    fireEvent.click(showDiff);
    fireEvent.click(showDiff);
    await waitFor(() => {
      const diffCalls = fetchMock.mock.calls.filter(([input]) => new URL(String(input), window.location.origin).pathname === firstSession.diff_href);
      expect(diffCalls).toHaveLength(1);
    });
    resolveDiff(response({ story, session: firstSession, changes: [] }));
    expect(showDiff).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(showDiff);
    await waitFor(() => expect(screen.getByText("Содержательных изменений нет.")).toBeInTheDocument());
  });

  it("keeps the restore dialog open and explains a server rejection", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/v1/stories/101/history") {
        return response({ story, items: [firstSession], next_cursor: null } satisfies StoryHistoryResponse);
      }
      if (path === restoreAction.href && init?.method === restoreAction.method) {
        return errorResponse("Сценарий сейчас редактируется");
      }
      throw new Error(`Unexpected request: ${init?.method || "GET"} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<StoryHistoryPage storyId={101} />);

    await user.click(await screen.findByRole("button", { name: "Восстановить" }));
    await user.click(screen.getByRole("button", { name: "Восстановить состояние" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Сценарий сейчас редактируется");
    expect(screen.getByRole("dialog", { name: "Восстановить состояние сценария" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("keeps focus trapped while restore is submitting and after a server error", async () => {
    const pendingRestore = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/v1/stories/101/history") {
        return response({ story, items: [firstSession], next_cursor: null } satisfies StoryHistoryResponse);
      }
      if (path === restoreAction.href && init?.method === restoreAction.method) {
        return pendingRestore.promise;
      }
      throw new Error(`Unexpected request: ${init?.method || "GET"} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<StoryHistoryPage storyId={101} />);

    const restoreTrigger = await screen.findByRole("button", { name: "Восстановить" });
    await user.click(restoreTrigger);
    const dialog = screen.getByRole("dialog", { name: "Восстановить состояние сценария" });
    const confirm = within(dialog).getByRole("button", { name: "Восстановить состояние" });
    await user.click(confirm);

    await waitFor(() => expect(confirm).toBeDisabled());
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    pendingRestore.resolve(errorResponse("Сценарий сейчас редактируется"));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Сценарий сейчас редактируется");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(restoreTrigger).toHaveFocus();
  });
});


describe("history interaction recovery", () => {
  afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });
  const detail = {
    story, session: firstSession,
    changes: [{ segment_uid: "seg_toggle", kind: "changed" as const, moved: false, changed_fields: ["text"],
      before: { order_index: 1, block_type: "zk", text: "Старое предложение" },
      after: { order_index: 1, block_type: "zk", text: "Новое предложение" } }],
  };
  const history = { story, items: [firstSession], next_cursor: null };

  it("toggles cached comparisons and collapses while their GET is pending", async () => {
    const deferred = createDeferred<Response>();
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input) === firstSession.diff_href) { gets++; return deferred.promise; }
      return Promise.resolve(response(history));
    }));
    const user = userEvent.setup();
    render(<StoryHistoryPage storyId={101} />);
    const open = await screen.findByRole("button", { name: "Показать изменения" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    await user.click(open);
    const close = screen.getByRole("button", { name: "Скрыть изменения" });
    expect(close).toHaveAttribute("aria-expanded", "true");
    expect(close).not.toBeDisabled();
    await user.click(close);
    deferred.resolve(response(detail));
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Изменения сценария" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Показать изменения" }));
    expect(await screen.findByRole("region", { name: "Изменения сценария" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Скрыть изменения" }));
    expect(screen.queryByRole("region", { name: "Изменения сценария" })).not.toBeInTheDocument();
    expect(gets).toBe(1);
  });

  it("confirms from cancel and retries only GET after acknowledged restore", async () => {
    let gets = 0; let commands = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { commands++; return Promise.resolve(response({ revision: 6 })); }
      gets++;
      return Promise.resolve(gets === 2 ? errorResponse("Обновление недоступно", 503) : response(history));
    }));
    const user = userEvent.setup();
    render(<StoryHistoryPage storyId={101} />);
    await user.click(await screen.findByRole("button", { name: "Восстановить" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toHaveFocus();
    expect(dialog).toHaveTextContent("Лира");
    await user.click(within(dialog).getByRole("button", { name: "Восстановить состояние" }));
    expect(await screen.findByText(/Сценарий восстановлен/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Восстановить" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Повторить загрузку истории" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Восстановить" })).not.toBeDisabled());
    expect(commands).toBe(1);
    expect(gets).toBe(3);
  });

  it("reports an already-current restore as a clear no-op without another command", async () => {
    let commands = 0;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { commands++; return Promise.resolve(new Response(JSON.stringify({
        error: { code: "SCENARIO_ALREADY_CURRENT", message: "Это состояние уже актуально. Сценарий не изменён." },
      }), { status: 409, headers: { "Content-Type": "application/json" } })); }
      return Promise.resolve(response(history));
    }));
    const user = userEvent.setup();
    render(<StoryHistoryPage storyId={101} />);
    await user.click(await screen.findByRole("button", { name: "Восстановить" }));
    await user.click(screen.getByRole("button", { name: "Восстановить состояние" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Это состояние уже актуально. Сценарий не изменён.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(commands).toBe(1);
  });

  it("retries a failed diff and isolates two concurrent comparisons", async () => {
    const pendingFirst = createDeferred<Response>();
    const pendingOlder = createDeferred<Response>();
    let firstGets = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input) === firstSession.diff_href) {
        firstGets++;
        return firstGets === 1 ? Promise.resolve(errorResponse("Повторите сравнение", 503)) : pendingFirst.promise;
      }
      if (String(input) === olderSession.diff_href) return pendingOlder.promise;
      return Promise.resolve(response({ ...history, items: [firstSession, olderSession] }));
    }));
    const user = userEvent.setup();
    render(<StoryHistoryPage storyId={101} />);
    const buttons = await screen.findAllByRole("button", { name: "Показать изменения" });
    await user.click(buttons[0]);
    await user.click(await screen.findByRole("button", { name: "Повторить загрузку изменений" }));
    await user.click(buttons[1]);
    pendingOlder.resolve(response({ ...detail, session: olderSession }));
    await waitFor(() => expect(screen.getAllByRole("region", { name: "Изменения сценария" })).toHaveLength(1));
    pendingFirst.resolve(response(detail));
    await waitFor(() => expect(screen.getAllByRole("region", { name: "Изменения сценария" })).toHaveLength(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(firstGets).toBe(2);
  });

  it("does not hydrate another story from a late first-page response", async () => {
    const first = createDeferred<Response>();
    const secondStory = { ...story, id: 202, title: "Другая история" };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input).includes("/101/")
      ? first.promise : Promise.resolve(response({ story: secondStory, items: [], next_cursor: null }))));
    const view = render(<StoryHistoryPage storyId={101} />);
    view.rerender(<StoryHistoryPage storyId={202} />);
    expect(await screen.findByRole("heading", { name: secondStory.title })).toBeInTheDocument();
    first.resolve(response(history));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByRole("heading", { name: story.title })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: secondStory.title })).toBeInTheDocument();
  });
});


describe("history change highlights", () => {
  it("highlights changed words while preserving exact text and original marks", () => {
    const diff: ScenarioSessionDiffResponse = { story, session: firstSession, changes: [{
      segment_uid: "highlight", kind: "changed", moved: false, changed_fields: ["text", "rich_text"],
      before: { block_type: "zk", text: "Прежний текст остаётся.", formatting: { targets: { text: { bold: true, fill_color: "#ffff00" } } } },
      after: { block_type: "zk", text: "Новый текст остаётся.", formatting: { targets: { text: { italic: true, font_family: "Georgia" } } } },
    }] };
    const { container } = render(<ScenarioSessionDiff diff={diff} />);
    expect(Array.from(container.querySelectorAll("del")).map(el => el.textContent).join("")).toBe("Прежний");
    expect(Array.from(container.querySelectorAll("ins")).map(el => el.textContent).join("")).toBe("Новый");
    expect(container.querySelector('[data-side="before"]')).toHaveTextContent("Прежний текст остаётся.");
    expect(container.querySelector('[data-side="after"]')).toHaveTextContent("Новый текст остаётся.");
    expect(container.querySelector('[data-side="before"]')).toHaveStyle({ fontWeight: "700" });
    expect(container.querySelector('[data-side="after"]')).toHaveStyle({ fontStyle: "italic" });
    expect(screen.getByText("Удалённые фрагменты")).toBeInTheDocument();
    expect(screen.getByText("Добавленные фрагменты")).toBeInTheDocument();
  });

  it("explains formatting-only changes when words are identical", () => {
    const diff: ScenarioSessionDiffResponse = { story, session: firstSession, changes: [{
      segment_uid: "format", kind: "changed", moved: false, changed_fields: ["formatting"],
      before: { block_type: "zk", text: "Тот же текст" },
      after: { block_type: "zk", text: "Тот же текст", formatting: { targets: { text: { bold: true } } } },
    }] };
    const { container } = render(<ScenarioSessionDiff diff={diff} />);
    expect(screen.getByText("Изменено оформление")).toBeInTheDocument();
    expect(screen.getByText(/Стало:.*полужирный/)).toBeInTheDocument();
    expect(container.querySelector("del, ins")).toBeNull();
  });
});


describe("history font context", () => {
  it("shows a font-only change without claiming an empty comparison", () => {
    const diff: ScenarioSessionDiffResponse = { story, session: {
      ...firstSession, diff_summary: { added: 0, removed: 0, changed: 0, moved: 0, settings_changed: 1, total: 1 },
    }, default_font_family: { before: "PT Sans", after: "Franklin Gothic Book" }, changes: [] };
    render(<ScenarioSessionDiff diff={diff} />);
    expect(screen.getByRole("region", { name: "Шрифт сценария" })).toBeInTheDocument();
    expect(screen.getByText("PT Sans")).toBeInTheDocument();
    expect(screen.getByText("Franklin Gothic Book")).toBeInTheDocument();
    expect(screen.queryByText("Содержательных изменений нет.")).not.toBeInTheDocument();
  });

  it("renders both sides in their inherited font without replacing manual overrides", () => {
    const diff: ScenarioSessionDiffResponse = { story, session: firstSession,
      default_font_family: { before: "Franklin Gothic Book", after: "Franklin Gothic Book" }, changes: [{
      segment_uid: "font-context", kind: "changed", moved: false, changed_fields: ["text"],
      before: { block_type: "zk", text: "Прежние слова" },
      after: { block_type: "zk", text: "Новые слова", formatting: { targets: { text: { font_family: "PT Sans" } } } },
    }] };
    const { container } = render(<ScenarioSessionDiff diff={diff} />);
    expect(container.querySelector('[data-side="before"]')).toHaveStyle({ fontFamily: '\"Franklin Gothic Book\", Arial, sans-serif' });
    expect(container.querySelector('[data-side="after"]')).toHaveStyle({ fontFamily: '\"PT Sans\", Arial, sans-serif' });
  });
});
