import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ArchivePage from "../../pages/ArchivePage";
import { fetchStories, runStoryLifecycleAction } from "./api";
import type { StoryListItem } from "./types";

vi.mock("./api", () => ({ fetchStories: vi.fn(), runStoryLifecycleAction: vi.fn() }));
const archived = {
  id: 101, title: "Синтетический архив", duration_text: null,
  priority: { code: "standard", label: "Стандарт" }, rubric: { id: 1, name: "Город" },
  author: { id: 1, username: "lira", display_name: "Лира", position: "Автор", function_codes: ["author"] },
  situation: { code: "archive", label: "В архиве" }, assignments: [],
  created_at: "2026-09-01T10:00:00Z", updated_at: "2026-09-02T10:00:00Z",
  archived_at: "2026-09-03T10:00:00Z", management: null,
  lifecycle_actions: [],
  delete_action: { code: "story_delete", label: "Удалить", method: "DELETE", href: "/api/v1/stories/101",
    emphasis: "danger", confirmation: "Сюжет и вся его история будут удалены без возможности восстановления.", form: null },
} as StoryListItem;
const ack = { ok: true, event_id: null, changed_at: "2026-09-15T10:00:00Z", resource: { type: "story", id: 101 } } as const;

afterEach(() => vi.resetAllMocks());

describe("ArchivePage", () => {
  it("shows six archive columns and uses independent server actions", async () => {
    vi.mocked(fetchStories).mockResolvedValue({ items: [archived], total: 1 });
    render(<ArchivePage onOpenScenario={vi.fn()} />);
    const table = await screen.findByRole("table", { name: "Архив сюжетов" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Название", "Рубрика", "Автор", "Исполнители", "В архиве с", "Действия",
    ]);
    expect(screen.getByRole("button", { name: "Удалить: Синтетический архив" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Вернуть в работу/ })).not.toBeInTheDocument();
  });

  it("does not infer delete permission from a leadership restore action", async () => {
    vi.mocked(fetchStories).mockResolvedValue({ items: [{ ...archived, delete_action: null,
      lifecycle_actions: [{ ...archived.delete_action!, code: "story_restore", label: "Вернуть в работу",
        method: "POST", href: "/api/v1/stories/101/restore", emphasis: "primary", confirmation: null }],
    }], total: 1 });
    render(<ArchivePage onOpenScenario={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Вернуть в работу/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Удалить/ })).not.toBeInTheDocument();
  });

  it("requires confirmation, focuses cancel, and returns focus without deleting", async () => {
    vi.mocked(fetchStories).mockResolvedValue({ items: [archived], total: 1 });
    const user = userEvent.setup();
    render(<ArchivePage onOpenScenario={vi.fn()} />);
    const trigger = await screen.findByRole("button", { name: "Удалить: Синтетический архив" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Удалить сюжет навсегда?" });
    expect(within(dialog).getByText("Синтетический архив")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(runStoryLifecycleAction).not.toHaveBeenCalled();
  });

  it("keeps a failed deletion retryable and only refreshes after an acknowledged delete", async () => {
    vi.mocked(fetchStories).mockResolvedValueOnce({ items: [archived], total: 1 })
      .mockRejectedValueOnce(new Error("Не удалось обновить архив"))
      .mockResolvedValue({ items: [], total: 0 });
    vi.mocked(runStoryLifecycleAction).mockRejectedValueOnce(new Error("Не удалось удалить"))
      .mockResolvedValue(ack);
    const user = userEvent.setup();
    render(<ArchivePage onOpenScenario={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Удалить: Синтетический архив" }));
    await user.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось удалить");
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Архив" })).toHaveFocus());
    expect(screen.getByRole("link", { name: "Открыть сценарий сюжета Синтетический архив" })).toBeVisible();
    expect(screen.getByText("Показано 1 из 1")).toBeVisible();
    expect(screen.getByText("Команда подтверждена. Ожидается обновление архива…")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Удалить: Синтетический архив" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось обновить архив");
    await user.click(screen.getByRole("button", { name: "Повторить обновление" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("Показано 0 из 0")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Архив" })).toHaveFocus());
    expect(runStoryLifecycleAction).toHaveBeenCalledTimes(2);
    expect(runStoryLifecycleAction).toHaveBeenLastCalledWith(archived.delete_action);
    expect(fetchStories).toHaveBeenCalledTimes(3);
  });

  it("preserves a live title-link focus chosen while a restore command is pending", async () => {
    const restore = { ...archived.delete_action!, code: "story_restore", label: "Вернуть в работу",
      method: "POST", href: "/api/v1/stories/101/restore", emphasis: "primary", confirmation: null } as const;
    const restorable = { ...archived, lifecycle_actions: [restore], delete_action: null };
    const other = { ...archived, id: 202, title: "Другой синтетический архив",
      delete_action: { ...archived.delete_action!, href: "/api/v1/stories/202" } };
    vi.mocked(fetchStories).mockResolvedValueOnce({ items: [restorable, other], total: 2 })
      .mockResolvedValueOnce({ items: [other], total: 1 });
    let resolveCommand!: (value: typeof ack) => void;
    vi.mocked(runStoryLifecycleAction).mockImplementation(() => new Promise((done) => { resolveCommand = done; }));
    const user = userEvent.setup();
    render(<ArchivePage onOpenScenario={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Вернуть в работу: Синтетический архив" }));
    const otherLink = screen.getByRole("link", { name: "Открыть сценарий сюжета Другой синтетический архив" });
    await user.click(otherLink);
    expect(otherLink).toHaveFocus();
    await act(async () => resolveCommand(ack));

    await waitFor(() => expect(screen.getByText("Показано 1 из 1")).toBeVisible());
    await act(async () => new Promise<void>((done) => requestAnimationFrame(() => done())));
    expect(otherLink).toHaveFocus();
  });

  it("keeps the acknowledged row and count until the canonical refresh resolves", async () => {
    let resolveRefresh!: (value: { items: StoryListItem[]; total: number }) => void;
    vi.mocked(fetchStories).mockResolvedValueOnce({ items: [archived], total: 1 })
      .mockImplementationOnce(() => new Promise((done) => { resolveRefresh = done; }));
    vi.mocked(runStoryLifecycleAction).mockResolvedValue(ack);
    const user = userEvent.setup();
    render(<ArchivePage onOpenScenario={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Удалить: Синтетический архив" }));
    await user.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await waitFor(() => expect(screen.getByRole("heading", { name: "Архив" })).toHaveFocus());
    expect(screen.getByRole("link", { name: "Открыть сценарий сюжета Синтетический архив" })).toBeVisible();
    expect(screen.getByText("Показано 1 из 1")).toBeVisible();
    expect(screen.getByText("Команда подтверждена. Ожидается обновление архива…")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Удалить: Синтетический архив" })).not.toBeInTheDocument();

    await act(async () => resolveRefresh({ items: [], total: 0 }));
    await waitFor(() => expect(screen.getByText("Показано 0 из 0")).toBeVisible());
    expect(screen.queryByText("Команда подтверждена. Ожидается обновление архива…")).not.toBeInTheDocument();
  });

  it("retries only the canonical GET after an acknowledged restore", async () => {
    const restore = { ...archived.delete_action!, code: "story_restore", label: "Вернуть в работу",
      method: "POST", href: "/api/v1/stories/101/restore", emphasis: "primary", confirmation: null } as const;
    const restorable = { ...archived, lifecycle_actions: [restore], delete_action: null };
    vi.mocked(fetchStories).mockResolvedValueOnce({ items: [restorable], total: 1 })
      .mockRejectedValueOnce(new Error("Не удалось обновить архив"))
      .mockResolvedValueOnce({ items: [], total: 0 });
    vi.mocked(runStoryLifecycleAction).mockResolvedValue(ack);
    const user = userEvent.setup();
    render(<ArchivePage onOpenScenario={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Вернуть в работу: Синтетический архив" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось обновить архив");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Архив" })).toHaveFocus());
    expect(screen.getByRole("link", { name: "Открыть сценарий сюжета Синтетический архив" })).toBeVisible();
    expect(screen.getByText("Показано 1 из 1")).toBeVisible();
    expect(screen.getByText("Команда подтверждена. Ожидается обновление архива…")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Вернуть в работу: Синтетический архив" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Повторить обновление" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByText("Показано 0 из 0")).toBeVisible();
    expect(runStoryLifecycleAction).toHaveBeenCalledTimes(1);
    expect(runStoryLifecycleAction).toHaveBeenCalledWith(restore);
    expect(fetchStories).toHaveBeenCalledTimes(3);
  });

  it("does not steal focus after the user moves elsewhere while refresh is pending", async () => {
    let resolveRefresh!: (value: { items: StoryListItem[]; total: number }) => void;
    vi.mocked(fetchStories).mockResolvedValueOnce({ items: [archived], total: 1 })
      .mockImplementationOnce(() => new Promise((done) => { resolveRefresh = done; }));
    vi.mocked(runStoryLifecycleAction).mockResolvedValue(ack);
    const user = userEvent.setup();
    render(<><button>Внешнее действие</button><ArchivePage onOpenScenario={vi.fn()} /></>);
    await user.click(await screen.findByRole("button", { name: "Удалить: Синтетический архив" }));
    await user.click(screen.getByRole("button", { name: "Удалить навсегда" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Архив" })).toHaveFocus());

    const outside = screen.getByRole("button", { name: "Внешнее действие" });
    await user.click(outside);
    await act(async () => resolveRefresh({ items: [], total: 0 }));
    await waitFor(() => expect(screen.getByText("Показано 0 из 0")).toBeVisible());
    expect(outside).toHaveFocus();
  });

  it("sends one pending command and ignores its completion after unmount", async () => {
    vi.mocked(fetchStories).mockResolvedValue({ items: [archived], total: 1 });
    let resolve!: (value: typeof ack) => void;
    vi.mocked(runStoryLifecycleAction).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<ArchivePage onOpenScenario={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить: Синтетический архив" }));
    const confirm = screen.getByRole("button", { name: "Удалить навсегда" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(runStoryLifecycleAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled();
    view.unmount();
    await act(async () => resolve(ack));
    expect(fetchStories).toHaveBeenCalledTimes(1);
  });
  it("restores focus only after the acknowledged delete dialog is removed, even when a frame runs before React commits", async () => {
    vi.mocked(fetchStories).mockResolvedValueOnce({ items: [archived], total: 1 })
      .mockRejectedValueOnce(new Error("Не удалось обновить архив"));
    vi.mocked(runStoryLifecycleAction).mockResolvedValue(ack);
    const user = userEvent.setup();
    render(<ArchivePage onOpenScenario={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Удалить: Синтетический архив" }));
    // A browser frame may run before the queued React state update commits.
    const earlyFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    try {
      await user.click(screen.getByRole("button", { name: "Удалить навсегда" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось обновить архив");
      await waitFor(() => expect(screen.getByRole("heading", { name: "Архив" })).toHaveFocus());
      expect(runStoryLifecycleAction).toHaveBeenCalledTimes(1);
    } finally {
      earlyFrame.mockRestore();
    }
  });

});
