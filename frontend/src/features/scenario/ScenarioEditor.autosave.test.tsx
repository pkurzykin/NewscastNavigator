import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../editor-core/EditorField", async () => {
  const React = await import("react");
  const moveCaretToEnd = (element: HTMLElement) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  return {
    EditorCoreField: function EditorCoreField({
      editorId,
      richTextTarget,
      plainTextValue,
      disabled,
      className,
      ariaLabel,
      style,
      onFocusField,
      onChangeValue,
      onRegister,
      onSelectionChange,
    }: any) {
      const content = React.useRef({
        text: richTextTarget?.text ?? plainTextValue,
        html: richTextTarget?.html ?? plainTextValue,
      });
      const latest = React.useRef({ content: content.current, onChangeValue });
      latest.current = { content: content.current, onChangeValue };
      const editor = React.useRef<any>(null);

      if (!editor.current) {
        const run = () => {
          const current = latest.current.content;
          latest.current.onChangeValue({
            editor: "tiptap",
            text: current.text,
            html: current.html,
            doc: { type: "doc", content: [{ type: "paragraph", content: current.text ? [{ type: "text", text: current.text }] : [] }] },
          });
          return true;
        };
        const chain: any = {
          focus: () => chain,
          setFontFamily: () => chain,
          setMark: () => chain,
          unsetMark: () => chain,
          setHighlight: () => chain,
          run,
        };
        editor.current = { chain: () => chain };
      }

      React.useEffect(() => {
        onRegister(editorId, editor.current);
        return () => onRegister(editorId, null);
      }, [editorId, onRegister]);

      return <div className={`${className} editor-core-field rich-text-field`} style={style}>
        <div
          className="editor-core-content"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-label={ariaLabel}
          dangerouslySetInnerHTML={{ __html: content.current.html }}
          onFocus={(event) => {
            moveCaretToEnd(event.currentTarget);
            onFocusField();
            onSelectionChange(editorId);
          }}
          onInput={(event) => {
            const text = event.currentTarget.textContent ?? "";
            const html = event.currentTarget.innerHTML;
            const next = { text, html };
            content.current = next;
            latest.current.content = next;
            onChangeValue({
              editor: "tiptap",
              text,
              html,
              doc: { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }] },
            });
          }}
        />
      </div>;
    },
  };
});

import ScenarioEditor from "./components/ScenarioEditor";
import { createDeferred } from "../../test/deferred";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

function appendEditorText(editor: HTMLElement, text: string) {
  editor.textContent = `${editor.textContent ?? ""}${text}`;
  fireEvent.input(editor);
}

describe("ScenarioEditor autosave", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("preserves input made while an acknowledgement-only save is in flight", async () => {
    const pendingSave = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario") && init?.method === "PUT") return pendingSave.promise;
      if (url.endsWith("/scenario/lease")) return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: 0 });
      if (url.endsWith("/scenario")) {
        return response({
          story: { id: 101, title: "Синтетический сюжет" },
          scenario: { revision: 0, rows: [{ segment_uid: "seg_00000000-0000-4000-8000-000000000001", order_index: 1, block_type: "zk", text: "Базовый текст", speaker_text: "", file_name: "", tc_in: "", tc_out: "", additional_comment: "", structured_data: {}, formatting: {}, rich_text: { schema_version: 1, targets: {} } }] },
          edit: { state: "available" },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    appendEditorText(editor, " до запроса");
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/scenario") && init?.method === "PUT")).toBe(true), { timeout: 2_000 });
    appendEditorText(editor, " после запроса");

    await act(async () => {
      pendingSave.resolve(response({ ok: true, client_save_id: "save", revision: 1, saved_at: "2026-07-12T12:00:00Z" }));
      await pendingSave.promise;
    });

    expect(editor).toHaveTextContent("Базовый текст до запроса после запроса");
  });

  it("warns before leaving while a local draft is dirty", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/scenario/lease")) return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: 0 });
      if (url.endsWith("/scenario") && init?.method === "PUT") return response({ ok: true, client_save_id: "save", revision: 1, saved_at: "2026-07-12T12:00:00Z" });
      if (url.endsWith("/scenario")) {
        return response({
          story: { id: 101, title: "Синтетический сюжет" },
          scenario: { revision: 0, rows: [{ segment_uid: "seg_00000000-0000-4000-8000-000000000001", order_index: 1, block_type: "zk", text: "Базовый текст", speaker_text: "", file_name: "", tc_in: "", tc_out: "", additional_comment: "", structured_data: {}, formatting: {}, rich_text: { schema_version: 1, targets: {} } }] },
          edit: { state: "available" },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    appendEditorText(editor, " локальная правка");
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
