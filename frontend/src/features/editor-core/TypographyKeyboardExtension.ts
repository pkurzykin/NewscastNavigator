import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { resolveTypographyKey } from "./typographyKeyboard";

export const TypographyKeyboardExtension = Extension.create({
  name: "typographyKeyboard",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (!view.editable || view.composing || event.isComposing) return false;
            const text = resolveTypographyKey(event);
            if (text === null) return false;
            view.dispatch(view.state.tr.insertText(text));
            return true;
          },
        },
      }),
    ];
  },
});
