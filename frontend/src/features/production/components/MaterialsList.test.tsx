import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MaterialsList from "./MaterialsList";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (originalExecCommand) Object.defineProperty(document, "execCommand", originalExecCommand);
  else Reflect.deleteProperty(document, "execCommand");
});
function clipboard(writeText?: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}
function show(location: string) {
  render(<MaterialsList storyId={101} canAdd={false} mutationPending={false} onMutate={vi.fn()} materials={[{
    id: 1, title: "Синтетический материал", location,
    added_by: { id: 2, username: "lira", display_name: "Лира", position: "Автор", function_codes: ["author"] },
    added_at: "2026-07-20T09:00:00Z",
  }]} />);
}

describe("material links and copying", () => {
  it("uses the shared MUI dialog and fields for a new material", () => {
    render(<MaterialsList storyId={101} canAdd mutationPending={false} onMutate={vi.fn()} materials={[]} />);
    const trigger = screen.getByRole("button", { name: "Добавить материал" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Добавить материал" });
    expect(dialog).toHaveClass("MuiDialog-paper");
    const title = screen.getByLabelText("Название материала");
    expect(title.closest(".MuiInputBase-root")).not.toBeNull();
    expect(screen.getByLabelText("Путь или ссылка").closest(".MuiInputBase-root")).not.toBeNull();
    expect(title).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(trigger).toHaveFocus();
  });

  it("opens HTTP links in a separate tab without granting opener access", () => {
    show("https://example.invalid/media?q=1");
    const link = screen.getByRole("link", { name: "https://example.invalid/media?q=1" });
    expect(link).toHaveAttribute("href", "https://example.invalid/media?q=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("copies network addresses for both operating systems and acknowledges actual success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    show("smb://news/share/Сюжет%201");
    fireEvent.click(screen.getByRole("button", { name: "Копировать путь для Windows" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("\\\\news\\share\\Сюжет 1"));
    expect(await screen.findByRole("status")).toHaveTextContent("Путь скопирован");
    fireEvent.click(screen.getByRole("button", { name: "Копировать путь для Linux" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("smb://news/share/%D0%A1%D1%8E%D0%B6%D0%B5%D1%82%201"));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("copies a quoted local path without inventing another platform's address", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    show("'/Volumes/synthetic/Съёмка 1.mov'");
    fireEvent.click(screen.getByRole("button", { name: "Копировать путь" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/Volumes/synthetic/Съёмка 1.mov"));
    expect(screen.queryByRole("button", { name: /для Windows/ })).not.toBeInTheDocument();
  });
  it("offers a selected manual copy field when both browser copy mechanisms fail", async () => {
    clipboard(vi.fn().mockRejectedValue(new Error("denied")));
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    show("/synthetic/materials");
    fireEvent.click(screen.getByRole("button", { name: "Копировать путь" }));
    const field = await screen.findByRole("textbox", { name: "Путь для ручного копирования" });
    expect(field.closest(".MuiInputBase-root")).not.toBeNull();
    expect(field).toHaveValue("/synthetic/materials");
    expect(field).toHaveFocus();
    expect((field as HTMLTextAreaElement).selectionEnd).toBe("/synthetic/materials".length);
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось скопировать автоматически");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("supports copying on HTTP intranet pages without Clipboard API and restores focus", async () => {
    clipboard();
    let copied = "";
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    }) });
    show("/synthetic/materials");
    const button = screen.getByRole("button", { name: "Копировать путь" });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("Путь скопирован");
    expect(copied).toBe("/synthetic/materials");
    expect(button).toHaveFocus();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("never makes executable schemes clickable", () => {
    show("javascript:alert(1)");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });
});
