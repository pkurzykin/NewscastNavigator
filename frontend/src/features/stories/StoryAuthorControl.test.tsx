import { render, screen, waitFor } from "@testing-library/react";
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
const mutate = async (command: () => Promise<unknown>) => { await command(); };

describe("StoryAuthorControl", () => {
  it("shows no command without server management rights", () => {
    render(<StoryAuthorControl mutationPending={false} onMutate={mutate} story={{ ...story, management: null }} onChanged={vi.fn()} />);
    expect(screen.getByText("Лира")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("saves an explicit author selection immediately and never allows an empty author", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    vi.mocked(updateStoryManagement).mockResolvedValue({} as never);
    vi.mocked(fetchStory).mockResolvedValue({ ...story, author: nextAuthor });
    render(<StoryAuthorControl mutationPending={false} onMutate={mutate} story={story} onChanged={onChanged} />);
    const input = screen.getByRole("combobox", { name: "Ответственный: Автор" });
    await user.clear(input);
    await user.type(input, "Вег");
    await user.keyboard("{ArrowDown}");
    expect(updateStoryManagement).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: "Без исполнителя" })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ author: nextAuthor, management: story.management }));
    expect(updateStoryManagement).toHaveBeenCalledWith(story.management!.action, { author_user_id: 2 });
    expect(screen.queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
  });

  it("preserves selected author on failure and retries only a failed refresh after acknowledgement", async () => {
    const user = userEvent.setup();
    vi.mocked(updateStoryManagement).mockRejectedValueOnce(new Error("Нет связи")).mockResolvedValue({} as never);
    vi.mocked(fetchStory).mockRejectedValueOnce(new Error("Не удалось обновить")).mockResolvedValue({ ...story, author: nextAuthor });
    render(<StoryAuthorControl mutationPending={false} onMutate={mutate} story={story} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: "Ответственный: Автор" }));
    await user.click(await screen.findByRole("option", { name: "Вега" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет связи");
    expect(screen.getByRole("combobox", { name: "Ответственный: Автор" })).toHaveValue("Вега");
    await user.click(screen.getByRole("button", { name: "Повторить назначение автора" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось обновить");
    await user.click(screen.getByRole("button", { name: "Повторить обновление автора" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(updateStoryManagement).toHaveBeenCalledTimes(2);
    expect(fetchStory).toHaveBeenCalledTimes(2);
  });

  it("ignores a response for a previously opened story", async () => {
    let resolve!: () => void;
    vi.mocked(updateStoryManagement).mockImplementation(() => new Promise((done) => { resolve = () => done({} as never); }));
    const onChanged = vi.fn();
    const view = render(<StoryAuthorControl mutationPending={false} onMutate={mutate} story={story} onChanged={onChanged} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Ответственный: Автор" }));
    await user.click(await screen.findByRole("option", { name: "Вега" }));
    view.rerender(<StoryAuthorControl mutationPending={false} onMutate={mutate} story={{ ...story, id: 102 }} onChanged={onChanged} />);
    resolve();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Ответственный: Автор" })).toHaveValue("Лира"));
    expect(onChanged).not.toHaveBeenCalled();
    expect(fetchStory).not.toHaveBeenCalled();
  });
  it("blocks author selection during another production mutation", () => {
    render(<StoryAuthorControl story={story} onChanged={vi.fn()} mutationPending onMutate={mutate} />);
    expect(screen.getByRole("combobox", { name: "Ответственный: Автор" })).toBeDisabled();
  });
  it("keeps an unavailable current author visible without allowing selection of that option", async () => {
    const user = userEvent.setup();
    render(<StoryAuthorControl story={{ ...story, management: { ...story.management!, author_options: [nextAuthor] } }}
      onChanged={vi.fn()} mutationPending={false} onMutate={mutate} />);
    const input = screen.getByRole("combobox", { name: "Ответственный: Автор" });
    expect(input).toHaveValue("Лира");
    await user.click(input);
    expect(await screen.findByRole("option", { name: "Лира" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "Вега" })).not.toHaveAttribute("aria-disabled", "true");
    expect(updateStoryManagement).not.toHaveBeenCalled();
  });

});
