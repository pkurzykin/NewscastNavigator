import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { navigate, useLocationHref } from "../../app/AppRouter";
import { NOTIFICATIONS_INVALIDATED_EVENT } from "./api";
import AttentionQueue from "./components/AttentionQueue";
import NotificationTray from "./components/NotificationTray";
import { createDeferred } from "../../test/deferred";


const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});

const story = {
  id: 101,
  title: "Синтетический сюжет",
  priority: { code: "high", label: "Высокий" },
};

const actions = {
  items: [
    {
      id: "story:101:action:confirm_editorial",
      story,
      summary: "Проверить актуальный сценарий",
      target_href: "/stories/101/scenario",
      action: {
        code: "confirm_editorial",
        label: "Подтвердить редакционную готовность",
        method: "POST",
        href: "/api/v1/stories/101/workflow/confirm-editorial",
        emphasis: "normal",
        confirmation: null,
        form: null,
      },
    },
    {
      id: "story:101:correction:8:part:12:complete",
      story,
      summary: "Уточнить формулировку",
      target_href: "/stories/101/production",
      action: {
        code: "correction_part_complete",
        label: "Правка текста выполнена",
        method: "POST",
        href: "/api/v1/stories/101/correction-packages/8/parts/12/complete",
        emphasis: "normal",
        confirmation: null,
        form: null,
        part_id: 12,
        part_scope: "text",
      },
    },
  ],
  total: 2,
};

const notification = {
  id: 77,
  kind: "scenario_changed_video",
  story,
  actor: {
    id: 2,
    username: "lira",
    display_name: "Лира",
    position: "Корреспондент",
    function_codes: ["author"],
  },
  title: "Сценарий изменён после начала монтажа",
  summary: "Откройте актуальный сценарий и сохранённый diff",
  target_href: "/stories/101/scenario?production_context=video",
  diff: {
    from_revision: 4,
    to_revision: 7,
    summary: { added: 1, removed: 0, changed: 1, moved: 0, total: 2 },
    changes: [
      {
        segment_uid: "seg_1",
        kind: "changed",
        moved: false,
        changed_fields: ["text"],
        before: { text: "Прежняя синтетическая строка" },
        after: { text: "Новая синтетическая строка" },
      },
    ],
    href: "/stories/101/history?notification=77",
  },
  created_at: "2026-07-22T08:00:00Z",
  updated_at: "2026-07-22T08:05:00Z",
  read_at: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/stories");
});

describe("AttentionQueue", () => {
  it("uses Russian number agreement and keeps long action copy available", async () => {
    const longSummary = "Очень подробный контекст действия ".repeat(8);
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: Array.from({ length: 10 }, (_, index) => ({
        ...actions.items[0], id: `long-${index}`, summary: longSummary,
      })),
      total: 10,
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AttentionQueue />);

    const region = await screen.findByRole("region", { name: "Требует внимания" });
    expect(within(region).getByText("10 действий")).toBeInTheDocument();
    expect(within(region).getAllByText(longSummary.trim())).toHaveLength(3);
    expect(within(region).getAllByRole("link")).toHaveLength(3);
  });

  it("loads independently and renders compact server-owned links without executing actions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(actions));
    vi.stubGlobal("fetch", fetchMock);

    render(<AttentionQueue />);

    const region = await screen.findByRole("region", { name: "Требует внимания" });
    expect(within(region).getAllByRole("link")).toHaveLength(2);
    expect(within(region).getByRole("link", { name: "Подтвердить редакционную готовность" })).toHaveAttribute(
      "href",
      "/stories/101/scenario",
    );
    expect(within(region).getByRole("link", { name: "Правка текста выполнена" })).toHaveAttribute(
      "href",
      "/stories/101/production",
    );
    expect(within(region).getByText("Проверить актуальный сценарий")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/me/actions?limit=20");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("takes no space when empty or unavailable and never owns the stories-table error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [], total: 0 }))
      .mockResolvedValueOnce(response({ error: { code: "TEMPORARY", message: "Временная ошибка" } }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const empty = render(<AttentionQueue />);
    await waitFor(() => {
      expect(empty.container.querySelector('[data-attention-state="empty"]')).toBeInTheDocument();
    });
    expect(screen.queryByRole("region", { name: "Требует внимания" })).not.toBeInTheDocument();
    const emptyState = empty.container.querySelector<HTMLElement>('[data-attention-state="empty"]');
    expect(emptyState).toHaveAttribute("hidden");
    expect(emptyState?.getBoundingClientRect().height).toBe(0);
    empty.unmount();

    const failed = render(<AttentionQueue />);
    await waitFor(() => {
      expect(failed.container.querySelector('[data-attention-state="empty"]')).toBeInTheDocument();
    });
    expect(screen.queryByRole("region", { name: "Требует внимания" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const failedState = failed.container.querySelector<HTMLElement>('[data-attention-state="empty"]');
    expect(failedState).toHaveAttribute("hidden");
    expect(failedState?.getBoundingClientRect().height).toBe(0);
  });

  it("lazily loads the full server total before expanding and collapses back to three", async () => {
    const manyActions = {
      items: Array.from({ length: 21 }, (_, index) => ({
        ...actions.items[index % actions.items.length],
        id: `attention-action-${index + 1}`,
        summary: `Действие ${index + 1}`,
        action: {
          ...actions.items[index % actions.items.length].action,
          label: `Открыть действие ${index + 1}`,
        },
      })),
      total: 21,
    };
    let resolveFull!: (value: Response) => void;
    const fullResponse = new Promise<Response>((resolve) => { resolveFull = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: manyActions.items.slice(0, 20), total: 21 }))
      .mockReturnValueOnce(fullResponse);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AttentionQueue />);

    const region = await screen.findByRole("region", { name: "Требует внимания" });
    expect(within(region).getAllByRole("link")).toHaveLength(3);
    expect(within(region).getByText("21 действие")).toBeInTheDocument();
    const showAll = within(region).getByRole("button", { name: "Показать все действия" });
    expect(showAll).toHaveClass("MuiButton-root");
    await user.click(showAll);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/me/actions?limit=21");
    expect(within(region).getByRole("status")).toHaveTextContent("Загружаем все действия");
    expect(within(region).getAllByRole("link")).toHaveLength(3);

    resolveFull(response(manyActions));
    await waitFor(() => expect(within(region).getAllByRole("link")).toHaveLength(21));
    await user.click(within(region).getByRole("button", { name: "Свернуть список действий" }));
    expect(within(region).getAllByRole("link")).toHaveLength(3);
  });

  it("keeps the compact preview visible and exposes an accessible error if full loading fails", async () => {
    const initial = {
      items: Array.from({ length: 20 }, (_, index) => ({
        ...actions.items[index % actions.items.length],
        id: `attention-failed-${index + 1}`,
      })),
      total: 21,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(initial))
      .mockRejectedValueOnce(new Error("synthetic full-load failure"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AttentionQueue />);

    const region = await screen.findByRole("region", { name: "Требует внимания" });
    await user.click(within(region).getByRole("button", { name: "Показать все действия" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить все действия",
    );
    expect(within(region).getAllByRole("link")).toHaveLength(3);
    expect(within(region).getByRole("button", { name: "Показать все действия" })).toBeVisible();
  });

  it("refreshes from the shared invalidation event and keeps the last good preview after a poll failure", async () => {
    const refreshed = {
      ...actions,
      items: [{ ...actions.items[0], summary: "Обновлённое действие" }],
      total: 1,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(actions))
      .mockResolvedValueOnce(response(refreshed))
      .mockRejectedValueOnce(new Error("synthetic polling failure"));
    vi.stubGlobal("fetch", fetchMock);

    render(<AttentionQueue />);
    const region = await screen.findByRole("region", { name: "Требует внимания" });

    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    expect(await within(region).findByText("Обновлённое действие")).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(within(region).getByText("Обновлённое действие")).toBeInTheDocument();
  });

  it("does not replace the expanded list with a preview-sized polling response", async () => {
    const allActions = {
      items: Array.from({ length: 4 }, (_, index) => ({
        ...actions.items[index % actions.items.length],
        id: `full-action-${index + 1}`,
        summary: `Полное действие ${index + 1}`,
        action: { ...actions.items[index % actions.items.length].action, label: `Открыть полное действие ${index + 1}` },
      })),
      total: 4,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: allActions.items.slice(0, 3), total: 4 }))
      .mockResolvedValueOnce(response(allActions))
      .mockResolvedValueOnce(response(allActions));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AttentionQueue />);
    const region = await screen.findByRole("region", { name: "Требует внимания" });
    await user.click(within(region).getByRole("button", { name: "Показать все действия" }));
    await waitFor(() => expect(within(region).getAllByRole("link")).toHaveLength(4));

    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/me/actions?limit=4");
    expect(within(region).getAllByRole("link")).toHaveLength(4);
  });

  it("keeps an expanded queue complete when a poll reports a larger server total", async () => {
    const oldTotal = {
      items: Array.from({ length: 4 }, (_, index) => ({
        ...actions.items[index % actions.items.length],
        id: `old-action-${index + 1}`,
        summary: `Старое действие ${index + 1}`,
        action: { ...actions.items[index % actions.items.length].action, label: `Открыть старое действие ${index + 1}` },
      })),
      total: 4,
    };
    const largerTotal = {
      items: Array.from({ length: 6 }, (_, index) => ({
        ...actions.items[index % actions.items.length],
        id: `new-action-${index + 1}`,
        summary: `Новое действие ${index + 1}`,
        action: { ...actions.items[index % actions.items.length].action, label: `Открыть новое действие ${index + 1}` },
      })),
      total: 6,
    };
    const delayedPreview = createDeferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: oldTotal.items.slice(0, 3), total: 4 }))
      .mockResolvedValueOnce(response(oldTotal))
      .mockReturnValueOnce(delayedPreview.promise)
      .mockResolvedValueOnce(response(largerTotal));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<AttentionQueue />);
    const region = await screen.findByRole("region", { name: "Требует внимания" });
    await user.click(within(region).getByRole("button", { name: "Показать все действия" }));
    await waitFor(() => expect(within(region).getAllByRole("link")).toHaveLength(4));

    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/v1/me/actions?limit=4");
    expect(within(region).getAllByRole("link")).toHaveLength(4);

    delayedPreview.resolve(response({ items: largerTotal.items.slice(0, 4), total: 6 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[3][0]).toBe("/api/v1/me/actions?limit=6");
    await waitFor(() => expect(within(region).getAllByRole("link")).toHaveLength(6));
    expect(within(region).getByText("Новое действие 6")).toBeInTheDocument();
  });
});

describe("NotificationTray", () => {
  it("shows loading, initial error with retry, then actor, time and full summary", async () => {
    const pending = createDeferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({ items: [notification], total: 1, unread_count: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<NotificationTray />);

    await user.click(screen.getByRole("button", { name: "Уведомления, непрочитанных: 0" }));
    const tray = screen.getByRole("region", { name: "Уведомления" });
    expect(within(tray).getByRole("status")).toHaveTextContent("Загружаем уведомления");
    pending.reject(new Error("synthetic initial error"));
    expect(await within(tray).findByRole("alert")).toHaveTextContent("Не удалось загрузить уведомления");
    await user.click(within(tray).getByRole("button", { name: "Повторить" }));
    expect(await within(tray).findByText(notification.summary)).toBeInTheDocument();
    expect(within(tray).getByText(/Лира/)).toBeInTheDocument();
    expect(within(tray).getByText(/22\.07\.2026.*11:00/)).toBeInTheDocument();
  });

  it("keeps prior items during a refresh error and does not invent absent actor or time", async () => {
    const anonymous = { ...notification, actor: null, created_at: "" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [anonymous], total: 1, unread_count: 1 }))
      .mockRejectedValueOnce(new Error("synthetic refresh error"))
      .mockResolvedValueOnce(response({ items: [anonymous], total: 1, unread_count: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<NotificationTray />);
    await user.click(await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" }));
    const tray = screen.getByRole("region", { name: "Уведомления" });
    expect(within(tray).queryByText(/Лира|Неизвестный автор|время неизвестно/)).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    expect(await within(tray).findByRole("alert")).toHaveTextContent("Не удалось загрузить уведомления");
    expect(within(tray).getByText(notification.summary)).toBeInTheDocument();
    await user.click(within(tray).getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(within(tray).queryByRole("alert")).not.toBeInTheDocument());
    expect(within(tray).getByText(notification.summary)).toBeInTheDocument();
  });

  it("collapses and reopens semantic changes, including an empty removed block and formatting", async () => {
    const detailed = {
      ...notification,
      diff: {
        ...notification.diff,
        summary: { added: 0, removed: 1, changed: 1, moved: 0, total: 2 },
        changes: [
          { segment_uid: "empty", kind: "removed", moved: false, changed_fields: [], before: { block_type: "zk", order_index: 4, text: "" }, after: null },
          { segment_uid: "meta", kind: "changed", moved: false, changed_fields: ["additional_comment", "formatting"],
            before: { block_type: "zk", order_index: 2, text: "Одинаковый текст", additional_comment: "Старый план", formatting: { targets: { text: { bold: false } } } },
            after: { block_type: "zk", order_index: 2, text: "Одинаковый текст", additional_comment: "Новый план", formatting: { targets: { text: { bold: true } } } } },
        ],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ items: [detailed], total: 1, unread_count: 1 })));
    const user = userEvent.setup();
    render(<NotificationTray />);
    await user.click(await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" }));
    const tray = screen.getByRole("region", { name: "Уведомления" });
    await user.click(within(tray).getByText("Показать изменения", { exact: true }));
    expect(within(tray).getByText("Свернуть")).toBeInTheDocument();
    expect(within(tray).getByText(/Удалён пустой блок/)).toBeInTheDocument();
    expect(within(tray).getByText("Старый план")).toBeInTheDocument();
    expect(within(tray).getByText("Новый план")).toBeInTheDocument();
    expect(within(tray).getByText("Изменено оформление")).toBeInTheDocument();
    expect(within(tray).queryByText("—")).not.toBeInTheDocument();
    await user.click(within(tray).getByText("Свернуть"));
    expect(within(tray).getByText("Показать изменения", { exact: true })).toBeInTheDocument();
    await user.click(within(tray).getByText("Показать изменения", { exact: true }));
    expect(within(tray).getByText(/Удалён пустой блок/)).toBeInTheDocument();
  });

  it("does not claim identical formatting before and after when color or formatted span changes", async () => {
    const richText = (boldText: string, plainText: string) => ({
      targets: { text: { text: "АБВ", doc: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: boldText, marks: [{ type: "bold" }] },
        { type: "text", text: plainText },
      ] }] } } },
    });
    const formattingChanges = {
      ...notification,
      diff: { ...notification.diff,
        summary: { added: 0, removed: 0, changed: 2, moved: 0, total: 2 },
        changes: [
          { segment_uid: "color", kind: "changed", changed_fields: ["formatting"],
            before: { block_type: "zk", text: "Цвет", formatting: { targets: { text: { fill_color: "#ffff00" } } } },
            after: { block_type: "zk", text: "Цвет", formatting: { targets: { text: { fill_color: "#ff0000" } } } } },
          { segment_uid: "boundary", kind: "changed", changed_fields: ["rich_text"],
            before: { block_type: "zk", text: "АБВ", rich_text: richText("А", "БВ") },
            after: { block_type: "zk", text: "АБВ", rich_text: richText("АБ", "В") } },
        ],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ items: [formattingChanges], total: 1, unread_count: 1 })));
    const user = userEvent.setup();
    render(<NotificationTray />);
    await user.click(await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" }));
    const tray = screen.getByRole("region", { name: "Уведомления" });
    await user.click(within(tray).getByRole("button", { name: "Показать изменения" }));
    expect(within(tray).getAllByText("Изменилось оформление фрагментов текста. Подробное сравнение — в истории.")).toHaveLength(2);
    expect(within(tray).queryByText(/^Было:/)).not.toBeInTheDocument();
    expect(within(tray).getByRole("link", { name: "Показать изменения в истории" })).toHaveAttribute("href", notification.diff.href);
  });

  it("allows the same notification to gain a diff on refresh", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [{ ...notification, diff: null }], total: 1, unread_count: 1 }))
      .mockResolvedValueOnce(response({ items: [notification], total: 1, unread_count: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<NotificationTray />);
    await user.click(await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" }));
    const tray = screen.getByRole("region", { name: "Уведомления" });
    expect(within(tray).queryByRole("button", { name: "Показать изменения" })).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    expect(await within(tray).findByRole("button", { name: "Показать изменения" })).toBeInTheDocument();
    expect(within(tray).getByRole("link", { name: "Открыть сюжет" })).toHaveAttribute("href", notification.target_href);
  });

  it("uses server unread_count for the badge while rendering only the limited items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [notification],
      total: 3,
      unread_count: 3,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<NotificationTray />);

    const toggle = await screen.findByRole("button", { name: "Уведомления, непрочитанных: 3" });
    await user.click(toggle);
    const tray = screen.getByRole("region", { name: "Уведомления" });
    expect(within(tray).getByText("3 непрочитанных")).toBeInTheDocument();
    expect(tray.querySelectorAll(".notification-item")).toHaveLength(1);
    expect(within(tray).getAllByText("Сценарий изменён после начала монтажа")).toHaveLength(1);
  });

  it("shows the unread badge, Russian copy and expandable persisted diff, then uses exact read command", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [notification], total: 1, unread_count: 1 }))
      .mockResolvedValueOnce(response({
        ok: true,
        event_id: null,
        changed_at: "2026-07-22T08:06:00Z",
        resource: { type: "notification", id: 77 },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<NotificationTray />);

    const toggle = await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" });
    expect(within(toggle).getByText("1")).toBeInTheDocument();
    await user.click(toggle);
    const tray = screen.getByRole("region", { name: "Уведомления" });
    expect(within(tray).getByText("Сценарий изменён после начала монтажа")).toBeInTheDocument();
    expect(within(tray).getByText("Откройте актуальный сценарий и сохранённый diff")).toBeInTheDocument();
    expect(within(tray).getByRole("link", { name: "Открыть сюжет" })).toHaveAttribute(
      "href",
      "/stories/101/scenario?production_context=video",
    );

    await user.click(within(tray).getByText("Показать изменения", { exact: true }));
    expect(within(tray).getByText("Изменений: 2")).toBeInTheDocument();
    expect(within(tray).queryByText(/Редакции\s+\d+\s+→\s+\d+/i)).not.toBeInTheDocument();
    expect(within(tray).getByText("Прежняя синтетическая строка")).toBeInTheDocument();
    expect(within(tray).getByText("Новая синтетическая строка")).toBeInTheDocument();
    expect(within(tray).getByRole("link", { name: "Показать изменения в истории" })).toHaveAttribute(
      "href",
      "/stories/101/history?notification=77",
    );

    await user.click(within(tray).getByRole("button", { name: "Отметить прочитанным" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/notifications/77/read");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: "{}" });
    expect(screen.queryByText("Сценарий изменён после начала монтажа")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Уведомления, непрочитанных: 0" })).toBeInTheDocument();
  });

  it("keeps the notification visible and explains how to retry when marking it read fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [notification], total: 1, unread_count: 1 }))
      .mockResolvedValueOnce(response({ error: { code: "TEMPORARY", message: "Временная ошибка" } }, 503));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<NotificationTray />);

    await user.click(await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" }));
    await user.click(screen.getByRole("button", { name: "Отметить прочитанным" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось отметить уведомление прочитанным. Попробуйте ещё раз.",
    );
    expect(screen.getByText("Сценарий изменён после начала монтажа")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Уведомления, непрочитанных: 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отметить прочитанным" })).toBeEnabled();
  });

  it("refreshes from the shared invalidation event and keeps the last good badge after a poll failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [notification], total: 1, unread_count: 1 }))
      .mockResolvedValueOnce(response({ items: [], total: 0, unread_count: 0 }))
      .mockRejectedValueOnce(new Error("synthetic polling failure"));
    vi.stubGlobal("fetch", fetchMock);

    render(<NotificationTray />);
    await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" });

    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    await screen.findByRole("button", { name: "Уведомления, непрочитанных: 0" });

    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "Уведомления, непрочитанных: 0" })).toBeInTheDocument();
  });

  it("does not restore a notification from a stale refresh that started before it was marked read", async () => {
    const staleRefresh = createDeferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [notification], total: 1, unread_count: 1 }))
      .mockReturnValueOnce(staleRefresh.promise)
      .mockResolvedValueOnce(response({
        ok: true,
        event_id: null,
        changed_at: "2026-07-22T08:06:00Z",
        resource: { type: "notification", id: 77 },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<NotificationTray />);
    await user.click(await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" }));
    act(() => window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT)));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Отметить прочитанным" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    staleRefresh.resolve(response({ items: [notification], total: 1, unread_count: 1 }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Сценарий изменён после начала монтажа")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Уведомления, непрочитанных: 0" })).toBeInTheDocument();
  });

  it("closes only from its toggle, an outside pointerdown, or Escape and restores focus after Escape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ items: [notification], total: 1, unread_count: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const { container } = render(<NotificationTray />);
    const toggle = await screen.findByRole("button", { name: "Уведомления, непрочитанных: 1" });
    await user.click(toggle);
    const tray = screen.getByRole("region", { name: "Уведомления" });
    expect(tray).toHaveClass("MuiPopover-paper");
    expect(document.querySelector(".MuiPopover-root")).toBeInTheDocument();
    expect(within(tray).getByRole("button", { name: "Закрыть уведомления" }))
      .toHaveClass("MuiIconButton-root");

    await user.click(within(tray).getByText(notification.summary));
    expect(screen.getByRole("region", { name: "Уведомления" })).toBeInTheDocument();

    act(() => document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(screen.queryByRole("region", { name: "Уведомления" })).not.toBeInTheDocument();

    await user.click(toggle);
    await user.click(toggle);
    expect(screen.queryByRole("region", { name: "Уведомления" })).not.toBeInTheDocument();

    await user.click(toggle);
    const pageEscape = vi.fn();
    window.addEventListener("keydown", pageEscape);
    within(screen.getByRole("region", { name: "Уведомления" }))
      .getByRole("button", { name: "Закрыть уведомления" })
      .focus();
    await user.keyboard("{Escape}");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(pageEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Уведомления" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(toggle);
    expect(container.querySelector(".notification-tray-wrap")).toContainElement(toggle);
    window.removeEventListener("keydown", pageEscape);
  });
});

describe("AppRouter location tracking", () => {
  it("updates on same-path query and hash navigation and preserves the exact deep link", () => {
    window.history.replaceState({}, "", "/stories/101/scenario");
    const { result } = renderHook(() => useLocationHref());

    act(() => navigate("/stories/101/scenario?production_context=video"));
    expect(result.current).toBe("/stories/101/scenario?production_context=video");

    act(() => navigate("/stories/101/scenario?production_context=titles#latest"));
    expect(result.current).toBe("/stories/101/scenario?production_context=titles#latest");
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(result.current);
  });
});
