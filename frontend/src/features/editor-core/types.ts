import type { JSONContent } from "@tiptap/core";

export interface EditorCoreRichTextTarget {
  editor: string;
  text: string;
  html: string;
  doc?: JSONContent;
}
