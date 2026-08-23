import { Editor } from "@tiptap/core";
import { act, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorCoreField } from "./EditorField";
import { createEditorCoreExtensions } from "./extensions";
import type { ScenarioTextFieldController } from "../scenario/scenarioTextFields";

const editors: Editor[] = [];

function createEditor(content: string): { editor: Editor; element: HTMLDivElement } {
  const element = document.createElement("div");
  const editor = new Editor({ element, extensions: createEditorCoreExtensions(), content });
  editors.push(editor);
  return { editor, element };
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("SearchHighlightExtension", () => {
  it("renders normal and active decorations without serializing them", () => {
    const { editor, element } = createEditor("<p>один два один</p>");
    const json = editor.getJSON();
    const html = editor.getHTML();

    editor.commands.setSearchHighlights([
      { from: 1, to: 5, active: false },
      { from: 10, to: 14, active: true },
    ]);

    expect([...element.querySelectorAll(".scenario-search-highlight")].map((node) => node.textContent))
      .toEqual(["один", "один"]);
    expect(element.querySelector(".scenario-search-highlight-active")?.textContent).toBe("один");
    expect(editor.getJSON()).toEqual(json);
    expect(editor.getHTML()).toBe(html);

    editor.commands.clearSearchHighlights();
    expect(element.querySelectorAll(".scenario-search-highlight")).toHaveLength(0);
  });

  it("maps existing decorations through later document transactions", () => {
    const { editor, element } = createEditor("<p>один два</p>");
    editor.commands.setSearchHighlights([{ from: 1, to: 5, active: true }]);

    editor.commands.insertContentAt(1, "X ");

    expect(element.querySelector(".scenario-search-highlight-active")?.textContent).toBe("один");
    expect(editor.getText()).toBe("X один два");
  });
});

describe("EditorCoreField search controller", () => {
  it("highlights original UTF-16 offsets beside a surrogate and expanded fold character", async () => {
    let controller: ScenarioTextFieldController | null = null;
    const view = render(
      createElement(EditorCoreField, {
        editorId: "seg-unicode:text",
        richTextTarget: null,
        plainTextValue: "😀İТЕКСТ!",
        disabled: false,
        placeholder: "Текст",
        className: "test-field",
        ariaLabel: "Текст блока 1",
        onFocusField: vi.fn(),
        onChangeValue: vi.fn(),
        onRegister: (
          _id: string,
          _editor: Editor | null,
          currentController: ScenarioTextFieldController | null,
        ) => { controller = currentController; },
        onSelectionChange: vi.fn(),
      } as never),
    );
    await waitFor(() => expect(controller).not.toBeNull());

    act(() => controller?.setSearchHighlights([{ from: 3, to: 8, active: true }]));

    expect(view.container.querySelector(".scenario-search-highlight-active")?.textContent)
      .toBe("ТЕКСТ");
    view.unmount();
  });

  it("maps plain offsets to selection and decorations and unregisters the same field", async () => {
    const registrations: Array<{
      id: string;
      editor: Editor | null;
      controller: ScenarioTextFieldController | null;
    }> = [];
    const onRegister = (
      id: string,
      editor: Editor | null,
      controller: ScenarioTextFieldController | null,
    ) => registrations.push({ id, editor, controller });
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const view = render(
      createElement(EditorCoreField, {
        editorId: "seg-one:text",
        richTextTarget: null,
        plainTextValue: "Текст второй",
        disabled: false,
        placeholder: "Текст",
        className: "test-field",
        ariaLabel: "Текст блока 1",
        onFocusField: vi.fn(),
        onChangeValue: vi.fn(),
        onRegister,
        onSelectionChange: vi.fn(),
      } as never),
    );

    await waitFor(() => expect(registrations.some(({ controller }) => controller)).toBe(true));
    const registered = registrations.find(({ controller }) => controller);
    const controller = registered?.controller as ScenarioTextFieldController;
    const editor = registered?.editor as Editor;

    act(() => controller.setSearchHighlights([
      { from: 0, to: 5, active: false },
      { from: 6, to: 99, active: true },
      { from: Number.NaN, to: 2, active: false },
      { from: 0.5, to: 2, active: false },
    ]));
    expect(view.container.querySelectorAll(".scenario-search-highlight")).toHaveLength(2);
    expect(view.container.querySelector(".scenario-search-highlight")?.textContent).toBe("Текст");
    expect(view.container.querySelector(".scenario-search-highlight-active")?.textContent).toBe("второй");

    act(() => controller.focusRange(6, 12));
    await waitFor(() => expect(editor.isFocused).toBe(true));
    expect(editor.state.selection.from).toBe(7);
    expect(editor.state.selection.to).toBe(13);
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => controller.focusRange(0.5, 2));
    expect(editor.state.selection.from).toBe(7);
    expect(editor.state.selection.to).toBe(13);

    view.unmount();
    expect(registrations.at(-1)).toEqual({
      id: "seg-one:text",
      editor: null,
      controller: null,
    });
  });

  it("keeps one controller registration when parent callback identities change", async () => {
    const registrations: Array<{ editor: Editor | null; controller: ScenarioTextFieldController | null }> = [];
    const props = {
      editorId: "seg-stable:text",
      richTextTarget: null,
      plainTextValue: "Текст",
      disabled: false,
      placeholder: "Текст",
      className: "test-field",
      ariaLabel: "Текст блока 1",
      onFocusField: vi.fn(),
      onChangeValue: vi.fn(),
      onSelectionChange: vi.fn(),
    };
    const firstRegister = (_id: string, editor: Editor | null, controller: ScenarioTextFieldController | null) => {
      registrations.push({ editor, controller });
    };
    const secondRegister = (_id: string, editor: Editor | null, controller: ScenarioTextFieldController | null) => {
      registrations.push({ editor, controller });
    };
    const view = render(createElement(EditorCoreField, { ...props, onRegister: firstRegister } as never));
    await waitFor(() => expect(registrations.filter(({ editor }) => editor)).toHaveLength(1));
    registrations.length = 0;

    view.rerender(createElement(EditorCoreField, {
      ...props,
      disabled: true,
      onRegister: secondRegister,
    } as never));

    expect(registrations).toHaveLength(0);
  });
});
