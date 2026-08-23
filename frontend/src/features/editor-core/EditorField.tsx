import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor, JSONContent } from "@tiptap/core";

import type { EditorCoreRichTextTarget } from "./types";
import type { ScenarioTextFieldController } from "../scenario/scenarioTextFields";
import { createEditorCoreExtensions } from "./extensions";
import { mapPlainTextRangeToProseMirror } from "./richTextOperations";
import {
  buildEditorCoreInitialContent,
  buildEditorCoreStoredHtml,
  normalizeEditorCoreText,
} from "./serializers";

export interface EditorCoreFieldChangePayload {
  editor: "tiptap";
  text: string;
  html: string;
  doc: JSONContent;
}

interface EditorCoreFieldProps {
  editorId: string;
  richTextTarget: EditorCoreRichTextTarget | null;
  plainTextValue: string;
  disabled: boolean;
  placeholder: string;
  className: string;
  ariaLabel?: string;
  style?: CSSProperties;
  focusRequest?: number;
  onFocusField: () => void;
  onChangeValue: (payload: EditorCoreFieldChangePayload) => void;
  onRegister: (
    editorId: string,
    editor: TiptapEditor | null,
    controller: ScenarioTextFieldController | null,
  ) => void;
  onSelectionChange: (editorId: string) => void;
}

function buildContentSignature(target: EditorCoreRichTextTarget | null, plainTextValue: string): string {
  return JSON.stringify({
    text: target?.text ?? plainTextValue,
    html: target?.html ?? "",
    doc: target?.doc ?? null,
  });
}

export function EditorCoreField({
  editorId,
  richTextTarget,
  plainTextValue,
  disabled,
  placeholder,
  className,
  ariaLabel,
  style,
  focusRequest,
  onFocusField,
  onChangeValue,
  onRegister,
  onSelectionChange,
}: EditorCoreFieldProps) {
  const extensions = useMemo(() => createEditorCoreExtensions(), []);
  const lastAppliedSignatureRef = useRef("");
  const onRegisterRef = useRef(onRegister);
  onRegisterRef.current = onRegister;

  const editor = useEditor(
    {
      extensions,
      content: buildEditorCoreInitialContent(richTextTarget, plainTextValue),
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "editor-core-content",
          "aria-label": ariaLabel,
          role: "textbox",
        },
      },
      onFocus: () => {
        onFocusField();
        onSelectionChange(editorId);
      },
      onSelectionUpdate: () => {
        onSelectionChange(editorId);
      },
      onUpdate: ({ editor: currentEditor }) => {
        const text = normalizeEditorCoreText(
          currentEditor.getText({
            blockSeparator: "\n",
          })
        );
        onChangeValue({
          editor: "tiptap",
          text,
          html: buildEditorCoreStoredHtml(currentEditor.getHTML(), text),
          doc: currentEditor.getJSON(),
        });
      },
    },
    []
  );

  const searchController = useMemo<ScenarioTextFieldController | null>(() => {
    if (!editor) return null;
    return {
      focusRange(from, to) {
        const range = mapPlainTextRangeToProseMirror(editor.state.doc, { from, to }, true);
        if (!range) return;
        editor.chain()
          .setTextSelection(range)
          .focus(undefined, { scrollIntoView: false })
          .run();
      },
      setSearchHighlights(ranges) {
        editor.commands.setSearchHighlights(ranges.flatMap(({ from, to, active }) => {
          const range = mapPlainTextRangeToProseMirror(editor.state.doc, { from, to }, true);
          return range ? [{ ...range, active }] : [];
        }));
      },
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !searchController) return;
    onRegisterRef.current(editorId, editor, searchController);
    return () => onRegisterRef.current(editorId, null, null);
  }, [editor, editorId, searchController]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.setEditable(!disabled, false);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || !focusRequest) {
      return;
    }
    editor.commands.focus();
  }, [editor, focusRequest]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const nextSignature = buildContentSignature(richTextTarget, plainTextValue);
    if (lastAppliedSignatureRef.current === nextSignature) {
      return;
    }

    const currentText = normalizeEditorCoreText(
      editor.getText({
        blockSeparator: "\n",
      })
    );
    const nextText = normalizeEditorCoreText(richTextTarget?.text ?? plainTextValue);
    const currentHtml = editor.isEmpty ? "" : editor.getHTML();
    const nextHtml = buildEditorCoreStoredHtml(richTextTarget?.html ?? "", nextText);

    if (currentText !== nextText || currentHtml !== nextHtml) {
      editor.commands.setContent(buildEditorCoreInitialContent(richTextTarget, plainTextValue), {
        emitUpdate: false,
      });
    }
    lastAppliedSignatureRef.current = nextSignature;
  }, [editor, plainTextValue, richTextTarget]);

  const isEmpty = editor ? editor.isEmpty : !plainTextValue.trim();

  return (
    <div
      className={`${className} editor-core-field rich-text-field`}
      data-placeholder={placeholder}
      data-empty={isEmpty ? "true" : "false"}
      style={style}
      onClick={(event) => event.stopPropagation()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
