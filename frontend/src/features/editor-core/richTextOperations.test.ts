import { describe, expect, it } from "vitest";

import { replaceEditorCoreRichTextRanges } from "./richTextOperations";
import type { EditorCoreRichTextTarget } from "./types";

function target(doc: NonNullable<EditorCoreRichTextTarget["doc"]>, text: string): EditorCoreRichTextTarget {
  return { editor: "tiptap", text, html: "stale html", doc };
}

describe("rich text range replacement", () => {
  it("inherits the mark at the match start and preserves adjacent unmarked text", () => {
    const source = target({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", marks: [{ type: "bold" }], text: "Красный" },
          { type: "text", text: " текст" },
        ],
      }],
    }, "Красный текст");

    expect(replaceEditorCoreRichTextRanges(source, "Красный текст", [
      { from: 2, to: 5 },
    ], "X")).toEqual({
      editor: "tiptap",
      text: "КрXый текст",
      html: "<p><strong>КрXый</strong> текст</p>",
      doc: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "КрXый" },
            { type: "text", text: " текст" },
          ],
        }],
      },
    });
  });

  it("uses the start mark across a mark boundary and preserves the untouched trailing mark", () => {
    const source = target({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", marks: [{ type: "bold" }], text: "Красный " },
          { type: "text", marks: [{ type: "italic" }], text: "текст" },
        ],
      }],
    }, "Красный текст");

    expect(replaceEditorCoreRichTextRanges(source, source.text, [
      { from: 5, to: 10 },
    ], "НОВОЕ")).toEqual({
      editor: "tiptap",
      text: "КраснНОВОЕкст",
      html: "<p><strong>КраснНОВОЕ</strong><em>кст</em></p>",
      doc: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "КраснНОВОЕ" },
            { type: "text", marks: [{ type: "italic" }], text: "кст" },
          ],
        }],
      },
    });
  });

  it("maps hard breaks and paragraph boundaries as one newline each", () => {
    const source = target({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "Первая" },
            { type: "hardBreak" },
            { type: "text", marks: [{ type: "italic" }], text: "строка" },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "strike" }], text: "Вторая" },
          ],
        },
      ],
    }, "Первая\nстрока\nВторая");

    expect(replaceEditorCoreRichTextRanges(source, source.text, [
      { from: 4, to: 16 },
    ], "X")).toEqual({
      editor: "tiptap",
      text: "ПервXорая",
      html: "<p><strong>ПервX</strong><s>орая</s></p>",
      doc: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "ПервX" },
            { type: "text", marks: [{ type: "strike" }], text: "орая" },
          ],
        }],
      },
    });
  });

  it("applies multiple ranges end-to-start in one immutable result", () => {
    const source = target({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "раз два раз" }] }],
    }, "раз два раз");

    const result = replaceEditorCoreRichTextRanges(source, source.text, [
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ], "X");

    expect(result.text).toBe("X два X");
    expect(result.html).toBe("<p>X два X</p>");
    expect(source.text).toBe("раз два раз");
    expect(source.html).toBe("stale html");
  });
});
