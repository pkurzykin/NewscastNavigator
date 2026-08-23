import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";

import { resolveRussianQuoteEdit } from "./russianQuotes";

function quoteContextLeafText(node: ProseMirrorNode): string {
  return node.type.name === "hardBreak" ? "\n" : "\uFFFC";
}

export const RussianQuotesExtension = Extension.create({
  name: "russianQuotes",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== '"') return false;

            const { doc, schema } = view.state;
            const before = doc.textBetween(0, from, "\n", quoteContextLeafText);
            const selected = doc.textBetween(from, to, "\n", quoteContextLeafText);
            const after = doc.textBetween(to, doc.content.size, "\n", quoteContextLeafText);
            const edit = resolveRussianQuoteEdit(before, selected, after);
            const transaction = view.state.tr;
            let caretPosition = from + edit.caretOffset;

            if (from !== to) {
              transaction
                .insert(to, schema.text("»"))
                .insert(from, schema.text("«"));
              caretPosition = transaction.mapping.map(to, 1);
            } else if (edit.insert) {
              transaction.insertText(edit.insert, from, to);
            }

            transaction.setSelection(TextSelection.create(
              transaction.doc,
              caretPosition,
            ));
            view.dispatch(transaction);
            return true;
          },
        },
      }),
    ];
  },
});
