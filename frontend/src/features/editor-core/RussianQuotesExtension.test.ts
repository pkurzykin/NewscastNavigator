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

describe("RussianQuotesExtension", () => {
  it("handles a direct opening quote with one editor update", () => {
    const onUpdate = vi.fn();
    const editor = createEditor("", onUpdate);

    expect(handleTextInput(editor, '"')).toBe(true);

    expect(editor.getText()).toBe("«»");
    expect(editor.getHTML()).toBe("<p>«»</p>");
    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "«»" }] }],
    });
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(2);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("handles a closing quote at the caret", () => {
    const editor = createEditor("<p>«текст</p>");
    editor.commands.setTextSelection(7);

    expect(handleTextInput(editor, '"')).toBe(true);

    expect(editor.getText()).toBe("«текст»");
    expect(editor.getHTML()).toBe("<p>«текст»</p>");
    expect(editor.state.selection.from).toBe(8);
  });

  it("treats a hard break as the start of the current line", () => {
    const onUpdate = vi.fn();
    const editor = createEditor("<p>Строка<br></p>", onUpdate);
    editor.commands.setTextSelection(8);

    expect(handleTextInput(editor, '"')).toBe(true);

    expect(editor.getHTML()).toBe("<p>Строка<br>«»</p>");
    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "Строка" },
          { type: "hardBreak" },
          { type: "text", text: "«»" },
        ],
      }],
    });
    expect(editor.state.selection.from).toBe(9);
    expect(editor.state.selection.to).toBe(9);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps paragraph boundaries as current-line context", () => {
    const editor = createEditor("<p>Закрытый контекст</p><p></p>");
    editor.commands.setTextSelection(20);

    expect(handleTextInput(editor, '"')).toBe(true);

    expect(editor.getHTML()).toBe("<p>Закрытый контекст</p><p>«»</p>");
    expect(editor.state.selection.from).toBe(21);
  });

  it("wraps a selection without flattening its marks", () => {
    const onUpdate = vi.fn();
    const editor = createEditor("<p>Сказал <strong>текст</strong> далее</p>", onUpdate);
    editor.commands.setTextSelection({ from: 8, to: 13 });

    expect(handleTextInput(editor, '"')).toBe(true);

    expect(editor.getText()).toBe("Сказал «текст» далее");
    expect(editor.getHTML()).toBe("<p>Сказал «<strong>текст</strong>» далее</p>");
    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "Сказал «" },
          { type: "text", marks: [{ type: "bold" }], text: "текст" },
          { type: "text", text: "» далее" },
        ],
      }],
    });
    expect(editor.state.selection.from).toBe(15);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("maps the caret after wrapping a marked selection across paragraphs", () => {
    const onUpdate = vi.fn();
    const editor = createEditor(
      "<p>До <strong>первый</strong></p><p><em>второй</em> после</p>",
      onUpdate,
    );
    editor.commands.setTextSelection({ from: 4, to: 18 });

    expect(handleTextInput(editor, '"')).toBe(true);

    expect(editor.getHTML()).toBe(
      "<p>До «<strong>первый</strong></p><p><em>второй</em>» после</p>",
    );
    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "До «" },
            { type: "text", marks: [{ type: "bold" }], text: "первый" },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "italic" }], text: "второй" },
            { type: "text", text: "» после" },
          ],
        },
      ],
    });
    expect(editor.state.selection.from).toBe(20);
    expect(editor.state.selection.to).toBe(20);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("moves over an existing closing quote without changing the document", () => {
    const editor = createEditor("<p>«текст» далее</p>");
    editor.commands.setTextSelection(7);

    expect(handleTextInput(editor, '"')).toBe(true);

    expect(editor.getText()).toBe("«текст» далее");
    expect(editor.state.selection.from).toBe(8);
  });

  it("returns false and leaves the document untouched for non-quote and multi-character input", () => {
    const editor = createEditor("<p>Текст</p>");
    editor.commands.setTextSelection(6);

    expect(handleTextInput(editor, "x")).toBe(false);
    expect(handleTextInput(editor, '\"\"')).toBe(false);
    expect(editor.getText()).toBe("Текст");
  });

  it("leaves a pasted ASCII quote unchanged", () => {
    const editor = createEditor("<p>До после</p>");
    editor.commands.setTextSelection(4);

    editor.commands.insertContent('"');

    expect(editor.getText()).toBe('До "после');
    expect(editor.getHTML()).toBe('<p>До "после</p>');
  });
});
