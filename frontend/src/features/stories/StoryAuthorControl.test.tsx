import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import StoryAuthorControl from "./components/StoryAuthorControl";
import { fetchStory, updateStoryManagement } from "./api";
import type { StoryListItem } from "./types";

vi.mock("./api", () => ({ fetchStory: vi.fn(), updateStoryManagement: vi.fn() }));
const author = { id: 1, username: "lira", display_name: "Лира", position: "Автор", function_codes: ["author"] };
const nextAuthor = { ...author, id: 2, username: "vega", display_name: "Вега" };
const story = {
  id: 101, title: "Синтетический сюжет", author,
  management: {
    action: { code: "story_management_update", label: "Изменить", method: "PATCH", href: "/api/v1/stories/101/management", emphasis: "normal", confirmation: null, form: null },
    author_options: [author, nextAuthor], priority_options: [],
  },
} as StoryListItem;
afterEach(() => vi.resetAllMocks());

describe("StoryAuthorControl", () => {
  it("shows no command without server management rights", () => {
    render(<StoryAuthorControl story={{ ...story, management: null }} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
  });

  it("saves with server management rights and options, then returns focus", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(updateStoryManagement).mockResolvedValue({} as never);
    vi.mocked(fetchStory).mockResolvedValue({ ...story, author: nextAuthor });
    render(<StoryAuthorControl story={story} onChanged={onChanged} />);
    const trigger = screen.getByRole("button", { name: "Изменить" });
    await user.click(trigger);
    const select = screen.getByRole("combobox", { name: "Автор" });
    await user.selectOptions(select, "2");
    expect(updateStoryManagement).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: "Без автора" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ author: nextAuthor, management: story.management }));
    expect(updateStoryManagement).toHaveBeenCalledWith(story.management!.action, { author_user_id: 2 });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("preserves selected author on failure and retries only a failed refresh after acknowledgement", async () => {
    const user = userEvent.setup();
    vi.mocked(updateStoryManagement).mockRejectedValueOnce(new Error("Нет связи")).mockResolvedValue({} as never);
    vi.mocked(fetchStory).mockRejectedValueOnce(new Error("Не удалось обновить")).mockResolvedValue({ ...story, author: nextAuthor });
    render(<StoryAuthorControl story={story} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Изменить" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Автор" }), "2");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет связи");
    expect(screen.getByRole("combobox", { name: "Автор" })).toHaveValue("2");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось обновить");
    await user.click(screen.getByRole("button", { name: "Повторить обновление" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateStoryManagement).toHaveBeenCalledTimes(2);
    expect(fetchStory).toHaveBeenCalledTimes(2);
  });

  it("ignores a response for a previously opened story", async () => {
    let resolve!: () => void;
    vi.mocked(updateStoryManagement).mockImplementation(() => new Promise((done) => { resolve = () => done({} as never); }));
    const onChanged = vi.fn();
    const view = render(<StoryAuthorControl story={story} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Автор" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    view.rerender(<StoryAuthorControl story={{ ...story, id: 102 }} onChanged={onChanged} />);
    resolve();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
    expect(fetchStory).not.toHaveBeenCalled();
  });
});
