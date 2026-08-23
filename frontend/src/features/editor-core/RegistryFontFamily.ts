import FontFamily from "@tiptap/extension-font-family";
import { Plugin, type EditorState } from "@tiptap/pm/state";

import { editorFontCssStack, isAllowedEditorFont } from "./fontRegistry";

function normalizedEditorFontFamily(value: unknown): string {
  if (typeof value !== "string") return "PT Sans";
  const firstFamily = value
    .trim()
    .split(",", 1)[0]
    ?.trim()
    .replace(/^['"]+|['"]+$/g, "");
  return isAllowedEditorFont(firstFamily) ? firstFamily : "PT Sans";
}

function normalizeFontFamilyTransaction(state: EditorState) {
  const transaction = state.tr;
  state.doc.descendants((node, position) => {
    if (!node.isText) return;
    const textStyle = node.marks.find((mark) => mark.type.name === "textStyle");
    if (!textStyle) return;
    const fontFamily = normalizedEditorFontFamily(textStyle.attrs.fontFamily);
    if (textStyle.attrs.fontFamily === fontFamily) return;
    transaction.removeMark(position, position + node.nodeSize, textStyle);
    transaction.addMark(
      position,
      position + node.nodeSize,
      textStyle.type.create({ ...textStyle.attrs, fontFamily }),
    );
  });
  return transaction.docChanged ? transaction : null;
}

function normalizeInitialContent(content: unknown): unknown {
  if (Array.isArray(content)) return content.map(normalizeInitialContent);
  if (!content || typeof content !== "object") return content;
  const value = content as Record<string, unknown>;
  return {
    ...value,
    ...(Array.isArray(value.marks) ? {
      marks: value.marks.map((mark) => {
        if (!mark || typeof mark !== "object") return mark;
        const value = mark as Record<string, unknown>;
        if (value.type !== "textStyle") return mark;
        const attrs = value.attrs && typeof value.attrs === "object"
          ? value.attrs as Record<string, unknown>
          : {};
        return {
          ...value,
          attrs: { ...attrs, fontFamily: normalizedEditorFontFamily(attrs.fontFamily) },
        };
      }),
    } : {}),
    ...(Array.isArray(value.content) ? { content: value.content.map(normalizeInitialContent) } : {}),
  };
}

export const RegistryFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontFamily: {
          default: null,
          parseHTML: (element) => normalizedEditorFontFamily(element.style.fontFamily),
          renderHTML: (attributes) => ({
            style: `font-family: ${editorFontCssStack(attributes.fontFamily)}`,
          }),
        },
      },
    }];
  },

  addCommands() {
    return {
      setFontFamily: (fontFamily: string) => ({ chain }) => (
        chain().setMark("textStyle", { fontFamily: normalizedEditorFontFamily(fontFamily) }).run()
      ),
      unsetFontFamily: () => ({ chain }) => (
        chain().setMark("textStyle", { fontFamily: null }).removeEmptyTextStyle().run()
      ),
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (_transactions, _oldState, newState) => normalizeFontFamilyTransaction(newState),
    })];
  },

  onBeforeCreate() {
    if (typeof this.editor.options.content === "object") {
      this.editor.options.content = normalizeInitialContent(this.editor.options.content);
    }
  },
});
