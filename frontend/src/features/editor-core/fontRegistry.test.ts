import { describe, expect, it } from "vitest";

import {
  EDITOR_FONT_FAMILIES,
  editorFontCssStack,
  isAllowedEditorFont,
} from "./fontRegistry";

describe("editor font registry", () => {
  it("keeps the complete allowed family list and gives Franklin Gothic Book a safe CSS stack", () => {
    expect(EDITOR_FONT_FAMILIES).toEqual([
      "PT Sans",
      "Arial",
      "Georgia",
      "Times New Roman",
      "Roboto Slab",
      "Franklin Gothic Book",
    ]);
    expect(isAllowedEditorFont("Franklin Gothic Book")).toBe(true);
    expect(isAllowedEditorFont("url(javascript:alert(1))")).toBe(false);
    expect(editorFontCssStack("Franklin Gothic Book")).toBe(
      '"Franklin Gothic Book", Arial, sans-serif',
    );
    expect(editorFontCssStack("url(javascript:alert(1))")).toBe('"PT Sans", Arial, sans-serif');
  });
});
