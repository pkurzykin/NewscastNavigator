import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReleaseNote } from "./releaseNotes";
import WhatsNewDialog from "./WhatsNewDialog";

const releaseNote: ReleaseNote = {
  version: "1.2.0",
  title: "Что нового в версии 1.2.0",
  intro: "Редактор стал быстрее и удобнее для ежедневной работы.",
  items: [
    "Умные русские кавычки, поиск и замена, а также общие отмена и повтор действий.",
    "Блоки сценария можно перетаскивать; кнопки перемещения и клавиатура по-прежнему доступны.",
    "В список шрифтов добавлен Franklin Gothic Book.",
    "Уведомления обновляются автоматически, а шапка стала аккуратнее на широких экранах.",
    "Исправлен ввод знака + в именах файлов.",
  ],
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("WhatsNewDialog", () => {
  it("shows the approved note on first mount, focuses the action and traps Tab", () => {
    render(
      <WhatsNewDialog
        userId={17}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Что нового в версии 1.2.0" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText(releaseNote.intro)).toBeVisible();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(5);
    const continueButton = within(dialog).getByRole("button", { name: "Продолжить работу" });
    expect(continueButton).toHaveFocus();
    expect(fireEvent.keyDown(document, { key: "Tab" })).toBe(false);
    expect(continueButton).toHaveFocus();
    expect(fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).toBe(false);
    expect(continueButton).toHaveFocus();
  });

  it("dismisses through the primary action, stores one mark and stays hidden after remount", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const first = render(
      <WhatsNewDialog
        userId={17}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Продолжить работу" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("newscast:whats-new:17:1.2.0")).toBe("seen");
    expect(onDismiss).toHaveBeenCalledOnce();

    first.unmount();
    render(
      <WhatsNewDialog
        userId={17}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows independently for another user and another version", async () => {
    window.localStorage.setItem("newscast:whats-new:17:1.2.0", "seen");
    const { rerender } = render(
      <WhatsNewDialog
        userId={17}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <WhatsNewDialog
        userId={18}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={vi.fn()}
      />,
    );
    expect(await screen.findByRole("dialog", { name: releaseNote.title })).toBeInTheDocument();

    rerender(
      <WhatsNewDialog
        userId={17}
        version="1.3.0"
        releaseNote={{ ...releaseNote, version: "1.3.0", title: "Что нового в версии 1.3.0" }}
        onDismiss={vi.fn()}
      />,
    );
    expect(await screen.findByRole("dialog", { name: "Что нового в версии 1.3.0" }))
      .toBeInTheDocument();
  });

  it("dismisses on Escape and backdrop, ignores inside clicks and restores prior focus", async () => {
    const onDismiss = vi.fn();
    const { container, rerender } = render(<button type="button">Рабочее действие</button>);
    const workButton = screen.getByRole("button", { name: "Рабочее действие" });
    workButton.focus();
    rerender(
      <>
        <button type="button">Рабочее действие</button>
        <WhatsNewDialog
          userId={17}
          version="1.2.0"
          releaseNote={releaseNote}
          onDismiss={onDismiss}
        />
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: releaseNote.title });
    fireEvent.mouseDown(dialog);
    expect(dialog).toBeInTheDocument();
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(screen.getByRole("button", { name: "Рабочее действие" })).toHaveFocus();
    expect(onDismiss).toHaveBeenCalledOnce();

    window.localStorage.removeItem("newscast:whats-new:17:1.2.0");
    rerender(
      <>
        <button type="button">Рабочее действие</button>
        <WhatsNewDialog
          key="backdrop"
          userId={17}
          version="1.2.0"
          releaseNote={releaseNote}
          onDismiss={onDismiss}
        />
      </>,
    );
    const backdrop = container.querySelector<HTMLElement>(".whats-new-backdrop");
    expect(backdrop).toBeInTheDocument();
    fireEvent.mouseDown(backdrop!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("survives storage read and write errors and still closes for the current mount", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage read denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage write denied");
    });
    const user = userEvent.setup();
    render(
      <WhatsNewDialog
        userId={17}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: releaseNote.title })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Продолжить работу" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing without a release note for the requested version", () => {
    render(
      <WhatsNewDialog
        userId={17}
        version="9.9.9"
        releaseNote={null}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
