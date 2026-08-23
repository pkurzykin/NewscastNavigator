export function isFileBundlePlusKey(
  event: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "isComposing">,
): boolean {
  return !event.isComposing
    && ((event.code === "Equal" && event.shiftKey) || event.code === "NumpadAdd");
}

export function replaceInputSelection(
  value: string,
  start: number | null,
  end: number | null,
  inserted: string,
): { value: string; caret: number } {
  const from = start ?? value.length;
  const to = end ?? from;
  return {
    value: `${value.slice(0, from)}${inserted}${value.slice(to)}`,
    caret: from + inserted.length,
  };
}
