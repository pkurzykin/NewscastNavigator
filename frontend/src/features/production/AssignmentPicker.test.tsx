import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssignmentPicker from "./components/AssignmentPicker";
import { removeAssignment, setAssignment } from "./api";
import type { ProductionReadModel } from "./types";
import { createDeferred } from "../../test/deferred";
vi.mock("./api", () => ({ removeAssignment: vi.fn(), setAssignment: vi.fn() }));
const editor = { id: 3, username: "vega", display_name: "Вега", position: "Монтажёр", function_codes: ["video_editor"] };
const second = { ...editor, id: 4, username: "orion", display_name: "Орион" };
const model = { story: { id: 101 }, assignments: [{ kind: "video_editor", user: editor }], assignee_options: [editor, second], can_manage_assignments: true } as ProductionReadModel;
const mutate = async (command: () => Promise<unknown>) => { await command(); };
afterEach(() => vi.resetAllMocks());

describe("AssignmentPicker", () => {
  it("only commits an explicit choice, while search and arrow keys send nothing", async () => {
    const user = userEvent.setup();
    render(<AssignmentPicker production={model} mutationPending={false} onMutate={mutate} />);
    const input = screen.getByRole("combobox", { name: "Ответственный: Монтажёр" });
    await user.clear(input);
    await user.type(input, "Ори");
    await user.keyboard("{ArrowDown}");
    expect(setAssignment).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(setAssignment).toHaveBeenCalledWith(101, "video_editor", 4));
    expect(screen.queryByRole("button", { name: "Сохранить" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Снять" })).not.toBeInTheDocument();
  });

  it("removes an assignment through Без исполнителя", async () => {
    const user = userEvent.setup();
    render(<AssignmentPicker production={model} mutationPending={false} onMutate={mutate} />);
    await user.click(screen.getByRole("combobox", { name: "Ответственный: Монтажёр" }));
    await user.click(await screen.findByRole("option", { name: "Без исполнителя" }));
    await waitFor(() => expect(removeAssignment).toHaveBeenCalledWith(101, "video_editor"));
  });

  it("keeps a failed choice with a retry and clears its error after success", async () => {
    vi.mocked(setAssignment).mockRejectedValueOnce(new Error("Нет связи")).mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<AssignmentPicker production={model} mutationPending={false} onMutate={mutate} />);
    const input = screen.getByRole("combobox", { name: "Ответственный: Монтажёр" });
    await user.click(input);
    await user.click(await screen.findByRole("option", { name: "Орион" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет связи");
    expect(input).toHaveValue("Орион");
    await user.click(screen.getByRole("button", { name: "Повторить назначение" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(setAssignment).toHaveBeenCalledTimes(2);
  });

  it("keeps an acknowledged choice until assignments confirm the selected user", async () => {
    const user = userEvent.setup();
    const coordinator = async (command: () => Promise<unknown>) => {
      await command();
      return { commandAcknowledged: true, refreshApplied: true };
    };
    const view = render(<AssignmentPicker production={model} mutationPending={false} onMutate={coordinator} />);
    const input = screen.getByRole("combobox", { name: "Ответственный: Монтажёр" });
    await user.click(input);
    await user.click(await screen.findByRole("option", { name: "Орион" }));

    await waitFor(() => expect(input).toHaveValue("Орион"));
    view.rerender(<AssignmentPicker production={{
      ...model,
      assignments: [{ kind: "video_editor", user: second }],
    }} mutationPending={false} onMutate={coordinator} />);
    await waitFor(() => expect(input).toHaveValue("Орион"));
  });

  it("keeps the proofreader visible in production for read-only viewers", () => {
    render(<AssignmentPicker production={{ ...model, can_manage_assignments: false, assignments: [...model.assignments, { kind: "proofreader", user: { ...editor, display_name: "Сириус" } }] }} mutationPending={false} onMutate={mutate} />);
    expect(screen.getByText("Сириус")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("ignores a stale assignment failure after switching to another story", async () => {
    const deferred = createDeferred<void>();
    const user = userEvent.setup();
    const view = render(<AssignmentPicker production={model} mutationPending={false} onMutate={() => deferred.promise} />);
    const oldInput = screen.getByRole("combobox", { name: "Ответственный: Монтажёр" });
    await user.click(oldInput);
    await user.click(await screen.findByRole("option", { name: "Орион" }));

    const nextAssignee = { ...editor, id: 8, username: "sirius", display_name: "Сириус" };
    const nextModel = {
      ...model,
      story: { ...model.story, id: 202 },
      assignments: [{ kind: "video_editor", user: nextAssignee }],
      assignee_options: [nextAssignee],
    } as ProductionReadModel;
    view.rerender(<AssignmentPicker production={nextModel} mutationPending={false} onMutate={mutate} />);
    const nextInput = screen.getByRole("combobox", { name: "Ответственный: Монтажёр" });
    await waitFor(() => expect(nextInput).toHaveValue("Сириус"));

    await act(async () => deferred.reject(new Error("Старый ответ")));
    await waitFor(() => expect(nextInput).toHaveValue("Сириус"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
