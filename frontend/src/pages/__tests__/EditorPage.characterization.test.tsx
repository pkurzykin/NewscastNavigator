import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EditorPage from "../EditorPage";
import type { ScriptElementRow, UserPublic } from "../../shared/types";

const user: UserPublic = {
  id: 1,
  username: "synthetic_admin",
  full_name: "Тест",
  job_title: "Тестовая должность",
  role: "admin",
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-11T00:00:00Z",
};

const project = {
  id: 101,
  title: "Синтетический сценарий",
  rubric: "Тестовая рубрика",
  planned_duration: "01:30",
  status: "draft",
  author_user_id: 1,
  author_username: "synthetic_admin",
  executor_user_ids: [],
  text_seq: 1,
  current_text_seq: 1,
  current_text_is_latest: true,
  checked_text_is_current: false,
  proofread_text_is_current: false,
  latest_text_is_checked: false,
  latest_text_is_proofread: false,
  titles_status: "not_started",
  edit_status: "not_started",
  voiceover_status: "not_started",
  final_review_status: "not_started",
  created_at: "2026-07-11T00:00:00Z",
};

function richTarget(text: string, html = text) {
  return {
    editor: "tiptap",
    text,
    html,
  };
}

function row(
  id: number,
  blockType: string,
  text: string,
  overrides: Partial<ScriptElementRow> = {}
): ScriptElementRow {
  return {
    id,
    segment_uid: `seg_synthetic_${id}`,
    order_index: id,
    block_type: blockType,
    text,
    speaker_text: "",
    file_name: "",
    tc_in: "",
    tc_out: "",
    additional_comment: "",
    structured_data: {},
    formatting: {},
    rich_text: {
      schema_version: 1,
      targets: { text: richTarget(text) },
    },
    ...overrides,
  };
}

const rows: ScriptElementRow[] = [
  row(1, "podvodka", "Ведущий открывает выпуск", {
    formatting: {
      targets: {
        text: {
          font_family: "PT Sans",
          bold: true,
          italic: false,
          strikethrough: false,
          fill_color: "#ffffff",
        },
      },
    },
    rich_text: {
      schema_version: 1,
      targets: {
        text: richTarget("Ведущий открывает выпуск", "<strong>Ведущий</strong> открывает выпуск"),
      },
    },
  }),
  row(2, "zk", "Закадровый текст", {
    file_name: "synthetic-master.mov",
    tc_in: "00:01",
    tc_out: "00:08",
    additional_comment: "Синтетический общий план",
    structured_data: {
      file_bundles: [
        { file_name: "synthetic-master.mov", tc_in: "00:01", tc_out: "00:08" },
      ],
    },
  }),
  row(3, "zk_geo", "Текст после гео", {
    structured_data: { geo: "Тестоград", text_lines: ["Текст после гео"] },
    rich_text: {
      schema_version: 1,
      targets: {
        geo: richTarget("Тестоград", "<em>Тестоград</em>"),
        text: richTarget("Текст после гео"),
      },
    },
  }),
  row(4, "life", "Синтетический интершум"),
  row(5, "snh", "Синтетическая реплика", {
    speaker_text: "Тестов Тест\nЭксперт лаборатории",
    rich_text: {
      schema_version: 1,
      targets: {
        speaker_fio: richTarget("Тестов Тест"),
        speaker_position: richTarget("Эксперт лаборатории"),
        text: richTarget("Синтетическая реплика"),
      },
    },
  }),
];

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installEditorApiMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/projects/101/editor") && init?.method === "PUT") {
      const requestRows = JSON.parse(String(init.body)).rows as ScriptElementRow[];
      return jsonResponse({
        ok: true,
        message: "Таблица сценария сохранена",
        updated: requestRows.length,
        inserted: 0,
        removed: 0,
        total: requestRows.length,
        project,
        elements: requestRows,
      });
    }
    if (url.endsWith("/api/v1/projects/101/meta") && init?.method === "PUT") {
      return jsonResponse({ ok: true, message: "Метаданные сохранены", project });
    }
    if (url.endsWith("/api/v1/projects/101/editor")) {
      return jsonResponse({ project, elements: rows });
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
  return fetchMock;
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

describe("EditorPage current behavior characterization", () => {
  it("renders all five block types with rich and structured editor data", async () => {
    installEditorApiMock();
    render(
      <EditorPage token="synthetic-token" projectId={101} user={user} onBackToMain={() => {}} />
    );

    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(5);
    expect(within(table).getAllByRole("combobox").map((item) => (item as HTMLSelectElement).value)).toEqual([
      "podvodka",
      "zk",
      "zk_geo",
      "life",
      "snh",
    ]);

    expect(within(bodyRows[0]).getByText("Ведущий").tagName).toBe("STRONG");
    expect(within(bodyRows[2]).getByText("Тестоград")).toBeInTheDocument();
    expect(within(bodyRows[4]).getByText("Тестов Тест")).toBeInTheDocument();
    expect(within(bodyRows[4]).getByText("Эксперт лаборатории")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByDisplayValue("synthetic-master.mov")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByDisplayValue("00:01")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByDisplayValue("00:08")).toBeInTheDocument();
  });

  it("supports duplicate, reorder and delete controls without leaving the current editor", async () => {
    installEditorApiMock();
    render(
      <EditorPage token="synthetic-token" projectId={101} user={user} onBackToMain={() => {}} />
    );

    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    fireEvent.click(within(table).getAllByRole("button", { name: "Дублировать блок" })[0]);
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(7));
    expect(
      [...table.querySelectorAll(".editor-core-content")].filter((item) =>
        item.textContent?.includes("Ведущий открывает выпуск")
      )
    ).toHaveLength(2);

    const duplicatedRows = within(table).getAllByRole("row").slice(1);
    const duplicateEditor = duplicatedRows[1].querySelector(".editor-core-content") as HTMLElement;
    const typing = userEvent.setup();
    await typing.click(duplicateEditor);
    await typing.type(duplicateEditor, " — копия");
    expect(duplicatedRows[1]).toHaveTextContent("Ведущий открывает выпуск — копия");

    fireEvent.click(within(table).getAllByRole("button", { name: "Опустить блок вниз" })[0]);
    const movedRows = within(table).getAllByRole("row").slice(1);
    expect(movedRows[0]).toHaveTextContent("Ведущий открывает выпуск — копия");
    expect(movedRows[1]).toHaveTextContent("Ведущий открывает выпуск");
    expect(movedRows[1]).not.toHaveTextContent("— копия");

    const lifeRow = within(table).getByText("Синтетический интершум").closest("tr");
    expect(lifeRow).not.toBeNull();
    fireEvent.click(within(lifeRow as HTMLTableRowElement).getByRole("button", { name: "Удалить блок" }));
    await waitFor(() => expect(within(table).queryByText("Синтетический интершум")).not.toBeInTheDocument());
  });
});
