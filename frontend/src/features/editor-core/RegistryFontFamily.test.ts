import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { EDITOR_FONT_FAMILIES, editorFontCssStack } from "./fontRegistry";
import { createEditorCoreExtensions } from "./extensions";

const editors: Editor[] = [];

function createEditor(content: string | JSONContent): { editor: Editor; element: HTMLDivElement } {
  const element = document.createElement("div");
  const editor = new Editor({
    element,
    extensions: createEditorCoreExtensions(),
    content,
  });
  editors.push(editor);
  return { editor, element };
}

function textStyleFontFamily(editor: Editor): unknown {
  const paragraph = editor.getJSON().content?.[0];
  const text = paragraph?.content?.find((node) => node.type === "text");
  return text?.marks?.find((mark) => mark.type === "textStyle")?.attrs?.fontFamily;
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("registry-aware FontFamily", () => {
  it("stores Franklin Gothic Book exactly while rendering a safe stack over a selected marked range", () => {
    const { editor, element } = createEditor("<p>До <strong>выбор</strong> после</p>");
    editor.commands.setTextSelection({ from: 4, to: 10 });

    expect(editor.commands.setFontFamily("Franklin Gothic Book")).toBe(true);

    const selectedText = editor.getJSON().content?.[0]?.content?.find(
      (node) => (node as JSONContent).text === "выбор",
    );
    expect(editor.getText()).toBe("До выбор после");
    expect(selectedText?.marks).toEqual(expect.arrayContaining([
      { type: "bold" },
      { type: "textStyle", attrs: { fontFamily: "Franklin Gothic Book" } },
    ]));
    expect(editor.state.selection.from).toBe(4);
    expect(editor.state.selection.to).toBe(10);
    expect(editor.getHTML()).toContain(
      'font-family: &quot;Franklin Gothic Book&quot;, Arial, sans-serif',
    );
    expect(element.querySelector("span")?.getAttribute("style")).toContain(
      'font-family: "Franklin Gothic Book", Arial, sans-serif',
    );
  });

  it.each(EDITOR_FONT_FAMILIES)("keeps %s exact in JSON and renders its mapped stack", (family) => {
    const { editor, element } = createEditor("<p>Текст</p>");
    editor.commands.setTextSelection({ from: 1, to: 6 });

    expect(editor.commands.setFontFamily(family)).toBe(true);
    expect(textStyleFontFamily(editor)).toBe(family);
    expect(element.querySelector("span")?.getAttribute("style")).toContain(
      `font-family: ${editorFontCssStack(family)}`,
    );
  });

  it("normalizes loaded stacks and fails closed for unknown, null, quoted, and injection-like family values", () => {
    const franklin = createEditor(
      '<p><span style="font-family: &quot;Franklin Gothic Book&quot;, Arial, sans-serif">Franklin</span></p>',
    );
    const unknown = createEditor('<p><span style="font-family: Evil Script, serif">Unknown</span></p>');
    const empty = createEditor('<p><span style="font-family: \'\'">Empty</span></p>');
    const injected = createEditor({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "Injected",
          marks: [{
            type: "textStyle",
            attrs: { fontFamily: 'url(javascript:alert(1))' },
          }],
        }],
      }],
    });

    expect(textStyleFontFamily(franklin.editor)).toBe("Franklin Gothic Book");
    expect(franklin.element.querySelector("span")?.getAttribute("style")).toContain(
      'font-family: "Franklin Gothic Book", Arial, sans-serif',
    );
    for (const candidate of [unknown, empty, injected]) {
      expect(textStyleFontFamily(candidate.editor)).toBe("PT Sans");
      expect(candidate.element.querySelector("span")?.getAttribute("style")).toContain(
        'font-family: "PT Sans", Arial, sans-serif',
      );
      expect(candidate.element.innerHTML).not.toContain("javascript:");
      expect(candidate.element.innerHTML).not.toContain("Evil Script");
    }
  });
});
