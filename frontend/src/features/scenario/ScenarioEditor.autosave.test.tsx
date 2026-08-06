import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
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
import { navigate } from "../../app/AppRouter";
import { resetMetadataSaveCoordinatorsForTests } from "./metadataSaveCoordinator";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
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
    vi.stubGlobal("fetch", fetchMock);
    const downloads = installDownloadSpies();

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
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
    vi.stubGlobal("fetch", fetchMock);
    const downloads = installDownloadSpies();

    render(
      <StrictMode>
        <ScenarioEditor storyId={101} userId={1} />
      </StrictMode>,
    );
    const duration = await screen.findByRole("textbox", { name: "Хронометраж" });
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
    const downloads = installDownloadSpies();

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
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
      vi.stubGlobal("fetch", fetchMock);
      const downloads = installDownloadSpies();

      render(<ScenarioEditor storyId={101} userId={1} />);
      const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
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
    vi.stubGlobal("fetch", fetchMock);
    const downloads = installDownloadSpies();

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
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
      vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    editor.focus();
    appendEditorText(editor, " до debounce");

    let navigated = true;
    act(() => { navigated = navigate("/stories/101/production"); });

    expect(navigated).toBe(false);
    expect(window.location.pathname).toBe("/stories/101/scenario");
    expect(editor).toHaveTextContent("Базовый текст до debounce");
    expect(document.activeElement).toBe(editor);
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
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
    vi.stubGlobal("fetch", fetchMock);

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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
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
      expect(screen.getByRole("button", { name: "Отменить" })).toHaveFocus();
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
  });

  it("restores a matching persisted draft as pending and autosaves it", async () => {
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
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);

    expect(await screen.findByRole("textbox", { name: "Текст блока 1" }))
      .toHaveTextContent("Совпадающий локальный черновик");
    await waitFor(() => expect(savedPayloads).toHaveLength(1), { timeout: 2_000 });
    expect(savedPayloads[0]).toMatchObject({
      base_revision: 2,
      rows: [expect.objectContaining({ text: "Совпадающий локальный черновик" })],
    });
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
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    appendEditorText(editor, " локальная правка");

    const conflict = await screen.findByRole("alertdialog", {
      name: "Конфликт локального черновика",
    }, { timeout: 2_000 });
    expect(conflict).toHaveTextContent("Базовый текст локальная правка");
    expect(conflict).toHaveTextContent("Новый серверный текст");

    window.dispatchEvent(new Event("online"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(saves).toBe(1);
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
      .toContain("Базовый текст локальная правка");
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
    vi.stubGlobal("fetch", fetchMock);

    render(<ScenarioEditor storyId={101} userId={1} />);
    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
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
