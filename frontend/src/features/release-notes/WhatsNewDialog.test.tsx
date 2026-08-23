import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

const closedKeyTransitions: Array<{
  label: string;
  version: string;
  note: ReleaseNote | null;
  seenStorageKey?: string;
}> = [
  {
    label: "a missing release note",
    version: "9.9.9",
    note: null,
  },
  {
    label: "an already-seen release note",
    version: "1.3.0",
    note: {
      ...releaseNote,
      version: "1.3.0",
      title: "Что нового в версии 1.3.0",
    },
    seenStorageKey: "newscast:whats-new:17:1.3.0",
  },
];

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

  it("restores the external focus after StrictMode replays the modal effect", async () => {
    const { rerender } = render(<button type="button">Внешнее действие</button>);
    const externalButton = screen.getByRole("button", { name: "Внешнее действие" });
    externalButton.focus();

    rerender(
      <>
        <button type="button">Внешнее действие</button>
        <StrictMode>
          <WhatsNewDialog
            userId={17}
            version="1.2.0"
            releaseNote={releaseNote}
            onDismiss={vi.fn()}
          />
        </StrictMode>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Продолжить работу" }));
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(screen.getByRole("button", { name: "Внешнее действие" })).toHaveFocus();
  });

  it("falls back to a usable main action when the previous focus target becomes disabled", async () => {
    const { rerender } = render(
      <>
        <button type="button">Предыдущее действие</button>
        <main><button type="button">Основное действие</button></main>
      </>,
    );
    const previous = screen.getByRole("button", { name: "Предыдущее действие" });
    previous.focus();
    rerender(
      <>
        <button type="button">Предыдущее действие</button>
        <main><button type="button">Основное действие</button></main>
        <WhatsNewDialog
          userId={17}
          version="1.2.0"
          releaseNote={releaseNote}
          onDismiss={vi.fn()}
        />
      </>,
    );
    (screen.getByRole("button", { name: "Предыдущее действие" }) as HTMLButtonElement)
      .disabled = true;

    fireEvent.click(screen.getByRole("button", { name: "Продолжить работу" }));
    await act(async () => { await new Promise(requestAnimationFrame); });

    expect(screen.getByRole("button", { name: "Основное действие" })).toHaveFocus();
  });

  it.each(closedKeyTransitions)(
    "cancels a pending focus restore when the key changes to $label",
    ({ version, note, seenStorageKey }) => {
      let nextFrameId = 0;
      const pendingFrames = new Map<number, FrameRequestCallback>();
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        nextFrameId += 1;
        pendingFrames.set(nextFrameId, callback);
        return nextFrameId;
      });
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
        pendingFrames.delete(frameId);
      });
      if (seenStorageKey) window.localStorage.setItem(seenStorageKey, "seen");

      const { rerender } = render(
        <>
          <button type="button">Предыдущее действие</button>
          <button type="button">Текущее действие</button>
        </>,
      );
      screen.getByRole("button", { name: "Предыдущее действие" }).focus();
      rerender(
        <>
          <button type="button">Предыдущее действие</button>
          <button type="button">Текущее действие</button>
          <WhatsNewDialog
            userId={17}
            version="1.2.0"
            releaseNote={releaseNote}
            onDismiss={vi.fn()}
          />
        </>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Продолжить работу" }));

      rerender(
        <>
          <button type="button">Предыдущее действие</button>
          <button type="button">Текущее действие</button>
          <WhatsNewDialog
            userId={17}
            version={version}
            releaseNote={note}
            onDismiss={vi.fn()}
          />
        </>,
      );
      const currentButton = screen.getByRole("button", { name: "Текущее действие" });
      currentButton.focus();
      act(() => {
        const callbacks = [...pendingFrames.values()];
        pendingFrames.clear();
        callbacks.forEach((callback) => callback(16));
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(currentButton).toHaveFocus();
    },
  );

  it("resolves an already-seen key transition before it can render or move focus", () => {
    const nextReleaseNote = {
      ...releaseNote,
      version: "1.3.0",
      title: "Что нового в версии 1.3.0",
    };
    window.localStorage.setItem("newscast:whats-new:17:1.3.0", "seen");
    const { rerender } = render(
      <>
        <button type="button">Внешнее действие</button>
        <WhatsNewDialog
          userId={17}
          version="1.2.0"
          releaseNote={releaseNote}
          onDismiss={vi.fn()}
        />
      </>,
    );
    expect(screen.getByRole("dialog", { name: releaseNote.title })).toBeInTheDocument();
    const externalButton = screen.getByRole("button", { name: "Внешнее действие" });
    externalButton.focus();

    rerender(
      <>
        <button type="button">Внешнее действие</button>
        <WhatsNewDialog
          userId={17}
          version="1.3.0"
          releaseNote={nextReleaseNote}
          onDismiss={vi.fn()}
        />
      </>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Внешнее действие" })).toHaveFocus();
  });

  it("remembers every dismissed key for the current mount when storage writes fail", () => {
    const storageWrite = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage write denied");
    });
    const onDismiss = vi.fn();
    const { rerender } = render(
      <WhatsNewDialog
        userId={17}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Продолжить работу" }));
    rerender(
      <WhatsNewDialog
        userId={17}
        version="9.9.9"
        releaseNote={null}
        onDismiss={onDismiss}
      />,
    );
    rerender(
      <WhatsNewDialog
        userId={17}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(storageWrite).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("isolates modal shortcuts from page handlers without swallowing normal keys", () => {
    const deliveredKeys: string[] = [];
    const pageKeyboardHandler = (event: KeyboardEvent) => deliveredKeys.push(event.key);
    window.addEventListener("keydown", pageKeyboardHandler);
    render(
      <WhatsNewDialog
        userId={17}
        version="1.2.0"
        releaseNote={releaseNote}
        onDismiss={vi.fn()}
      />,
    );
    const continueButton = screen.getByRole("button", { name: "Продолжить работу" });

    expect(fireEvent.keyDown(continueButton, { key: "f", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(continueButton, { key: "z", metaKey: true })).toBe(false);
    expect(fireEvent.keyDown(continueButton, { key: "Tab" })).toBe(false);
    expect(fireEvent.keyDown(continueButton, { key: "c", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(continueButton, { key: "a" })).toBe(true);
    expect(deliveredKeys).toEqual([]);
    expect(fireEvent.keyDown(continueButton, { key: "Escape" })).toBe(false);
    expect(deliveredKeys).toEqual([]);

    window.removeEventListener("keydown", pageKeyboardHandler);
  });

  it("survives storage read and write errors and still closes for the current mount", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage read denied");
    });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
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
