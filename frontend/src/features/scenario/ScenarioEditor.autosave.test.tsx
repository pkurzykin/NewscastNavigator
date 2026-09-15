import { scenarioDraftKey } from "./draftStorage";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../editor-core/EditorField", async () => {
  const React = await import("react");
  const { useFieldEditAccess } = await import("./ScenarioAccessContext");
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
      const access = useFieldEditAccess();
      const accessRef = React.useRef(access); accessRef.current = access;
      const pendingValue = React.useRef<any>(null);
      const deliver = (payload: any) => {
        if (!accessRef.current || accessRef.current.canMutate()) { onChangeValue(payload); return; }
        pendingValue.current = payload;
        void accessRef.current.requestEdit().then((ok) => { if (ok && pendingValue.current) { const next = pendingValue.current; pendingValue.current = null; onChangeValue(next); } });
      };
      const domRef = React.useRef<HTMLDivElement | null>(null);
      const content = React.useRef({
        text: richTextTarget?.text ?? plainTextValue,
        html: richTextTarget?.html ?? plainTextValue,
      });
      const latest = React.useRef({ content: content.current, onChangeValue });
      latest.current = { content: content.current, onChangeValue };
      const editor = React.useRef<any>(null);
      const [searchHighlights, setSearchHighlights] = React.useState<any[]>([]);
      const controller = React.useMemo(() => ({
        focusRange(from: number, to: number) {
          domRef.current?.focus();
          if (domRef.current) domRef.current.dataset.focusRange = `${from}:${to}`;
        },
        setSearchHighlights(ranges: any[]) {
          setSearchHighlights(ranges);
        },
      }), []);

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
        editor.current = { chain: () => chain, state: { selection: { empty: true, from: 1, to: 1 } }, getAttributes: () => ({}) };
      }

      React.useEffect(() => {
        onRegister(editorId, editor.current, controller);
        return () => onRegister(editorId, null, null);
      }, [controller, editorId, onRegister]);

      React.useLayoutEffect(() => {
        const text = richTextTarget?.text ?? plainTextValue;
        const html = richTextTarget?.html ?? text;
        content.current = { text, html };
        latest.current.content = content.current;
        if (domRef.current && domRef.current.innerHTML !== html) {
          domRef.current.innerHTML = html;
        }
      }, [plainTextValue, richTextTarget]);

      return <div className={`${className} editor-core-field rich-text-field`} style={style}>
        <div
          ref={domRef}
          className="editor-core-content"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-label={ariaLabel}
          data-search-highlights={JSON.stringify(searchHighlights)}
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
            deliver({
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
import { navigate } from "../../app/AppRouter";
import { resetMetadataSaveCoordinatorsForTests } from "./metadataSaveCoordinator";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

let fixtureCanEnter = true;
async function enterEditorIfAvailable() {
  if (!fixtureCanEnter) return;
  const toggle = screen.queryByRole("switch", { name: "Редактирование сценария" });
  if (!toggle || (toggle as HTMLInputElement).checked) return;
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
}

function installScenarioFetchMock(fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  let edit: any = { state: "available" };
  let revision = 0; fixtureCanEnter = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/scenario/access")) return response({ story_id: Number(url.match(/stories\/(\d+)/)?.[1]), revision, edit });
    const res = await fetchMock(input, init).catch((error) => {
      if (url.endsWith("/scenario/lease") && String(error).includes("Unexpected request")) return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision });
      throw error;
    });
    if (url.endsWith("/scenario") && !init?.method) {
      const next = await res.clone().json(); edit = next.edit; revision = next.scenario.revision; fixtureCanEnter = edit.state === "available";
    }
    if (url.endsWith("/scenario/lease") && init?.method === "POST" && res.ok) {
      const next = await res.clone().json(); edit = { state: "mine", edit_session_id: next.edit_session_id, expires_at: next.expires_at };
    }
    if (url.endsWith("/scenario/lease") && init?.method === "DELETE" && res.ok) edit = { state: "available" };
    return res;
  });
}

function errorResponse(message: string, status = 503): Response {
  return new Response(JSON.stringify({ error: { code: "WORKFLOW_TEMPORARY", message, details: {} } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const workflowModel = (changedAfterProofread = false) => ({
  story_id: 101,
  review_request: null,
  editorial_check: null,
  proofread: {
    revision: 0,
    actor: { id: 4, username: "mayak", display_name: "Маяк", position: "Корректор", function_codes: ["proofreader"] },
    at: "2026-07-15T09:00:00Z",
  },
  changed_after_proofread: changedAfterProofread,
  reproofread_request: null,
  primary_action: changedAfterProofread ? {
    code: "request_reproofread",
    label: "Назначить повторную вычитку",
    method: "POST",
    href: "/api/v1/stories/101/workflow/request-reproofread",
    emphasis: "primary",
    confirmation: null,
    form: null,
  } : null,
  additional_actions: [],
});

const scenarioModel = () => ({
  story: {
    id: 101,
    title: "Синтетический сюжет",
    duration_text: "00:30",
    rubric: { id: 1, name: "Новости" },
  },
  scenario: { revision: 0, rows: [{ segment_uid: "seg_00000000-0000-4000-8000-000000000001", order_index: 1, block_type: "zk", text: "Базовый текст", speaker_text: "", file_name: "", tc_in: "", tc_out: "", additional_comment: "", structured_data: {}, formatting: {}, rich_text: { schema_version: 1, targets: {} } }] },
  edit: { state: "available" },
  metadata: {
    editable: true,
    rubrics: [
      { id: 1, name: "Новости" },
      { id: 2, name: "Спорт" },
    ],
  },
  captionpanels: null,
});

function docxResponse(filename = "Синтетический-сценарий.docx"): Response {
  return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function installDownloadSpies() {
  const createObjectURL = vi.fn(() => "blob:synthetic-docx");
  const revokeObjectURL = vi.fn();
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  return { click, createObjectURL, revokeObjectURL };
}

function appendEditorText(editor: HTMLElement, text: string) {
  editor.textContent = `${editor.textContent ?? ""}${text}`;
  fireEvent.input(editor);
}

describe("ScenarioEditor autosave", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/stories/101/scenario");
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    resetMetadataSaveCoordinatorsForTests();
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
    } else {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
    } else {
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    }
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });
  it("restores a font-only local draft with identical server text as a complete snapshot", async () => {
    const model = scenarioModel();
    window.localStorage.setItem(scenarioDraftKey(101, 1), JSON.stringify({ revision: 0, rows: model.scenario.rows, default_font_family: "Franklin Gothic Book", saved_at: "2026-09-15T00:00:00Z" }));
    const saved: any[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: 0 });
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)); saved.push(payload);
        return response({ ok: true, client_save_id: payload.client_save_id, revision: 1, saved_at: "2026-09-15T00:00:00Z" });
      }
      if (url.endsWith("/scenario")) return response({ ...model, scenario: { ...model.scenario, default_font_family: "PT Sans" } });
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} userFunctions={["author"]} />);
    await screen.findByRole("alertdialog");
    expect(screen.getByText("Основной шрифт: Franklin Gothic Book")).toBeInTheDocument();
    expect(screen.getByText("Основной шрифт: PT Sans")).toBeInTheDocument();
    expect(saved).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Продолжить с локальным текстом" }));
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 2000 });
    expect(saved[0]).toMatchObject({ default_font_family: "Franklin Gothic Book", rows: model.scenario.rows });
    expect(screen.getByRole("combobox", { name: "Шрифт сценария" })).toHaveValue("Franklin Gothic Book");
  });

  it("acquires on font intent, persists font-only snapshots, and preserves them through undo and redo", async () => {
    const saved: any[] = [];
    let font = "PT Sans";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: saved.length });
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)); saved.push(payload); font = payload.default_font_family;
        return response({ ok: true, client_save_id: payload.client_save_id, revision: saved.length, saved_at: "2026-07-15T10:00:00Z" });
      }
      if (url.endsWith("/scenario")) { const model = scenarioModel(); return response({ ...model, scenario: { ...model.scenario, default_font_family: font, revision: saved.length } }); }
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} userFunctions={["author"]} />);
    const select = await screen.findByRole("combobox", { name: "Шрифт сценария" });
    fireEvent.change(select, { target: { value: "Franklin Gothic Book" } });
    await waitFor(() => expect(saved).toHaveLength(1), { timeout: 2000 });
    expect(saved[0].default_font_family).toBe("Franklin Gothic Book");
    expect(saved[0].rows[0].formatting).toEqual({});
    fireEvent.click(screen.getByRole("button", { name: /Отменить/ }));
    await waitFor(() => expect(saved).toHaveLength(2), { timeout: 2000 });
    expect(saved[1].default_font_family).toBe("PT Sans");
    fireEvent.click(screen.getByRole("button", { name: /Повторить/ }));
    await waitFor(() => expect(saved).toHaveLength(3), { timeout: 2000 });
    expect(saved[2].default_font_family).toBe("Franklin Gothic Book");
    expect(saved[2].rows).toEqual(saved[0].rows);
  });

  it("coalesces two Tiptap keystrokes and saves one undo and one redo snapshot", async () => {
    const savedRows: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: savedRows.length });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        savedRows.push(payload.rows[0].text);
        return response({ ok: true, client_save_id: payload.client_save_id, revision: savedRows.length, saved_at: "2026-07-15T10:00:00Z" });
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    editor.focus();
    appendEditorText(editor, "а");
    appendEditorText(editor, "б");

    expect(screen.getByRole("button", { name: "Отменить" })).toBeEnabled();
    expect(fireEvent.keyDown(editor, { key: "z", metaKey: true })).toBe(false);
    expect(editor).toHaveTextContent("Базовый текст");
    await waitFor(() => expect(savedRows).toHaveLength(1), { timeout: 2_000 });
    expect(savedRows).toEqual(["Базовый текст"]);

    expect(fireEvent.keyDown(editor, { key: "z", metaKey: true, shiftKey: true })).toBe(false);
    expect(editor).toHaveTextContent("Базовый текстаб");
    await waitFor(() => expect(savedRows).toHaveLength(2), { timeout: 2_000 });
    expect(savedRows).toEqual(["Базовый текст", "Базовый текстаб"]);
  });

  it("breaks typing history when focus leaves and returns to the same scenario field", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    const comment = screen.getByRole("textbox", { name: "В кадре 1" });
    editor.focus();
    appendEditorText(editor, "а");
    comment.focus();
    editor.focus();
    appendEditorText(editor, "б");

    expect(fireEvent.keyDown(editor, { key: "z", metaKey: true })).toBe(false);
    expect(editor).toHaveTextContent("Базовый текста");
  });

  it("preserves native undo in metadata and search fields while scenario undo remains global", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    editor.focus();
    appendEditorText(editor, "а");

    const metadataTargets = [
      screen.getByRole("textbox", { name: "Название" }),
      screen.getByRole("combobox", { name: "Рубрика" }),
      screen.getByRole("textbox", { name: "Хронометраж" }),
    ];
    for (const target of metadataTargets) {
      expect(fireEvent.keyDown(target, { key: "z", metaKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: "y", ctrlKey: true })).toBe(true);
      expect(editor).toHaveTextContent("Базовый текста");
    }

    fireEvent.click(screen.getByRole("button", { name: "Найти и заменить" }));
    const searchTargets = [
      screen.getByRole("searchbox", { name: "Найти" }),
      screen.getByRole("textbox", { name: "Заменить на" }),
    ];
    for (const target of searchTargets) {
      expect(fireEvent.keyDown(target, { key: "z", metaKey: true })).toBe(true);
      expect(fireEvent.keyDown(target, { key: "y", ctrlKey: true })).toBe(true);
      expect(editor).toHaveTextContent("Базовый текста");
    }

    fireEvent.click(screen.getByRole("button", { name: "Закрыть поиск" }));
    expect(fireEvent.keyDown(document.body, { key: "z", metaKey: true })).toBe(false);
    expect(editor).toHaveTextContent("Базовый текст");
  });

  it.each(["held", "archived"] as const)(
    "does not intercept undo shortcuts in read-only %s state",
    async (editState) => {
      const model = { ...scenarioModel(), edit: { state: editState } };
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/workflow")) return response(workflowModel());
        if (url.endsWith("/scenario")) return response(model);
        throw new Error(`Unexpected request ${url}`);
      });
      installScenarioFetchMock(fetchMock);
      render(<ScenarioEditor storyId={101} userId={1} />);

      const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
      expect(fireEvent.keyDown(editor, { key: "z", ctrlKey: true })).toBe(true);
      expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Повторить" })).toBeDisabled();
    },
  );

  it("opens find inside the editor, drives every field highlight and restores focus on close", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    editor.focus();
    expect(fireEvent.keyDown(editor, { key: "f", metaKey: true })).toBe(false);
    const query = screen.getByRole("searchbox", { name: "Найти" });
    expect(query).toHaveFocus();
    await user.type(query, "Базовый");

    await waitFor(() => expect(editor).toHaveAttribute(
      "data-search-highlights",
      JSON.stringify([{ from: 0, to: 7, active: true }]),
    ));
    editor.focus();
    expect(query).not.toHaveFocus();
    expect(fireEvent.keyDown(editor, { key: "f", metaKey: true })).toBe(false);
    expect(query).toHaveFocus();
    expect(query).toHaveValue("Базовый");
    await user.click(screen.getByRole("button", { name: "Следующее совпадение" }));
    await waitFor(() => expect(editor).toHaveFocus());
    expect(editor).toHaveAttribute("data-focus-range", "0:7");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });

    fireEvent.keyDown(screen.getByRole("search", { name: "Найти и заменить" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("search", { name: "Найти и заменить" }))
      .not.toBeInTheDocument());
    expect(editor).toHaveFocus();
    expect(editor).toHaveAttribute("data-search-highlights", "[]");
  });

  it("keeps find available read-only without intercepting the unavailable replace shortcut", async () => {
    const model = { ...scenarioModel(), edit: { state: "archived" } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario")) return response(model);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    expect(screen.getByRole("button", { name: "Найти" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Найти и заменить" })).toBeDisabled();
    expect(fireEvent.keyDown(editor, { key: "h", ctrlKey: true })).toBe(true);
    expect(screen.queryByRole("search", { name: "Найти и заменить" })).not.toBeInTheDocument();
    expect(fireEvent.keyDown(editor, { key: "f", ctrlKey: true })).toBe(false);
    expect(await screen.findByRole("search", { name: "Найти и заменить" })).toBeInTheDocument();
  });

  it("replaces all prose matches in one save and one undo step without touching technical fields", async () => {
    const user = userEvent.setup();
    const initial = {
      ...scenarioModel(),
      scenario: {
        revision: 0,
        rows: [{
          ...scenarioModel().scenario.rows[0],
          text: "мир и мир",
          file_name: "мир.mov",
          tc_in: "мир",
          tc_out: "мир",
          rich_text: {
            schema_version: 1,
            targets: {
              text: {
                editor: "tiptap",
                text: "мир и мир",
                html: "<p><strong>мир</strong> и мир</p>",
                doc: {
                  type: "doc",
                  content: [{
                    type: "paragraph",
                    content: [
                      { type: "text", marks: [{ type: "bold" }], text: "мир" },
                      { type: "text", text: " и мир" },
                    ],
                  }],
                },
              },
            },
          },
        }, {
          ...scenarioModel().scenario.rows[0],
          segment_uid: "seg_00000000-0000-4000-8000-000000000002",
          order_index: 2,
          text: "ещё мир",
          file_name: "служебный-мир.mov",
        }],
      },
    };
    const savedPayloads: Array<Record<string, any>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: savedPayloads.length });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        savedPayloads.push(payload);
        return response({ ok: true, client_save_id: payload.client_save_id, revision: savedPayloads.length, saved_at: "2026-07-15T10:00:00Z" });
      }
      if (url.endsWith("/scenario")) return response(initial);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    await user.click(screen.getByRole("button", { name: "Найти и заменить" }));
    await user.type(screen.getByRole("searchbox", { name: "Найти" }), "мир");
    await user.type(screen.getByRole("textbox", { name: "Заменить на" }), "свет");
    await user.click(screen.getByRole("button", { name: "Заменить всё" }));

    expect(screen.getByRole("textbox", { name: "Текст блока 1" })).toHaveTextContent("свет и свет");
    expect(screen.getByRole("textbox", { name: "Текст блока 2" })).toHaveTextContent("ещё свет");
    await waitFor(() => expect(savedPayloads).toHaveLength(1), { timeout: 2_000 });
    expect(savedPayloads[0].rows.map((row: Record<string, unknown>) => row.text))
      .toEqual(["свет и свет", "ещё свет"]);
    expect(savedPayloads[0].rows[0]).toMatchObject({
      file_name: "мир.mov",
      tc_in: "мир",
      tc_out: "мир",
    });
    expect(savedPayloads[0].rows[1]).toMatchObject({ file_name: "служебный-мир.mov" });
    expect(savedPayloads[0].rows[0].rich_text.targets.text.html)
      .toBe("<p><strong>свет</strong> и свет</p>");

    await user.click(screen.getByRole("button", { name: "Отменить" }));
    expect(screen.getByRole("textbox", { name: "Текст блока 1" })).toHaveTextContent("мир и мир");
    expect(screen.getByRole("textbox", { name: "Текст блока 2" })).toHaveTextContent("ещё мир");
    await waitFor(() => expect(savedPayloads).toHaveLength(2), { timeout: 2_000 });
    expect(savedPayloads[1].rows.map((row: Record<string, unknown>) => row.text))
      .toEqual(["мир и мир", "ещё мир"]);
  });

  it("continues single replacement after inserted query text, then wraps after the last match", async () => {
    const user = userEvent.setup();
    const initial = {
      ...scenarioModel(),
      scenario: {
        revision: 0,
        rows: [{ ...scenarioModel().scenario.rows[0], text: "a a a" }],
      },
    };
    const savedTexts: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: savedTexts.length });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        savedTexts.push(payload.rows[0].text);
        return response({ ok: true, client_save_id: payload.client_save_id, revision: savedTexts.length, saved_at: "2026-07-15T10:00:00Z" });
      }
      if (url.endsWith("/scenario")) return response(initial);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    await user.click(screen.getByRole("button", { name: "Найти и заменить" }));
    await user.type(screen.getByRole("searchbox", { name: "Найти" }), "a");
    await user.type(screen.getByRole("textbox", { name: "Заменить на" }), "aa");
    await user.click(screen.getByRole("button", { name: "Следующее совпадение" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 из 3");

    await user.click(screen.getByRole("button", { name: "Заменить" }));

    expect(editor).toHaveTextContent("a aa a");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("4 из 4"));
    expect(editor).toHaveAttribute("data-search-highlights", JSON.stringify([
      { from: 0, to: 1, active: false },
      { from: 2, to: 3, active: false },
      { from: 3, to: 4, active: false },
      { from: 5, to: 6, active: true },
    ]));
    await waitFor(() => expect(savedTexts).toEqual(["a aa a"]), { timeout: 2_000 });

    await user.click(screen.getByRole("button", { name: "Заменить" }));

    expect(editor).toHaveTextContent("a aa aa");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 из 5"));
    expect(editor).toHaveAttribute("data-search-highlights", JSON.stringify([
      { from: 0, to: 1, active: true },
      { from: 2, to: 3, active: false },
      { from: 3, to: 4, active: false },
      { from: 5, to: 6, active: false },
      { from: 6, to: 7, active: false },
    ]));
    await waitFor(() => expect(savedTexts).toEqual(["a aa a", "a aa aa"]), { timeout: 2_000 });
    await user.click(screen.getByRole("button", { name: "Отменить" }));
    expect(editor).toHaveTextContent("a aa a");
  });

  it("continues case-insensitive single replacement past its own matching replacement", async () => {
    const user = userEvent.setup();
    const initial = {
      ...scenarioModel(),
      scenario: {
        revision: 0,
        rows: [{ ...scenarioModel().scenario.rows[0], text: "Browser потом Browser" }],
      },
    };
    const savedTexts: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: savedTexts.length });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body));
        savedTexts.push(payload.rows[0].text);
        return response({ ok: true, client_save_id: payload.client_save_id, revision: savedTexts.length, saved_at: "2026-07-15T10:00:00Z" });
      }
      if (url.endsWith("/scenario")) return response(initial);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    await user.click(screen.getByRole("button", { name: "Найти и заменить" }));
    await user.type(screen.getByRole("searchbox", { name: "Найти" }), "Browser");
    await user.type(screen.getByRole("textbox", { name: "Заменить на" }), "browser");
    await user.click(screen.getByRole("button", { name: "Заменить" }));

    expect(editor).toHaveTextContent("browser потом Browser");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 из 2"));
    expect(editor).toHaveAttribute("data-search-highlights", JSON.stringify([
      { from: 0, to: 7, active: false },
      { from: 14, to: 21, active: true },
    ]));
    await waitFor(() => expect(savedTexts).toEqual(["browser потом Browser"]), { timeout: 2_000 });
  });

  it("treats an exact single replacement as a no-op with no history or save", async () => {
    const user = userEvent.setup();
    let saves = 0;
    const initial = scenarioModel();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: 0 });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        saves += 1;
        return response({ ok: true, client_save_id: "unexpected", revision: 1, saved_at: "2026-07-15T10:00:00Z" });
      }
      if (url.endsWith("/scenario")) return response(initial);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    await user.click(screen.getByRole("button", { name: "Найти и заменить" }));
    await user.type(screen.getByRole("searchbox", { name: "Найти" }), "Базовый");
    await user.type(screen.getByRole("textbox", { name: "Заменить на" }), "Базовый");
    await user.click(screen.getByRole("button", { name: "Заменить" }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });

    expect(editor).toHaveTextContent("Базовый текст");
    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    expect(saves).toBe(0);
    expect(initial.scenario.rows[0].rich_text.targets).toEqual({});
  });

  it("keeps replaced local rows and their undo step after a save failure", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: 0 });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        return errorResponse("Сохранение замены временно недоступно");
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    render(<ScenarioEditor storyId={101} userId={1} />);

    await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    await user.click(screen.getByRole("button", { name: "Найти и заменить" }));
    await user.type(screen.getByRole("searchbox", { name: "Найти" }), "Базовый");
    await user.type(screen.getByRole("textbox", { name: "Заменить на" }), "Новый");
    await user.click(screen.getByRole("button", { name: "Заменить всё" }));

    expect(await screen.findByRole("alert", {}, { timeout: 2_000 }))
      .toHaveTextContent("Сохранение замены временно недоступно");
    const editor = screen.getByRole("textbox", { name: "Текст блока 1" });
    expect(editor).toHaveTextContent("Новый текст");
    const undo = screen.getByRole("button", { name: "Отменить" });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(editor).toHaveTextContent("Базовый текст");
  });

  it("preserves undo history after a transient save error", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: 0 });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        return errorResponse("Сеть временно недоступна");
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    appendEditorText(editor, " несохранённая правка");
    expect(await screen.findByRole("alert", {}, { timeout: 2_000 }))
      .toHaveTextContent("Сеть временно недоступна");

    const undo = screen.getByRole("button", { name: "Отменить" });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(editor).toHaveTextContent("Базовый текст");
  });

  it("resets history when the story id changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.includes("/stories/202/scenario")) {
        return response({
          ...scenarioModel(),
          story: { ...scenarioModel().story, id: 202, title: "Другой сюжет" },
          scenario: {
            revision: 0,
            rows: [{ ...scenarioModel().scenario.rows[0], segment_uid: "seg_202", text: "Другой текст" }],
          },
        });
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    const { rerender } = render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    appendEditorText(editor, " локальная правка");
    expect(screen.getByRole("button", { name: "Отменить" })).toBeEnabled();

    rerender(<ScenarioEditor storyId={202} userId={1} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Текст блока 1" })).toHaveTextContent("Другой текст"));
    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDisabled();
  });

  it("blocks every old-story edit path while the next story is hydrating", async () => {
    const nextScenario = createDeferred<Response>();
    let nextStoryLeases = 0;
    let nextStorySaves = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.includes("/stories/202/scenario/lease")) {
        nextStoryLeases += 1;
        return response({
          edit_session_id: 8,
          lease_token: "next-lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.includes("/stories/202/scenario") && init?.method === "PUT") {
        nextStorySaves += 1;
        return response({
          ok: true,
          client_save_id: "next-save",
          revision: 1,
          saved_at: "2026-07-15T10:00:00Z",
        });
      }
      if (url.includes("/stories/202/scenario")) return nextScenario.promise;
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    const { rerender } = render(<ScenarioEditor storyId={101} userId={1} />);
    await screen.findByRole("textbox", { name: "Текст блока 1" });
    rerender(<ScenarioEditor storyId={202} userId={1} />);

    const staleRichText = screen.queryByRole("textbox", { name: "Текст блока 1" });
    if (staleRichText) appendEditorText(staleRichText, " не должна попасть в другой сюжет");
    const staleBlockType = screen.queryByRole("combobox", { name: "Тип блока 1" });
    if (staleBlockType) fireEvent.change(staleBlockType, { target: { value: "snh" } });
    const staleAddButton = screen.queryByRole("button", { name: "+ Лайф" });
    if (staleAddButton) fireEvent.click(staleAddButton);
    expect(fireEvent.keyDown(window, { key: "z", ctrlKey: true })).toBe(true);

    expect(screen.getByRole("status")).toHaveTextContent("Загрузка сценария...");
    expect(screen.queryByRole("textbox", { name: "Текст блока 1" })).not.toBeInTheDocument();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(nextStoryLeases).toBe(0);
    expect(nextStorySaves).toBe(0);

    nextScenario.resolve(response({
      ...scenarioModel(),
      story: { ...scenarioModel().story, id: 202, title: "Гидратированный сюжет" },
      scenario: {
        revision: 0,
        rows: [{
          ...scenarioModel().scenario.rows[0],
          segment_uid: "seg_00000000-0000-4000-8000-000000000202",
          text: "Текст нового сюжета",
        }],
      },
    }));

    const nextEditor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    expect(nextEditor).toHaveTextContent("Текст нового сюжета");
    expect(nextEditor).toHaveAttribute("contenteditable", "true");
    expect(screen.getByRole("button", { name: "+ Лайф" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDisabled();
  });
  it("flushes text and the shared metadata coordinator before one DOCX request and download", async () => {
    const pendingScenario = createDeferred<Response>();
    const pendingMetadata = createDeferred<Response>();
    const events: string[] = [];
    const exportPayloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 3,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        events.push("scenario-put");
        return pendingScenario.promise;
      }
      if (url.endsWith("/metadata") && init?.method === "PATCH") {
        events.push("metadata-patch");
        return pendingMetadata.promise;
      }
      if (url.endsWith("/scenario/export-docx") && init?.method === "POST") {
        events.push("export-post");
        exportPayloads.push(JSON.parse(String(init.body)));
        return docxResponse();
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const downloads = installDownloadSpies();

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    const title = screen.getByRole("textbox", { name: "Название" });
    const duration = screen.getByRole("textbox", { name: "Хронометраж" });
    appendEditorText(editor, " прямо перед экспортом");
    fireEvent.change(title, { target: { value: "Подтверждённый экспорт" } });
    fireEvent.change(duration, { target: { value: " 02:15 " } });

    const exportButton = screen.getByRole("button", { name: "Экспорт DOCX" });
    fireEvent.click(exportButton);
    fireEvent.click(exportButton);

    expect(screen.getByRole("button", { name: "Подготавливаем DOCX…" }))
      .toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Подготавливаем DOCX…" })).toBeDisabled();
    await waitFor(() => {
      expect(events).toEqual(expect.arrayContaining(["scenario-put", "metadata-patch"]));
    });
    expect(events).not.toContain("export-post");
    expect(downloads.click).not.toHaveBeenCalled();

    pendingScenario.resolve(response({
      ok: true,
      client_save_id: "save",
      revision: 1,
      saved_at: "2026-07-15T10:00:00Z",
    }));
    await pendingScenario.promise;
    await act(async () => { await Promise.resolve(); });
    expect(events).not.toContain("export-post");

    pendingMetadata.resolve(response({
      ok: true,
      event_id: null,
      changed_at: "2026-07-15T10:00:00Z",
      resource: { type: "story", id: 101 },
    }));
    await pendingMetadata.promise;

    await waitFor(() => expect(downloads.click).toHaveBeenCalledOnce());
    expect(events.filter((event) => event === "export-post")).toHaveLength(1);
    expect(events.at(-1)).toBe("export-post");
    expect(exportPayloads).toEqual([{
      expected_revision: 1,
      expected_title: "Подтверждённый экспорт",
      expected_rubric_id: 1,
      expected_duration_text: "02:15",
    }]);
    const scenarioRequest = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith("/scenario") && init?.method === "PUT");
    const metadataRequest = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith("/metadata") && init?.method === "PATCH");
    expect(JSON.parse(String(scenarioRequest?.[1]?.body)).rows[0].text)
      .toBe("Базовый текст прямо перед экспортом");
    expect(JSON.parse(String(metadataRequest?.[1]?.body))).toEqual({
      title: "Подтверждённый экспорт",
      duration_text: "02:15",
    });
    expect(downloads.createObjectURL).toHaveBeenCalledOnce();
    expect(downloads.revokeObjectURL).toHaveBeenCalledOnce();
    expect(editor).toHaveTextContent("Базовый текст прямо перед экспортом");
    expect(title).toHaveValue("Подтверждённый экспорт");
    expect(duration).toHaveValue("02:15");
  });

  it("uses the header coordinator retained by ScenarioEditor across StrictMode effect replay", async () => {
    const exportPayloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/metadata") && init?.method === "PATCH") {
        return response({ ok: true });
      }
      if (url.endsWith("/scenario/export-docx") && init?.method === "POST") {
        exportPayloads.push(JSON.parse(String(init.body)));
        return docxResponse();
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const downloads = installDownloadSpies();

    render(
      <StrictMode>
        <ScenarioEditor storyId={101} userId={1} />
      </StrictMode>,
    );
    const duration = await screen.findByRole("textbox", { name: "Хронометраж" });
    await enterEditorIfAvailable();
    fireEvent.change(duration, { target: { value: "04:40" } });
    fireEvent.blur(duration);
    fireEvent.click(screen.getByRole("button", { name: "Экспорт DOCX" }));

    await waitFor(() => expect(downloads.click).toHaveBeenCalledOnce());
    expect(exportPayloads).toEqual([{
      expected_revision: 0,
      expected_title: "Синтетический сюжет",
      expected_rubric_id: 1,
      expected_duration_text: "04:40",
    }]);
  });

  it("shares the StrictMode coordinator after a rubric acknowledgement and flushes newer metadata before export", async () => {
    // Production mutation: letting the parent reacquire after a rubric ack while the header
    // keeps its old coordinator must make POST overtake the new metadata PATCH here.
    const pendingLatestMetadata = createDeferred<Response>();
    const events: string[] = [];
    const metadataPayloads: Array<Record<string, unknown>> = [];
    const exportPayloads: Array<Record<string, unknown>> = [];
    let metadataRequestCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/metadata") && init?.method === "PATCH") {
        metadataRequestCount += 1;
        events.push("metadata-patch");
        metadataPayloads.push(JSON.parse(String(init.body)));
        return metadataRequestCount === 1
          ? response({ ok: true })
          : pendingLatestMetadata.promise;
      }
      if (url.endsWith("/scenario/export-docx") && init?.method === "POST") {
        events.push("export-post");
        exportPayloads.push(JSON.parse(String(init.body)));
        return docxResponse();
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const downloads = installDownloadSpies();

    render(
      <StrictMode>
        <ScenarioEditor storyId={101} userId={1} />
      </StrictMode>,
    );
    fireEvent.change(await screen.findByRole("combobox", { name: "Рубрика" }), {
      target: { value: "2" },
    });
    await waitFor(() => expect(metadataPayloads).toEqual([{ rubric_id: 2 }]));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    events.splice(0);
    metadataPayloads.splice(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), {
      target: { value: "Новый заголовок после рубрики" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Хронометраж" }), {
      target: { value: "05:25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Экспорт DOCX" }));

    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(events).toEqual(["metadata-patch"]);
    expect(metadataPayloads).toEqual([{
      title: "Новый заголовок после рубрики",
      duration_text: "05:25",
    }]);
    expect(exportPayloads).toEqual([]);
    expect(downloads.click).not.toHaveBeenCalled();

    pendingLatestMetadata.resolve(response({ ok: true }));
    await waitFor(() => expect(downloads.click).toHaveBeenCalledOnce());
    expect(events).toEqual(["metadata-patch", "export-post"]);
    expect(exportPayloads).toEqual([{
      expected_revision: 0,
      expected_title: "Новый заголовок после рубрики",
      expected_rubric_id: 2,
      expected_duration_text: "05:25",
    }]);
  });

  it("shares the coordinator after conflict UI remount and flushes metadata before export", async () => {
    // Production mutation: releasing the clean coordinator while conflict UI hides the
    // header must make the remounted header edit a different instance from export.
    const pendingMetadata = createDeferred<Response>();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const events: string[] = [];
    const metadataPayloads: Array<Record<string, unknown>> = [];
    const exportPayloads: Array<Record<string, unknown>> = [];
    let scenarioReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 3,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        return new Response(JSON.stringify({
          error: {
            code: "SCENARIO_REVISION_CONFLICT",
            message: "Сценарий уже изменён",
            details: {},
          },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/metadata") && init?.method === "PATCH") {
        events.push("metadata-patch");
        metadataPayloads.push(JSON.parse(String(init.body)));
        return pendingMetadata.promise;
      }
      if (url.endsWith("/scenario/export-docx") && init?.method === "POST") {
        events.push("export-post");
        exportPayloads.push(JSON.parse(String(init.body)));
        return docxResponse();
      }
      if (url.endsWith("/scenario")) {
        scenarioReads += 1;
        return response(scenarioReads === 1
          ? scenarioModel()
          : {
              ...scenarioModel(),
              scenario: {
                revision: 2,
                rows: [{
                  ...scenarioModel().scenario.rows[0],
                  text: "Новый серверный текст",
                }],
              },
            });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const downloads = installDownloadSpies();

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    appendEditorText(editor, " конфликтная правка");
    fireEvent.click(screen.getByRole("button", { name: "Экспорт DOCX" }));

    const conflict = await screen.findByRole("alertdialog", {
      name: "Конфликт локального черновика",
    });
    const useServerButton = within(conflict).getByRole("button", {
      name: "Использовать текст с сервера",
    });
    await waitFor(() => expect(useServerButton).toBeEnabled());
    fireEvent.click(useServerButton);
    fireEvent.click(within(conflict).getByRole("button", {
      name: "Да, использовать текст с сервера",
    }));

    const title = await screen.findByRole("textbox", { name: "Название" });
    events.splice(0);
    fireEvent.change(title, { target: { value: "После разрешения конфликта" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Хронометраж" }), {
      target: { value: "06:10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Экспорт DOCX" }));

    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(events).toEqual(["metadata-patch"]);
    expect(metadataPayloads).toEqual([{
      title: "После разрешения конфликта",
      duration_text: "06:10",
    }]);
    expect(exportPayloads).toEqual([]);
    expect(downloads.click).not.toHaveBeenCalled();

    pendingMetadata.resolve(response({ ok: true }));
    await waitFor(() => expect(downloads.click).toHaveBeenCalledOnce());
    expect(events).toEqual(["metadata-patch", "export-post"]);
    expect(exportPayloads).toEqual([{
      expected_revision: 2,
      expected_title: "После разрешения конфликта",
      expected_rubric_id: 1,
      expected_duration_text: "06:10",
    }]);
  });

  it.each(["scenario save", "metadata save", "export request"] as const)(
    "fails closed on %s error and preserves the local editor state",
    async (failureStage) => {
      const requests: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/workflow")) return response(workflowModel());
        if (url.endsWith("/scenario/lease")) {
          return response({
            edit_session_id: 3,
            lease_token: "lease",
            expires_at: "2099-07-15T12:00:00Z",
            revision: 0,
          });
        }
        if (url.endsWith("/scenario") && init?.method === "PUT") {
          requests.push("scenario-put");
          return failureStage === "scenario save"
            ? errorResponse("Не удалось подтвердить текст")
            : response({
              ok: true,
              client_save_id: "save",
              revision: 1,
              saved_at: "2026-07-15T10:00:00Z",
            });
        }
        if (url.endsWith("/metadata") && init?.method === "PATCH") {
          requests.push("metadata-patch");
          return failureStage === "metadata save"
            ? errorResponse("Не удалось подтвердить данные сюжета")
            : response({ ok: true });
        }
        if (url.endsWith("/scenario/export-docx") && init?.method === "POST") {
          requests.push("export-post");
          return failureStage === "export request"
            ? errorResponse("Снимок сценария уже изменился", 409)
            : docxResponse();
        }
        if (url.endsWith("/scenario")) return response(scenarioModel());
        throw new Error(`Unexpected request ${url}`);
      });
      installScenarioFetchMock(fetchMock);
      const downloads = installDownloadSpies();

      render(<ScenarioEditor storyId={101} userId={1} />);
      const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
      const title = screen.getByRole("textbox", { name: "Название" });
      appendEditorText(editor, " остаётся локально");
      fireEvent.change(title, { target: { value: "Нескачанный локальный заголовок" } });
      fireEvent.click(screen.getByRole("button", { name: "Экспорт DOCX" }));

      const alert = await screen.findByText(/Не удалось экспортировать DOCX/, {
        selector: '[role="alert"]',
      });
      expect(alert).toHaveTextContent("Не удалось экспортировать DOCX");
      expect(downloads.click).not.toHaveBeenCalled();
      expect(editor).toHaveTextContent("Базовый текст остаётся локально");
      expect(title).toHaveValue("Нескачанный локальный заголовок");
      if (failureStage !== "export request") {
        expect(requests).not.toContain("export-post");
      }
    },
  );

  it("does not download after a scenario revision conflict and keeps the local draft recoverable", async () => {
    let scenarioReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 3,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        return new Response(JSON.stringify({
          error: {
            code: "SCENARIO_REVISION_CONFLICT",
            message: "Сценарий уже изменён",
            details: {},
          },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/metadata") && init?.method === "PATCH") {
        return response({ ok: true });
      }
      if (url.endsWith("/scenario/export-docx") && init?.method === "POST") {
        throw new Error("Export must not start after conflict");
      }
      if (url.endsWith("/scenario")) {
        scenarioReads += 1;
        return response(scenarioReads === 1
          ? scenarioModel()
          : {
              ...scenarioModel(),
              scenario: {
                revision: 2,
                rows: [{
                  ...scenarioModel().scenario.rows[0],
                  text: "Новый серверный текст",
                }],
              },
            });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const downloads = installDownloadSpies();

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    appendEditorText(editor, " конфликтная локальная правка");
    fireEvent.click(screen.getByRole("button", { name: "Экспорт DOCX" }));

    const conflict = await screen.findByRole("alertdialog", {
      name: "Конфликт локального черновика",
    });
    expect(conflict).toHaveTextContent("Базовый текст конфликтная локальная правка");
    expect(downloads.click).not.toHaveBeenCalled();
  });

  it.each([
    ["held", "занятый другим редактором"],
    ["archived", "архивный"],
  ] as const)(
    "exports a read-only %s scenario without PUT or PATCH",
    async (editState, _description) => {
      const requests: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/workflow")) return response(workflowModel());
        if (url.endsWith("/scenario/export-docx") && init?.method === "POST") {
          requests.push("export-post");
          expect(JSON.parse(String(init.body))).toEqual({
            expected_revision: 0,
            expected_title: "Синтетический сюжет",
            expected_rubric_id: 1,
            expected_duration_text: "00:30",
          });
          return docxResponse();
        }
        if (url.endsWith("/scenario") && !init?.method) {
          return response({
            ...scenarioModel(),
            edit: { state: editState },
          });
        }
        if (init?.method === "PUT" || init?.method === "PATCH") {
          requests.push(String(init.method).toLowerCase());
        }
        throw new Error(`Unexpected request ${url}`);
      });
      installScenarioFetchMock(fetchMock);
      const downloads = installDownloadSpies();

      render(<ScenarioEditor storyId={101} userId={1} />);
      fireEvent.click(await screen.findByRole("button", { name: "Экспорт DOCX" }));

      await waitFor(() => expect(downloads.click).toHaveBeenCalledOnce());
      expect(requests).toEqual(["export-post"]);
      expect(screen.queryByRole("toolbar", { name: "Форматирование" }))
        .not.toBeInTheDocument();
    },
  );
  it("refetches workflow after an autosave acknowledgement without replacing rows or focus", async () => {
    let workflowRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) {
        workflowRequests += 1;
        return response(workflowModel(workflowRequests > 1));
      }
      if (url.endsWith("/scenario/lease")) return response({ edit_session_id: 3, lease_token: "lease", expires_at: "2099-07-15T12:00:00Z", revision: 0 });
      if (url.endsWith("/scenario") && init?.method === "PUT") return response({ ok: true, client_save_id: "save", revision: 1, saved_at: "2026-07-15T10:00:00Z" });
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    await screen.findByText("Корректура");
    editor.focus();
    appendEditorText(editor, " после вычитки");

    expect(await screen.findByText("Изменён после вычитки", {}, { timeout: 2_000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Назначить повторную вычитку" })).toBeInTheDocument();
    expect(workflowRequests).toBe(2);
    expect(editor).toHaveTextContent("Базовый текст после вычитки");
    expect(document.activeElement).toBe(editor);
  });

  it("offers an explicit retry after initial workflow load failure and recovers", async () => {
    let workflowRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/workflow")) {
        workflowRequests += 1;
        return workflowRequests === 1
          ? errorResponse("Редакционный процесс временно недоступен")
          : response(workflowModel());
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const user = userEvent.setup();

    render(<ScenarioEditor storyId={101} userId={1} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Редакционный процесс временно недоступен");
    await user.click(screen.getByRole("button", { name: "Повторить загрузку редакционного процесса" }));

    expect(await screen.findByText("Корректура")).toBeInTheDocument();
    expect(workflowRequests).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
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
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    appendEditorText(editor, " локальная правка");
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("registers dirty editor state with the shared SPA navigation guard", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 3,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        return response({
          ok: true,
          client_save_id: "save",
          revision: 1,
          saved_at: "2026-07-12T12:00:00Z",
        });
      }
      if (url.endsWith("/scenario")) return response(scenarioModel());
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    editor.focus();
    appendEditorText(editor, " до debounce");

    let navigated = true;
    act(() => { navigated = navigate("/stories/101/production"); });

    expect(navigated).toBe(false);
    expect(window.location.pathname).toBe("/stories/101/scenario");
    expect(editor).toHaveTextContent("Базовый текст до debounce");
    expect(document.activeElement).toBe(editor);
    expect(window.localStorage.getItem(scenarioDraftKey(101, 1)))
      .toContain("Базовый текст до debounce");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("preserves a mismatched persisted draft in an explicit conflict instead of overwriting it", async () => {
    const storedDraft = JSON.stringify({
      revision: 1,
      rows: [{
        ...scenarioModel().scenario.rows[0],
        text: "Исходный локальный текст",
      }],
      saved_at: "2026-07-15T09:30:00Z",
    });
    window.localStorage.setItem("newscast:scenario-draft:101:1", storedDraft);
    const serverScenario = {
      ...scenarioModel(),
      scenario: {
        revision: 2,
        rows: [{
          ...scenarioModel().scenario.rows[0],
          text: "Новый текст с сервера",
        }],
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario") && !init?.method) return response(serverScenario);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);

    const conflict = await screen.findByRole("alertdialog", {
      name: "Конфликт локального черновика",
    });
    expect(conflict).toHaveTextContent("Исходный локальный текст");
    expect(conflict).toHaveTextContent("Новый текст с сервера");
    expect(screen.getByRole("button", {
      name: "Продолжить с локальным текстом",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Использовать текст с сервера",
    })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", {
        name: "Продолжить с локальным текстом",
      })).toHaveFocus();
    });
    const localRows = screen.getByRole("list", {
      name: "Строки сохранённого локального текста",
    });
    const serverRows = screen.getByRole("list", {
      name: "Строки актуального текста с сервера",
    });
    expect(localRows).toHaveAttribute("tabindex", "0");
    expect(serverRows).toHaveAttribute("tabindex", "0");
    const serverButton = screen.getByRole("button", {
      name: "Использовать текст с сервера",
    });
    serverButton.focus();
    fireEvent.keyDown(serverButton, { key: "Tab" });
    expect(localRows).toHaveFocus();
    expect(screen.queryByRole("textbox", { name: "Текст блока 1" })).not.toBeInTheDocument();

    window.dispatchEvent(new Event("online"));
    await act(async () => { await Promise.resolve(); });

    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toBe(storedDraft);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("rebases the preserved local snapshot onto the latest server revision and saves it once", async () => {
    window.localStorage.setItem("newscast:scenario-draft:101:1", JSON.stringify({
      revision: 1,
      rows: [{ ...scenarioModel().scenario.rows[0], text: "Локальный текст для продолжения" }],
      saved_at: "2026-07-15T09:30:00Z",
    }));
    const serverScenario = {
      ...scenarioModel(),
      scenario: {
        revision: 3,
        rows: [{ ...scenarioModel().scenario.rows[0], text: "Редакция три с сервера" }],
      },
    };
    const savedPayloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 7,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 3,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        savedPayloads.push(JSON.parse(String(init.body)));
        return response({
          ok: true,
          client_save_id: "save",
          revision: 4,
          saved_at: "2026-07-15T10:00:00Z",
        });
      }
      if (url.endsWith("/scenario")) return response(serverScenario);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const user = userEvent.setup();

    render(<ScenarioEditor storyId={101} userId={1} />);
    await user.click(await screen.findByRole("button", {
      name: "Продолжить с локальным текстом",
    }));

    expect(await screen.findByRole("textbox", { name: "Текст блока 1" }))
      .toHaveTextContent("Локальный текст для продолжения");
    await waitFor(() => expect(savedPayloads).toHaveLength(1), { timeout: 2_000 });
    expect(savedPayloads[0]).toMatchObject({
      base_revision: 3,
      rows: [expect.objectContaining({ text: "Локальный текст для продолжения" })],
    });
    await waitFor(() => {
      expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toBeNull();
    });
  });

  it("requires confirmation before discarding a preserved draft for the server snapshot", async () => {
    const storedDraft = JSON.stringify({
      revision: 1,
      rows: [{ ...scenarioModel().scenario.rows[0], text: "Локальный текст нельзя потерять" }],
      saved_at: "2026-07-15T09:30:00Z",
    });
    window.localStorage.setItem("newscast:scenario-draft:101:1", storedDraft);
    const serverScenario = {
      ...scenarioModel(),
      scenario: {
        revision: 2,
        rows: [{ ...scenarioModel().scenario.rows[0], text: "Выбранный серверный текст" }],
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario") && !init?.method) return response(serverScenario);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);
    const user = userEvent.setup();

    render(<ScenarioEditor storyId={101} userId={1} />);
    await user.click(await screen.findByRole("button", {
      name: "Использовать текст с сервера",
    }));

    const confirmation = screen.getByRole("alertdialog", {
      name: "Подтвердить отказ от локального текста",
    });
    expect(confirmation).toHaveTextContent("Локальный черновик будет удалён");
    await waitFor(() => {
      expect(within(confirmation).getByRole("button", { name: "Отменить" })).toHaveFocus();
    });
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toBe(storedDraft);

    fireEvent.keyDown(confirmation, { key: "Escape" });
    expect(screen.queryByRole("alertdialog", {
      name: "Подтвердить отказ от локального текста",
    })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", {
        name: "Использовать текст с сервера",
      })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", {
      name: "Использовать текст с сервера",
    }));
    await user.click(screen.getByRole("button", {
      name: "Да, использовать текст с сервера",
    }));

    expect(await screen.findByRole("textbox", { name: "Текст блока 1" }))
      .toHaveTextContent("Выбранный серверный текст");
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1")).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDisabled();
  });

  it("offers a matching persisted draft without writing until explicit restoration", async () => {
    window.localStorage.setItem("newscast:scenario-draft:101:1", JSON.stringify({
      revision: 2,
      rows: [{ ...scenarioModel().scenario.rows[0], text: "Совпадающий локальный черновик" }],
      saved_at: "2026-07-15T09:30:00Z",
    }));
    const serverScenario = {
      ...scenarioModel(),
      scenario: {
        revision: 2,
        rows: [{ ...scenarioModel().scenario.rows[0], text: "Подтверждённый серверный текст" }],
      },
    };
    const savedPayloads: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 7,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 2,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        savedPayloads.push(JSON.parse(String(init.body)));
        return response({
          ok: true,
          client_save_id: "save",
          revision: 3,
          saved_at: "2026-07-15T10:00:00Z",
        });
      }
      if (url.endsWith("/scenario")) return response(serverScenario);
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);

    await screen.findByRole("alertdialog", { name: "Конфликт локального черновика" });
    expect(savedPayloads).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Продолжить с локальным текстом" }));
    expect(await screen.findByRole("textbox", { name: "Текст блока 1" }))
      .toHaveTextContent("Совпадающий локальный черновик");
    await waitFor(() => expect(savedPayloads).toHaveLength(1), { timeout: 2_000 });
    expect(savedPayloads[0]).toMatchObject({
      base_revision: 2,
      rows: [expect.objectContaining({ text: "Совпадающий локальный черновик" })],
    });
    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
  });

  it("turns an autosave revision conflict into the same recovery state without blind retry", async () => {
    let scenarioReads = 0;
    let saves = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 7,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        saves += 1;
        return new Response(JSON.stringify({
          error: {
            code: "SCENARIO_REVISION_CONFLICT",
            message: "Сценарий уже изменён",
            details: {},
          },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/scenario")) {
        scenarioReads += 1;
        return response(scenarioReads === 1
          ? scenarioModel()
          : {
              ...scenarioModel(),
              scenario: {
                revision: 2,
                rows: [{ ...scenarioModel().scenario.rows[0], text: "Новый серверный текст" }],
              },
            });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Найти" }), {
      target: { value: "Базовый" },
    });
    expect(screen.getByRole("search", { name: "Найти и заменить" })).toBeInTheDocument();
    appendEditorText(editor, " локальная правка");

    const conflict = await screen.findByRole("alertdialog", {
      name: "Конфликт локального черновика",
    }, { timeout: 2_000 });
    expect(conflict).toHaveTextContent("Базовый текст локальная правка");
    expect(conflict).toHaveTextContent("Новый серверный текст");

    fireEvent.click(screen.getByRole("button", { name: "Продолжить с локальным текстом" }));
    expect(await screen.findByRole("textbox", { name: "Текст блока 1" }))
      .toHaveTextContent("Базовый текст локальная правка");
    expect(screen.queryByRole("search", { name: "Найти и заменить" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отменить" })).toBeEnabled();

    window.dispatchEvent(new Event("online"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(saves).toBe(2);
    expect(window.localStorage.getItem(scenarioDraftKey(101, 1)))
      .toContain("Базовый текст локальная правка");
  });

  it("gates undo and redo while a revision conflict preserves the local history", async () => {
    let scenarioReads = 0;
    let saves = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 7,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        saves += 1;
        return new Response(JSON.stringify({
          error: {
            code: "SCENARIO_REVISION_CONFLICT",
            message: "Сценарий уже изменён",
            details: {},
          },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/scenario")) {
        scenarioReads += 1;
        return response(scenarioReads === 1
          ? scenarioModel()
          : {
              ...scenarioModel(),
              scenario: {
                revision: 2,
                rows: [{ ...scenarioModel().scenario.rows[0], text: "Новый серверный текст" }],
              },
            });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    appendEditorText(editor, " локальная правка");

    const conflict = await screen.findByRole("alertdialog", {
      name: "Конфликт локального черновика",
    }, { timeout: 2_000 });
    await waitFor(() => {
      expect(within(conflict).getByRole("button", {
        name: "Продолжить с локальным текстом",
      })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDisabled();
    const saveCountAtConflict = saves;

    expect(fireEvent.keyDown(conflict, { key: "y", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(conflict, { key: "z", ctrlKey: true })).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(saves).toBe(saveCountAtConflict);
    expect(within(conflict).getByRole("list", {
      name: "Строки сохранённого локального текста",
    })).toHaveTextContent("Базовый текст локальная правка");

    fireEvent.click(within(conflict).getByRole("button", {
      name: "Продолжить с локальным текстом",
    }));
    const restoredEditor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    expect(restoredEditor).toHaveTextContent("Базовый текст локальная правка");
    const undo = screen.getByRole("button", { name: "Отменить" });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(restoredEditor).toHaveTextContent("Базовый текст");
  });

  it("resets undo and redo after explicitly choosing the newest server snapshot", async () => {
    let scenarioReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 7,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        return new Response(JSON.stringify({
          error: {
            code: "SCENARIO_REVISION_CONFLICT",
            message: "Сценарий уже изменён",
            details: {},
          },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/scenario")) {
        scenarioReads += 1;
        return response(scenarioReads === 1
          ? scenarioModel()
          : {
              ...scenarioModel(),
              scenario: {
                revision: 2,
                rows: [{ ...scenarioModel().scenario.rows[0], text: "Выбранный серверный текст" }],
              },
            });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    appendEditorText(editor, " локальная правка");
    expect(screen.getByRole("button", { name: "Отменить" })).toBeEnabled();

    const conflict = await screen.findByRole("alertdialog", {
      name: "Конфликт локального черновика",
    }, { timeout: 2_000 });
    const useServer = within(conflict).getByRole("button", {
      name: "Использовать текст с сервера",
    });
    await waitFor(() => expect(useServer).toBeEnabled());
    fireEvent.click(useServer);
    fireEvent.click(within(conflict).getByRole("button", {
      name: "Да, использовать текст с сервера",
    }));

    expect(await screen.findByRole("textbox", { name: "Текст блока 1" }))
      .toHaveTextContent("Выбранный серверный текст");
    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDisabled();
  });

  it("does not allow conflict resolution until the newest server snapshot is loaded", async () => {
    const latestScenario = createDeferred<Response>();
    let scenarioReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/workflow")) return response(workflowModel());
      if (url.endsWith("/scenario/lease")) {
        return response({
          edit_session_id: 7,
          lease_token: "lease",
          expires_at: "2099-07-15T12:00:00Z",
          revision: 0,
        });
      }
      if (url.endsWith("/scenario") && init?.method === "PUT") {
        return new Response(JSON.stringify({
          error: {
            code: "SCENARIO_REVISION_CONFLICT",
            message: "Сценарий уже изменён",
            details: {},
          },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/scenario")) {
        scenarioReads += 1;
        return scenarioReads === 1 ? response(scenarioModel()) : latestScenario.promise;
      }
      throw new Error(`Unexpected request ${url}`);
    });
    installScenarioFetchMock(fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    await enterEditorIfAvailable();
    appendEditorText(editor, " защищённая правка");

    const conflict = await screen.findByRole("alertdialog", {
      name: "Конфликт локального черновика",
    }, { timeout: 2_000 });
    expect(conflict).toHaveTextContent("Обновляем актуальный текст с сервера");
    expect(screen.getByRole("button", {
      name: "Продолжить с локальным текстом",
    })).toBeDisabled();
    expect(screen.getByRole("button", {
      name: "Использовать текст с сервера",
    })).toBeDisabled();

    latestScenario.resolve(response({
      ...scenarioModel(),
      scenario: {
        revision: 3,
        rows: [{ ...scenarioModel().scenario.rows[0], text: "Точно последний серверный текст" }],
      },
    }));
    await latestScenario.promise;

    expect(await screen.findByText("Точно последний серверный текст")).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Продолжить с локальным текстом",
    })).toBeEnabled();
  });
});
