import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditorCoreExtensions } from "./extensions";

const editors: Editor[] = [];

function createEditor(content = "", onUpdate = vi.fn()): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: createEditorCoreExtensions(),
    content,
    onUpdate,
  });
  editors.push(editor);
  return editor;
}

function handleKeyDown(
  editor: Editor,
  init: KeyboardEventInit & Pick<KeyboardEvent, "code" | "key">,
): boolean {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  return Boolean(editor.view.someProp("handleKeyDown", (handler) => (
    handler(editor.view, event)
  )));
}

function handleTextInput(editor: Editor, text: string): boolean {
  const { from, to } = editor.state.selection;
  return Boolean(editor.view.someProp("handleTextInput", (handler) => (
    handler(
      editor.view,
      from,
      to,
      text,
      () => editor.state.tr.insertText(text, from, to),
    )
  )));
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("TypographyKeyboardExtension", () => {
  it("inserts one U+2013 with active marks in one editor update", () => {
    const onUpdate = vi.fn();
    const editor = createEditor("<p><strong><em>До после</em></strong></p>", onUpdate);
    editor.commands.setTextSelection(3);

    expect(handleKeyDown(editor, { code: "NumpadSubtract", key: "-" })).toBe(true);

    expect(editor.getText()).toBe("До– после");
    expect(editor.getHTML()).toBe("<p><strong><em>До– после</em></strong></p>");
    expect([...editor.getText()].map((character) => character.codePointAt(0)))
      .toContain(0x2013);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("replaces a selection with one literal ASCII quote", () => {
    const onUpdate = vi.fn();
    const editor = createEditor("<p>до выбор после</p>", onUpdate);
    editor.commands.setTextSelection({ from: 4, to: 9 });

    expect(handleKeyDown(editor, { code: "Quote", key: '"', shiftKey: true })).toBe(true);

    expect(editor.getText()).toBe('до " после');
    expect(editor.state.selection.from).toBe(5);
    expect(editor.state.selection.to).toBe(5);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("handles every repeated numpad keydown as one insertion", () => {
    const onUpdate = vi.fn();
    const editor = createEditor("", onUpdate);

    expect(handleKeyDown(editor, { code: "NumpadSubtract", key: "-", repeat: false })).toBe(true);
    expect(handleKeyDown(editor, { code: "NumpadSubtract", key: "-", repeat: true })).toBe(true);

    expect(editor.getText()).toBe("\u2013\u2013");
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("leaves ordinary minus, Shift+Minus, apostrophe, Russian letters and at sign untouched", () => {
    const editor = createEditor("<p>основа</p>");
    editor.commands.setTextSelection(7);

    expect(handleKeyDown(editor, { code: "Minus", key: "-" })).toBe(false);
    expect(handleKeyDown(editor, { code: "Minus", key: "_", shiftKey: true })).toBe(false);
    expect(handleKeyDown(editor, { code: "Quote", key: "'" })).toBe(false);
    expect(handleKeyDown(editor, { code: "Quote", key: "э" })).toBe(false);
    expect(handleKeyDown(editor, { code: "Quote", key: "Э", shiftKey: true })).toBe(false);
    expect(handleKeyDown(editor, { code: "Digit2", key: "@", shiftKey: true })).toBe(false);
    expect(editor.getText()).toBe("основа");
  });

  it("keeps Shift+Digit2 and unknown-code quotes on the smart quote input path", () => {
    const editor = createEditor("");

    expect(handleKeyDown(editor, { code: "Digit2", key: '"', shiftKey: true })).toBe(false);
    expect(handleTextInput(editor, '"')).toBe(true);
    expect(editor.getText()).toBe("«»");

    editor.commands.setContent("");
    expect(handleKeyDown(editor, { code: "Unidentified", key: '"', shiftKey: true })).toBe(false);
    expect(handleTextInput(editor, '"')).toBe(true);
    expect(editor.getText()).toBe("«»");
  });

  it("does not change readonly or composing editors", () => {
    const editor = createEditor("<p>текст</p>");
    editor.commands.setTextSelection(6);
    editor.setEditable(false, false);

    expect(handleKeyDown(editor, { code: "NumpadSubtract", key: "-" })).toBe(false);
    expect(editor.getText()).toBe("текст");

    editor.setEditable(true, false);
    expect(handleKeyDown(editor, {
      code: "Minus",
      key: "-",
      altKey: true,
      isComposing: true,
    })).toBe(false);
    expect(editor.getText()).toBe("текст");

    Object.defineProperty(editor.view, "composing", { value: true, configurable: true });
    expect(handleKeyDown(editor, {
      code: "Minus",
      key: "-",
      altKey: true,
    })).toBe(false);
    expect(editor.getText()).toBe("текст");
  });
});
