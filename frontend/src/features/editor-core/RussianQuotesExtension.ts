import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";

import { resolveRussianQuoteEdit } from "./russianQuotes";

export const RussianQuotesExtension = Extension.create({
  name: "russianQuotes",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== '"') return false;

            const { doc, schema } = view.state;
            const before = doc.textBetween(0, from, "\n", "\uFFFC");
            const selected = doc.textBetween(from, to, "\n", "\uFFFC");
            const after = doc.textBetween(to, doc.content.size, "\n", "\uFFFC");
            const edit = resolveRussianQuoteEdit(before, selected, after);
            const transaction = view.state.tr;

            if (from !== to) {
              transaction
                .insert(to, schema.text("»"))
                .insert(from, schema.text("«"));
            } else if (edit.insert) {
              transaction.insertText(edit.insert, from, to);
            }

            transaction.setSelection(TextSelection.create(
              transaction.doc,
              from + edit.caretOffset,
            ));
            view.dispatch(transaction);
            return true;
          },
        },
      }),
    ];
  },
});
