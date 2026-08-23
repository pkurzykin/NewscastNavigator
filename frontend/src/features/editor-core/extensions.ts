import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";

import { RussianQuotesExtension } from "./RussianQuotesExtension";
import { RegistryFontFamily } from "./RegistryFontFamily";
import { SearchHighlightExtension } from "./SearchHighlightExtension";

export function createEditorCoreExtensions() {
  return [
    StarterKit.configure({
      blockquote: false,
      bulletList: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      orderedList: false,
      undoRedo: false,
    }),
    TextStyle,
    RegistryFontFamily.configure({
      types: ["textStyle"],
    }),
    Highlight.configure({
      multicolor: true,
    }),
    SearchHighlightExtension,
    RussianQuotesExtension,
  ];
}
