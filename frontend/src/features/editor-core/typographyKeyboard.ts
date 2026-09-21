export interface TypographyKey {
  code: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  getModifierState?: (key: string) => boolean;
}

export function resolveTypographyKey(event: TypographyKey): "\u2013" | '"' | null {
  if (
    event.isComposing
    || event.ctrlKey
    || event.metaKey
    || event.getModifierState?.("AltGraph")
  ) {
    return null;
  }
  if (event.code === "NumpadSubtract" && !event.altKey && !event.shiftKey) {
    return "\u2013";
  }
  if (event.code === "Minus" && event.altKey && !event.shiftKey) {
    return "\u2013";
  }
  if (event.code === "Quote" && event.key === '"' && !event.altKey) {
    return '"';
  }
  return null;
}
