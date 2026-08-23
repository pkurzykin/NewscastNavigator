export interface RussianQuoteEdit {
  insert: string;
  caretOffset: number;
}

const OPENING_CONTEXT = /[\s(\[{\u2014:;,.!?]$/u;

function currentLineBeforeCaret(before: string): string {
  return before.slice(Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r")) + 1);
}

export function resolveRussianQuoteEdit(
  before: string,
  selected: string,
  after: string,
): RussianQuoteEdit {
  if (selected) {
    const insert = `«${selected}»`;
    return { insert, caretOffset: insert.length };
  }

  const currentLine = currentLineBeforeCaret(before);
  if (!currentLine || OPENING_CONTEXT.test(currentLine)) {
    return { insert: "«»", caretOffset: 1 };
  }

  if (after.startsWith("»")) {
    return { insert: "", caretOffset: 1 };
  }

  return { insert: "»", caretOffset: 1 };
}
