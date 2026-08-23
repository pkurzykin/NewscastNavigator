import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface SearchHighlightRange {
  from: number;
  to: number;
  active: boolean;
}

type SearchHighlightMeta =
  | { kind: "set"; ranges: SearchHighlightRange[] }
  | { kind: "clear" };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchHighlights: {
      setSearchHighlights: (ranges: SearchHighlightRange[]) => ReturnType;
      clearSearchHighlights: () => ReturnType;
    };
  }
}

const searchHighlightPluginKey = new PluginKey<DecorationSet>("scenarioSearchHighlights");

function createDecorations(doc: Parameters<typeof DecorationSet.create>[0], ranges: SearchHighlightRange[]) {
  return DecorationSet.create(doc, ranges.flatMap(({ from, to, active }) => {
    if (
      !Number.isInteger(from)
      || !Number.isInteger(to)
      || from < 0
      || to <= from
      || to > doc.content.size
    ) return [];
    return [Decoration.inline(from, to, {
      class: active
        ? "scenario-search-highlight scenario-search-highlight-active"
        : "scenario-search-highlight",
      "data-search-highlight": active ? "active" : "match",
    })];
  }));
}

export const SearchHighlightExtension = Extension.create({
  name: "searchHighlights",

  addCommands() {
    return {
      setSearchHighlights: (ranges) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(searchHighlightPluginKey, { kind: "set", ranges } satisfies SearchHighlightMeta);
        return true;
      },
      clearSearchHighlights: () => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(searchHighlightPluginKey, { kind: "clear" } satisfies SearchHighlightMeta);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: searchHighlightPluginKey,
      state: {
        init: (_, state) => DecorationSet.empty,
        apply(transaction, decorations) {
          const meta = transaction.getMeta(searchHighlightPluginKey) as SearchHighlightMeta | undefined;
          if (meta?.kind === "clear") return DecorationSet.empty;
          if (meta?.kind === "set") return createDecorations(transaction.doc, meta.ranges);
          return decorations.map(transaction.mapping, transaction.doc);
        },
      },
      props: {
        decorations: (state) => searchHighlightPluginKey.getState(state) ?? DecorationSet.empty,
      },
    })];
  },
});
