import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor, JSONContent } from "@tiptap/core";

import type { ScriptElementRichTextTarget } from "../../shared/types";
import { createEditorCoreExtensions } from "./extensions";
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
  richTextTarget: ScriptElementRichTextTarget | null;
  plainTextValue: string;
  disabled: boolean;
  placeholder: string;
  className: string;
  style?: CSSProperties;
  onFocusField: () => void;
  onChangeValue: (payload: EditorCoreFieldChangePayload) => void;
  onRegister: (editorId: string, editor: TiptapEditor | null) => void;
  onSelectionChange: (editorId: string) => void;
}

function buildContentSignature(target: ScriptElementRichTextTarget | null, plainTextValue: string): string {
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
  style,
  onFocusField,
  onChangeValue,
  onRegister,
  onSelectionChange,
}: EditorCoreFieldProps) {
  const extensions = useMemo(() => createEditorCoreExtensions(), []);
  const lastAppliedSignatureRef = useRef("");

  const editor = useEditor(
    {
      extensions,
      content: buildEditorCoreInitialContent(richTextTarget, plainTextValue),
      editable: !disabled,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "editor-core-content",
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

  useEffect(() => {
    onRegister(editorId, editor);
    return () => onRegister(editorId, null);
  }, [editor, editorId, onRegister]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.setEditable(!disabled);
  }, [disabled, editor]);

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
