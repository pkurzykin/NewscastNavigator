import { createDocument, getSchema, type JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createEditorCoreExtensions } from "./extensions";
import {
  mapPlainTextRangesToProseMirror,
  mapPlainTextRangeToProseMirror,
  replaceEditorCoreRichTextRanges,
} from "./richTextOperations";
import type { EditorCoreRichTextTarget } from "./types";

function target(doc: NonNullable<EditorCoreRichTextTarget["doc"]>, text: string): EditorCoreRichTextTarget {
  return { editor: "tiptap", text, html: "stale html", doc };
}

function pmDoc(content: JSONContent) {
  return createDocument(content, getSchema(createEditorCoreExtensions()), {}, {
    errorOnInvalidContent: true,
  });
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

    expect(result).not.toBeNull();
    if (!result) throw new Error("Expected valid ranges to produce a rich-text result");
    expect(result.text).toBe("X два X");
    expect(result.html).toBe("<p>X два X</p>");
    expect(source.text).toBe("раз два раз");
    expect(source.html).toBe("stale html");
  });

  it("maps many plain ranges through one bulk position map and keeps surrogate boundaries", () => {
    const text = `😀${"a".repeat(64)}`;
    const doc = pmDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const ranges = [
      { from: 0, to: 2 },
      ...Array.from({ length: 64 }, (_, index) => ({ from: index + 2, to: index + 3 })),
    ];

    const mapped = mapPlainTextRangesToProseMirror(doc, ranges);

    expect(mapped).toHaveLength(65);
    expect(mapped[0]).toEqual({ from: 1, to: 3 });
    expect(mapped[1]).toEqual({ from: 3, to: 4 });
    expect(mapped.at(-1)).toEqual({ from: 66, to: 67 });
  });

  it("rejects noninteger offsets instead of truncating them", () => {
    const doc = pmDoc({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "abc" }] }],
    });

    expect(mapPlainTextRangeToProseMirror(doc, { from: 0.5, to: 2 })).toBeNull();
    expect(mapPlainTextRangesToProseMirror(doc, [{ from: 0, to: 2.5 }])).toEqual([null]);
    expect(replaceEditorCoreRichTextRanges(null, "abc", [{ from: 0.5, to: 2 }], "X"))
      .toBeNull();
  });

  it("supports empty replacement at the exact document end and preserves surrogate neighbors", () => {
    const source = target({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "😀AB" }] }],
    }, "😀AB");

    expect(replaceEditorCoreRichTextRanges(source, source.text, [
      { from: 3, to: 4 },
    ], "")).toEqual({
      editor: "tiptap",
      text: "😀A",
      html: "<p>😀A</p>",
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "😀A" }] }],
      },
    });
  });

  it("maps two adjacent empty paragraphs as two exact newlines", () => {
    const source = target({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "B" }] },
      ],
    }, "A\n\nB");

    expect(replaceEditorCoreRichTextRanges(source, source.text, [
      { from: 1, to: 3 },
    ], "X")).toEqual({
      editor: "tiptap",
      text: "AXB",
      html: "<p>AXB</p>",
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "AXB" }] }],
      },
    });
  });
});
