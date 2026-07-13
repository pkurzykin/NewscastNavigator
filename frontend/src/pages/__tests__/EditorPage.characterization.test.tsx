import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ScenarioEditor from "../../features/scenario/components/ScenarioEditor";
import type { ScenarioRow } from "../../features/scenario/types";

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
  overrides: Partial<ScenarioRow> = {}
): ScenarioRow {
  return {
    segment_uid: `seg_synthetic_${id}`,
    order_index: id,
    block_type: blockType as ScenarioRow["block_type"],
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

const rows: ScenarioRow[] = [
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

function installEditorApiMock(editorRows: ScenarioRow[] = rows) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT") {
      const request = JSON.parse(String(init.body));
      return jsonResponse({ ok: true, client_save_id: request.client_save_id, revision: 1, saved_at: "2026-07-12T00:00:00Z" });
    }
    if (url.endsWith("/api/v1/stories/101/scenario/lease")) {
      return jsonResponse({ edit_session_id: 5, lease_token: "lease", expires_at: "2026-07-12T00:01:30Z", revision: 0 });
    }
    if (url.endsWith("/api/v1/stories/101/scenario")) {
      return jsonResponse({ story: { id: project.id, title: project.title }, scenario: { revision: 0, rows: editorRows }, edit: { state: "available" } });
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

function selectEditorText(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
}

beforeEach(() => {
  installLocalStorageStub();
  installEditorDomGeometryStubs();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ScenarioEditor current behavior characterization", () => {
  it("renders all five block types with rich and structured editor data", async () => {
    installEditorApiMock();
    render(
      <ScenarioEditor storyId={101} userId={1} />
    );

    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(5);
    expect(within(table).getAllByRole("combobox").filter((item) => item.getAttribute("aria-label")?.startsWith("Тип блока")).map((item) => (item as HTMLSelectElement).value)).toEqual([
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

  it("lets the editor format a row and serializes its canonical formatting", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    const firstRow = within(table).getAllByRole("row")[1];
    vi.useFakeTimers();

    fireEvent.change(within(firstRow).getByRole("combobox", { name: "Шрифт для текста блока 1" }), {
      target: { value: "Arial" },
    });
    fireEvent.click(within(firstRow).getByRole("button", { name: "Жирный для текста блока 1" }));
    fireEvent.click(within(firstRow).getByRole("button", { name: "Курсив для текста блока 1" }));
    fireEvent.click(within(firstRow).getByRole("button", { name: "Зачеркнуть для текста блока 1" }));
    fireEvent.click(within(firstRow).getByRole("button", { name: "Заливка: голубая для текста блока 1" }));

    expect(firstRow.querySelector(".editor-core-field")).toHaveStyle({
      fontFamily: "Arial",
      fontWeight: "400",
      fontStyle: "italic",
      textDecoration: "line-through",
      backgroundColor: "#dceeff",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(saveCall).toBeDefined();
    const savedRows = JSON.parse(String(saveCall?.[1]?.body)).rows as ScenarioRow[];
    expect(savedRows[0]?.formatting).toEqual({
      targets: {
        text: {
          font_family: "Arial",
          bold: false,
          italic: true,
          strikethrough: true,
          fill_color: "#dceeff",
        },
      },
    });
  });

  it("changes the selected rich text marks together with toolbar formatting", async () => {
    const semanticRows = structuredClone(rows);
    semanticRows[0] = {
      ...semanticRows[0],
      text: "Полностью жирный текст",
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
          text: richTarget("Полностью жирный текст", "<strong>Полностью жирный текст</strong>"),
        },
      },
    };
    const fetchMock = installEditorApiMock(semanticRows);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    const firstRow = within(table).getAllByRole("row")[1];
    const editor = firstRow.querySelector(".editor-core-content") as HTMLElement;
    selectEditorText(editor);
    vi.useFakeTimers();

    fireEvent.click(within(firstRow).getByRole("button", { name: "Жирный для текста блока 1" }));
    fireEvent.click(within(firstRow).getByRole("button", { name: "Зачеркнуть для текста блока 1" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(saveCall).toBeDefined();
    const savedRows = JSON.parse(String(saveCall?.[1]?.body)).rows as ScenarioRow[];
    const savedText = savedRows[0]?.rich_text.targets?.text;
    expect(savedText?.html).not.toContain("<strong>");
    expect(savedText?.html).toContain("<s>");
    expect(JSON.stringify(savedText?.doc)).toContain('"strike"');
  });

  it("supports duplicate, reorder and delete controls without leaving the current editor", async () => {
    installEditorApiMock();
    render(
      <ScenarioEditor storyId={101} userId={1} />
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
