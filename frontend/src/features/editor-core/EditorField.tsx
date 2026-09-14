import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { EditorContent, useEditor } from "@tiptap/react";
import { Extension, type Editor as TiptapEditor, type JSONContent } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { useFieldEditAccess } from "../scenario/ScenarioAccessContext";

import type { EditorCoreRichTextTarget } from "./types";
import type { ScenarioTextFieldController } from "../scenario/scenarioTextFields";
import { createEditorCoreExtensions } from "./extensions";
import {
  mapPlainTextRangesToProseMirror,
  mapPlainTextRangeToProseMirror,
} from "./richTextOperations";
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
  const access = useFieldEditAccess();
  const live = useRef({ access, disabled }); live.current = { access, disabled };
  const hydration = useRef(false);
  const [candidate, setCandidate] = useState<{ doc: JSONContent; from: number; to: number; signature: string } | null>(null);
  const startCandidateRef = useRef<() => void>(() => {});
  const extensions = useMemo(() => [...createEditorCoreExtensions(), Extension.create({
    name: "scenarioAccessBarrier",
    addProseMirrorPlugins() {
      return [new Plugin({ filterTransaction: (tr) => !tr.docChanged || hydration.current
        || (!live.current.disabled && (live.current.access?.canMutate() ?? true)) })];
    },
  })], []);
  const lastAppliedSignatureRef = useRef("");
  const onRegisterRef = useRef(onRegister);
  onRegisterRef.current = onRegister;

  const editor = useEditor(
    {
      extensions,
      content: buildEditorCoreInitialContent(richTextTarget, plainTextValue),
      editable: !disabled && (access?.canMutate() ?? true),
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "editor-core-content",
          "aria-label": ariaLabel,
          role: "textbox",
          tabindex: "0",
        },
      },
      onFocus: () => {
        startCandidateRef.current();
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

  startCandidateRef.current = () => {
    if (!editor || candidate || live.current.disabled || !live.current.access?.canRequest || live.current.access.canMutate()) return;
    const { from, to } = editor.state.selection;
    setCandidate({ doc: editor.getJSON(), from, to, signature: JSON.stringify(editor.getJSON()) });
  };

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
        const mapped = mapPlainTextRangesToProseMirror(editor.state.doc, ranges, true);
        editor.commands.setSearchHighlights(mapped.flatMap((range, index) => (
          range ? [{ ...range, active: ranges[index].active }] : []
        )));
      },
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || !searchController) return;
    onRegisterRef.current(editorId, editor, searchController);
    return () => onRegisterRef.current(editorId, null, null);
  }, [editor, editorId, searchController]);

  useLayoutEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled && (access?.canMutate() ?? true), false);
  });

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
      hydration.current = true;
      try { editor.commands.setContent(buildEditorCoreInitialContent(richTextTarget, plainTextValue), {
        emitUpdate: false,
      }); } finally { hydration.current = false; }
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
      <div hidden={Boolean(candidate)}
        onFocusCapture={() => startCandidateRef.current()}
        onMouseDown={(event) => {
          if (!editor || !access?.canRequest || access.canMutate() || disabled) return;
          event.preventDefault();
          onFocusField();
          // Preserve a user selection; a collapsed click uses the actual document position.
          if (editor.state.selection.empty) {
            const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (position) editor.commands.setTextSelection(position.pos);
          }
          startCandidateRef.current();
        }}>
        <EditorContent editor={editor} />
      </div>
      {candidate && editor && access ? <PendingFieldInput
        initial={candidate} ariaLabel={ariaLabel ?? editorId}
        requestEdit={access.requestEdit}
        storeCandidate={(value) => access.storeCandidate?.(editorId, value)}
        onDispose={() => access.deactivateCandidate?.(editorId)}
        onCommit={(source) => {
          if (!live.current.access?.canMutate() || JSON.stringify(editor.getJSON()) !== candidate.signature) return false;
          editor.setEditable(true, false);
          const { from, to } = source.state.selection;
          const transaction = editor.state.tr;
          if (JSON.stringify(source.getJSON()) !== candidate.signature) {
            transaction.replaceWith(0, transaction.doc.content.size, editor.schema.nodeFromJSON(source.getJSON()).content);
          }
          transaction.setSelection(TextSelection.create(transaction.doc, from, to));
          transaction.setStoredMarks(source.state.storedMarks?.map((mark) => editor.schema.markFromJSON(mark.toJSON())) ?? null);
          editor.view.dispatch(transaction);
          const wasFocused = source.isFocused;
          access.storeCandidate?.(editorId, null);
          setCandidate(null);
          window.setTimeout(() => { if (!editor.isDestroyed && wasFocused && document.activeElement === document.body) editor.view.focus(); }, 0);
          return true;
        }}
      /> : null}
    </div>
  );
}


/** Temporary field-sized input surface. It has no row, history or autosave callbacks.
 * The canonical editor remains mounted and transaction-locked until grant.
 */
function PendingFieldInput({ initial, ariaLabel, requestEdit, onCommit, storeCandidate, onDispose }: {
  initial: { doc: JSONContent; from: number; to: number; signature: string };
  ariaLabel: string;
  requestEdit(): Promise<boolean>;
  onCommit(editor: TiptapEditor): boolean;
  storeCandidate(value: { text: string; doc: unknown }): void;
  onDispose(): void;
}) {
  const composing = useRef(false);
  const granted = useRef(false);
  const active = useRef(true);
  const disposeRef = useRef(onDispose); disposeRef.current = onDispose;
  const commitRef = useRef(onCommit); commitRef.current = onCommit;
  const [message, setMessage] = useState("Получаем право редактирования. Ввод пока хранится отдельно.");
  const input = useEditor({
    extensions: createEditorCoreExtensions(), content: initial.doc, immediatelyRender: true,
    editorProps: { attributes: { class: "editor-core-content", role: "textbox", "aria-label": `Локальный ввод: ${ariaLabel}` } },
    onUpdate: ({ editor }) => storeCandidate({ text: editor.getText({ blockSeparator: "\n" }), doc: editor.getJSON() }),
  });
  const finish = () => {
    if (!active.current || !input || !granted.current || composing.current || input.view.composing) return;
    if (!commitRef.current(input)) setMessage("Локальный ввод сохранён отдельно. Актуальный текст изменился; скопируйте нужный фрагмент после сравнения.");
  };
  const enter = () => {
    void requestEdit().then((ok) => {
      if (!active.current) return;
      granted.current = ok;
      if (!ok) setMessage("Право редактирования не получено. Локальный ввод сохранён отдельно.");
      window.setTimeout(finish, 0);
    });
  };
  useLayoutEffect(() => {
    active.current = true;
    if (input) {
      input.commands.setTextSelection({ from: initial.from, to: initial.to });
      input.view.focus();
    }
    enter();
    return () => { active.current = false; disposeRef.current(); };
  }, [input]);
  return <div className="pending-field-input"
    onCompositionStartCapture={() => { composing.current = true; }}
    onCompositionEndCapture={() => { composing.current = false; window.setTimeout(finish, 40); }}
    onInputCapture={() => { if (granted.current && !composing.current) window.setTimeout(finish, 40); }}>
    <EditorContent editor={input} />
    <small role="status">{message}</small>
    {!granted.current && <button type="button" onClick={enter}>Повторить вход</button>}
  </div>;
}
