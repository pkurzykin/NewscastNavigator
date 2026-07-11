import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EditorPage from "../EditorPage";
import type { ScriptElementRow, UserPublic } from "../../shared/types";
import { createDeferred } from "../../test/deferred";

const user: UserPublic = {
  id: 1,
  username: "synthetic_admin",
  role: "admin",
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-11T00:00:00Z",
};

const project = {
  id: 101,
  title: "Autosave synthetic",
  rubric: "Тестовая рубрика",
  planned_duration: "01:00",
  status: "draft",
  author_user_id: 1,
  author_username: "synthetic_admin",
  executor_user_ids: [],
  text_seq: 1,
  current_text_seq: 1,
  current_text_is_latest: true,
  titles_status: "not_started",
  edit_status: "not_started",
  voiceover_status: "not_started",
  final_review_status: "not_started",
  created_at: "2026-07-11T00:00:00Z",
};

const initialRow: ScriptElementRow = {
  id: 11,
  segment_uid: "seg_autosave_11",
  order_index: 1,
  block_type: "zk",
  text: "Базовый текст",
  speaker_text: "",
  file_name: "",
  tc_in: "",
  tc_out: "",
  additional_comment: "",
  structured_data: {},
  formatting: {},
  rich_text: {
    schema_version: 1,
    targets: {
      text: { editor: "tiptap", text: "Базовый текст", html: "Базовый текст" },
    },
  },
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installDeferredSaveApi() {
  const editorSave = createDeferred<Response>();
  let requestRows: ScriptElementRow[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/projects/101/meta") && init?.method === "PUT") {
      return jsonResponse({ ok: true, message: "Метаданные сохранены", project });
    }
    if (url.endsWith("/api/v1/projects/101/editor") && init?.method === "PUT") {
      requestRows = JSON.parse(String(init.body)).rows as ScriptElementRow[];
      return editorSave.promise;
    }
    if (url.endsWith("/api/v1/projects/101/editor")) {
      return jsonResponse({ project, elements: [initialRow] });
    }
    if (url.endsWith("/api/v1/projects/101/workspace")) {
      return jsonResponse({
        project,
        workspace: { file_root: "", file_roots: [], project_note: "" },
        comments: [],
        material_links: [],
        files: [],
      });
    }
    if (url.endsWith("/api/v1/users")) {
      return jsonResponse({ items: [user], total: 1 });
    }
    if (url.endsWith("/api/v1/projects/101/history")) {
      return jsonResponse({ items: [], total: 0 });
    }
    if (url.endsWith("/api/v1/projects/101/revisions")) {
      return jsonResponse({ items: [], total: 0 });
    }
    throw new Error(`Unexpected request: ${init?.method || "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    editorSave,
    fetchMock,
    getRequestRows: () => requestRows,
  };
}

async function renderEditor() {
  render(
    <EditorPage token="synthetic-token" projectId={101} user={user} onBackToMain={() => {}} />
  );
  const table = await screen.findByRole("region", { name: "Таблица сценария" });
  return table.querySelector(".editor-core-content") as HTMLElement;
}

function installLocalStorageStub() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    } satisfies Storage,
  });
}

function installEditorDomGeometryStubs() {
  const rect = new DOMRect(0, 0, 10, 18);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => document.body,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [rect],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(window, "scrollBy", { configurable: true, value: () => {} });
  Object.defineProperty(window, "scrollTo", { configurable: true, value: () => {} });
}

beforeEach(() => {
  installLocalStorageStub();
  installEditorDomGeometryStubs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EditorPage known autosave regressions", () => {
  it.fails("keeps typing made after an in-flight snapshot when its stale response arrives", async () => {
    const api = installDeferredSaveApi();
    const editor = await renderEditor();
    const typing = userEvent.setup();

    await typing.click(editor);
    await typing.type(editor, " до запроса");
    await waitFor(
      () => {
        expect(
          api.fetchMock.mock.calls.some(
            ([input, init]) =>
              String(input).endsWith("/api/v1/projects/101/editor") && init?.method === "PUT"
          )
        ).toBe(true);
      },
      { timeout: 2500 }
    );

    await typing.type(editor, " после запроса");
    const staleRows = api.getRequestRows();
    expect(staleRows[0].text).toBe("Базовый текст до запроса");
    expect(editor).toHaveTextContent("Базовый текст до запроса после запроса");

    await act(async () => {
      api.editorSave.resolve(
        jsonResponse({
          ok: true,
          message: "Таблица сценария сохранена",
          updated: 1,
          inserted: 0,
          removed: 0,
          total: 1,
          project,
          elements: staleRows,
        })
      );
      await api.editorSave.promise;
    });
    await waitFor(() => expect(screen.queryByText("Автосохранение...")).not.toBeInTheDocument());

    expect(editor).toHaveTextContent("Базовый текст до запроса после запроса");
  });

  it("characterizes the pending-to-saving status text without treating it as geometry evidence", async () => {
    installDeferredSaveApi();
    const editor = await renderEditor();
    const typing = userEvent.setup();

    await typing.click(editor);
    await typing.type(editor, " изменение");
    expect(screen.getByText("Черновик изменен")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Автосохранение...")).toBeInTheDocument(), {
      timeout: 3000,
    });
  });
});
