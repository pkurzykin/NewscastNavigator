export const EDITOR_CORE_SUPPORTED_TEXT_BLOCKS = new Set(["podvodka", "zk", "life"]);

export function canUseEditorCoreTextField(blockType: string, target: string): boolean {
  if (target !== "text") {
    return false;
  }
  return EDITOR_CORE_SUPPORTED_TEXT_BLOCKS.has((blockType || "").trim().toLowerCase());
}
