import { describe, expect, it } from "vitest";

import type { ScriptElementRichTextTarget } from "../../shared/types";
import {
  buildEditorCoreHtmlFromPlainText,
  buildEditorCoreInitialContent,
  buildEditorCoreStoredHtml,
} from "./serializers";

describe("current editor serializers", () => {
  it("round-trips current editor plain text through stored HTML", () => {
    const plainText = 'Первая <строка> & "цитата"\nВторая строка';
    const storedHtml = buildEditorCoreHtmlFromPlainText(plainText);
    const richTextTarget: ScriptElementRichTextTarget = {
      editor: "tiptap",
      text: plainText,
      html: storedHtml,
    };

    const editorContent = buildEditorCoreInitialContent(richTextTarget, "");

    expect(editorContent).toBe(
      "Первая &lt;строка&gt; &amp; &quot;цитата&quot;<br>Вторая строка"
    );
    expect(buildEditorCoreStoredHtml(String(editorContent), plainText)).toBe(storedHtml);
  });
});
