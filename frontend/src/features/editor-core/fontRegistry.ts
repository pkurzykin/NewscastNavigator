export const EDITOR_FONT_FAMILIES = [
  "PT Sans",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Roboto Slab",
  "Franklin Gothic Book",
] as const;

const CSS_STACKS: Record<(typeof EDITOR_FONT_FAMILIES)[number], string> = {
  "PT Sans": '"PT Sans", Arial, sans-serif',
  Arial: "Arial, sans-serif",
  Georgia: "Georgia, serif",
  "Times New Roman": '"Times New Roman", serif',
  "Roboto Slab": '"Roboto Slab", serif',
  "Franklin Gothic Book": '"Franklin Gothic Book", Arial, sans-serif',
};

const editorFontFamilySet = new Set<string>(EDITOR_FONT_FAMILIES);

export function isAllowedEditorFont(value: unknown): value is (typeof EDITOR_FONT_FAMILIES)[number] {
  return typeof value === "string" && editorFontFamilySet.has(value);
}

export function editorFontCssStack(value: unknown): string {
  return CSS_STACKS[isAllowedEditorFont(value) ? value : "PT Sans"];
}
