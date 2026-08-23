import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../features/editor-core/EditorField", async () => {
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
      focusRequest,
    }: any) {
      const domRef = React.useRef<HTMLDivElement | null>(null);
      const initialText = richTextTarget?.text ?? plainTextValue;
      const content = React.useRef({
        text: initialText,
        html: richTextTarget?.html ?? initialText,
      });
      const marks = React.useRef(new Set<string>([
        ...(richTextTarget?.html?.includes("<strong>") ? ["bold"] : []),
        ...(richTextTarget?.html?.includes("<em>") ? ["italic"] : []),
        ...(richTextTarget?.html?.includes("<s>") ? ["strike"] : []),
      ]));
      const latest = React.useRef({ content: content.current, onChangeValue });
      latest.current = { content: content.current, onChangeValue };
      const editor = React.useRef<any>(null);
      const hasTextSelection = React.useRef(false);
      const externalText = richTextTarget?.text ?? plainTextValue;
      const externalHtml = richTextTarget?.html ?? externalText;

      if (!editor.current) {
        const emitMarks = () => {
          const text = latest.current.content.text;
          let html = text;
          if (marks.current.has("bold")) html = `<strong>${html}</strong>`;
          if (marks.current.has("italic")) html = `<em>${html}</em>`;
          if (marks.current.has("strike")) html = `<s>${html}</s>`;
          const activeMarks = [...marks.current].map((type) => ({ type }));
          const next = { text, html };
          content.current = next;
          latest.current.content = next;
          latest.current.onChangeValue({
            editor: "tiptap",
            text,
            html,
            doc: { type: "doc", content: [{ type: "paragraph", content: text ? [{ type: "text", text, ...(activeMarks.length ? { marks: activeMarks } : {}) }] : [] }] },
          });
          return true;
        };
        const chain: any = {
          focus: () => chain,
          setFontFamily: () => chain,
          unsetFontFamily: () => chain,
          setMark: (mark: string) => { marks.current.add(mark); return chain; },
          unsetMark: (mark: string) => { marks.current.delete(mark); return chain; },
          setHighlight: () => chain,
          unsetHighlight: () => chain,
          setTextSelection: () => {
            hasTextSelection.current = false;
            return chain;
          },
          run: emitMarks,
        };
        editor.current = {
          get state() {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) hasTextSelection.current = true;
            const empty = !hasTextSelection.current;
            return { selection: { from: empty ? 0 : 1, to: empty ? 0 : 2, empty } };
          },
          chain: () => chain,
        };
      }

      React.useEffect(() => {
        onRegister(editorId, editor.current);
        return () => onRegister(editorId, null);
      }, [editorId, onRegister]);

      React.useEffect(() => {
        if (!focusRequest) return;
        domRef.current?.focus();
      }, [focusRequest]);

      React.useLayoutEffect(() => {
        if (content.current.text === externalText && content.current.html === externalHtml) return;
        const next = { text: externalText, html: externalHtml };
        content.current = next;
        latest.current.content = next;
        if (domRef.current && domRef.current.innerHTML !== externalHtml) {
          domRef.current.innerHTML = externalHtml;
        }
      }, [externalHtml, externalText]);

      return <div className={`${className} editor-core-field rich-text-field`} style={style}>
        <div
          ref={domRef}
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

import ScenarioEditor from "../../features/scenario/components/ScenarioEditor";
import { resetMetadataSaveCoordinatorsForTests } from "../../features/scenario/metadataSaveCoordinator";
import { changeScenarioRowBlockType } from "../../features/scenario/scenarioTableModel";
import type {
  ScenarioCaptionPanelsState,
  ScenarioRow,
  ScenarioSnapshot,
} from "../../features/scenario/types";

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

const preparedRubrics = [
  { id: 1, name: "Новости" },
  { id: 2, name: "Специальный репортаж" },
  { id: 3, name: "Транснефть помогает" },
  { id: 4, name: "Волонтеры Транснефти" },
  { id: 5, name: "Люди компании" },
  { id: 6, name: "Новость дня" },
  { id: 7, name: "Оптимум" },
  { id: 8, name: "Спорт" },
];

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

function installEditorApiMock(
  editorRows: ScenarioRow[] = rows,
  options: {
    editState?: ScenarioSnapshot["edit"]["state"];
    captionpanels?: ScenarioCaptionPanelsState;
  } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/stories/101/workflow")) {
      return jsonResponse({
        story_id: 101,
        review_request: null,
        editorial_check: null,
        proofread: null,
        changed_after_proofread: false,
        reproofread_request: null,
        primary_action: null,
        additional_actions: [],
      });
    }
    if (url.endsWith("/api/v1/stories/101/metadata") && init?.method === "PATCH") {
      return jsonResponse({
        ok: true,
        event_id: null,
        changed_at: "2026-07-12T00:00:00Z",
        resource: { type: "story", id: 101 },
      });
    }
    if (url.endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT") {
      const request = JSON.parse(String(init.body));
      return jsonResponse({ ok: true, client_save_id: request.client_save_id, revision: 1, saved_at: "2026-07-12T00:00:00Z" });
    }
    if (url.endsWith("/api/v1/stories/101/scenario/lease")) {
      return jsonResponse({ edit_session_id: 5, lease_token: "lease", expires_at: "2099-07-15T00:01:30Z", revision: 0 });
    }
    if (url.endsWith("/api/v1/stories/101/scenario")) {
      return jsonResponse({
        story: {
          id: project.id,
          title: project.title,
          duration_text: "01:30",
          rubric: preparedRubrics[0],
          author: { id: 1, username: "author", display_name: "Автор", position: "Корреспондент", function_codes: ["author"] },
          priority: { code: "standard", label: "Стандарт" },
          situation: { code: "active", label: "В работе" },
          assignments: [],
          created_at: "2026-07-12T00:00:00Z",
          archived_at: null,
        },
        scenario: { revision: 0, rows: editorRows },
        edit: { state: options.editState ?? "available" },
        metadata: { editable: true, rubrics: preparedRubrics },
        captionpanels: options.captionpanels ?? {
          eligible: true,
          last_opened_revision: null,
          changed_since_last_open: false,
          diff_session_id: null,
        },
      });
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

function appendEditorText(editor: HTMLElement, text: string) {
  editor.textContent = `${editor.textContent ?? ""}${text}`;
  fireEvent.input(editor);
}

beforeEach(() => {
  installLocalStorageStub();
  installEditorDomGeometryStubs();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetMetadataSaveCoordinatorsForTests();
  vi.unstubAllGlobals();
});

describe("ScenarioEditor current behavior characterization", () => {
  it("shows title, duration and prepared rubrics in the compact blue table header", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const metadata = await screen.findByRole("group", { name: "Шапка таблицы сценария" });
    const title = within(metadata).getByRole("textbox", { name: "Название" });
    expect(title.tagName).toBe("TEXTAREA");
    expect(title).toHaveValue("Синтетический сценарий");
    expect(within(metadata).getByRole("textbox", { name: "Хронометраж" })).toHaveValue(
      "01:30",
    );
    expect(
      within(metadata).getByRole("combobox", { name: "Рубрика" })
        .querySelectorAll("option"),
    ).toHaveLength(8);
    expect(
      [...within(metadata).getByRole("combobox", { name: "Рубрика" }).querySelectorAll("option")]
        .map((option) => option.textContent),
    ).toEqual(preparedRubrics.map((rubric) => rubric.name));
  });

  it("keeps formatting tools visible before a row receives focus", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const toolbar = await screen.findByRole("toolbar", { name: "Форматирование" });
    expect(toolbar).toHaveTextContent("Выберите строку и поле");
    expect(within(toolbar).getByRole("button", { name: "Жирный" })).toBeDisabled();
  });

  it("keeps visible find and replace entry points beside the established editor toolbar", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const editor = await screen.findByRole("textbox", { name: "Текст блока 1" });
    editor.focus();
    expect(fireEvent.keyDown(editor, { key: "f", ctrlKey: true })).toBe(false);
    const search = screen.getByRole("search", { name: "Найти и заменить" });
    expect(within(search).getByRole("searchbox", { name: "Найти" })).toHaveFocus();
    expect(screen.getByRole("button", { name: /^Найти$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Найти и заменить" })).toBeVisible();

    fireEvent.keyDown(search, { key: "Escape" });
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(screen.queryByRole("search", { name: "Найти и заменить" })).not.toBeInTheDocument();
    expect(editor).toHaveFocus();
  });

  it("saves table-header metadata through the current story metadata endpoint", async () => {
    const fetchMock = installEditorApiMock();
    const user = userEvent.setup();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const title = await screen.findByRole("textbox", { name: "Название" });
    await user.clear(title);
    await user.type(title, "Обновлённый синтетический заголовок");
    fireEvent.blur(title);
    await user.selectOptions(screen.getByRole("combobox", { name: "Рубрика" }), "8");
    const duration = screen.getByRole("textbox", { name: "Хронометраж" });
    await user.clear(duration);
    await user.type(duration, " 02:45 ");
    fireEvent.blur(duration);

    await waitFor(() => {
      const metadataRequests = fetchMock.mock.calls.filter(([input, init]) =>
        String(input).endsWith("/api/v1/stories/101/metadata") && init?.method === "PATCH");
      expect(metadataRequests).toHaveLength(3);
      expect(JSON.parse(String(metadataRequests[0][1]?.body))).toEqual({
        title: "Обновлённый синтетический заголовок",
      });
      expect(JSON.parse(String(metadataRequests[1][1]?.body))).toEqual({ rubric_id: 8 });
      expect(JSON.parse(String(metadataRequests[2][1]?.body))).toEqual({
        duration_text: "02:45",
      });
    });
    expect(
      screen.getByRole("heading", { name: "Обновлённый синтетический заголовок" }),
    ).toBeInTheDocument();
  });

  it("preserves the compact five-column table and one shared formatting toolbar", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const tableRegion = await screen.findByRole("region", { name: "Таблица сценария" });
    const table = within(tableRegion).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((item) => item.textContent?.trim())).toEqual([
      "№",
      "Блок",
      "Текст",
      "Имя файла / TC",
      "В кадре",
    ]);
    expect(within(table).queryByRole("columnheader", { name: "Действия" })).not.toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: /Изменить ширину столбца/ })).toHaveLength(5);

    const firstRow = within(table).getAllByRole("row")[1];
    expect(within(firstRow).getAllByRole("cell")).toHaveLength(5);
    fireEvent.focus(within(firstRow).getByRole("textbox", { name: "Текст блока 1" }));

    expect(screen.getAllByRole("toolbar", { name: "Форматирование" })).toHaveLength(1);
    const stickyToolbar = document.querySelector(".editor-toolbar-sticky");
    expect(stickyToolbar).not.toBeNull();
    expect(within(stickyToolbar as HTMLElement).getByRole("button", {
      name: "Экспорт DOCX",
    })).toBeInTheDocument();
    expect(within(firstRow).queryByRole("group", { name: "Форматирование блока 1" })).not.toBeInTheDocument();

    const secondRow = within(table).getAllByRole("row")[2];
    fireEvent.focus(within(secondRow).getByRole("textbox", { name: "В кадре 2" }));
    expect(screen.getByRole("toolbar", { name: "Форматирование" })).toHaveTextContent(
      "Строка 1: текста",
    );
  });

  it("keeps smart-quote prose fields in rich/plain sync and one scenario undo action", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const textEditor = within(bodyRows[0]).getByRole("textbox", { name: "Текст блока 1" });
    const commentEditor = within(bodyRows[1]).getByRole("textbox", { name: "В кадре 2" });
    expect(commentEditor).toHaveClass("editor-core-content");
    expect(commentEditor).toHaveTextContent("Синтетический общий план");

    vi.useFakeTimers();
    textEditor.textContent = "«основной текст»";
    fireEvent.input(textEditor);
    commentEditor.textContent = "«текст»";
    fireEvent.input(commentEditor);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    const saveCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT");
    expect(saveCall).toBeDefined();
    const savedRows = JSON.parse(String(saveCall?.[1]?.body)).rows as ScenarioRow[];
    expect(savedRows[0]?.text).toBe("«основной текст»");
    expect(savedRows[0]?.rich_text.targets?.text?.text).toBe("«основной текст»");
    expect(savedRows[1]?.additional_comment).toBe("«текст»");
    expect(savedRows[1]?.rich_text.targets?.additional_comment?.text).toBe("«текст»");

    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(within(bodyRows[1]).getByRole("textbox", { name: "В кадре 2" }))
      .toHaveTextContent("Синтетический общий план");
    expect(within(bodyRows[0]).getByRole("textbox", { name: "Текст блока 1" }))
      .toHaveTextContent("«основной текст»");

    const file = within(bodyRows[1]).getByRole("textbox", {
      name: "Имя файла блока 2, файл 1",
    });
    fireEvent.change(file, { target: { value: '\"synthetic-master\".mov' } });
    expect(file).toHaveValue('\"synthetic-master\".mov');
  });

  it("keeps DOCX export for archived scenarios without an empty formatting toolbar or CaptionPanels regression", async () => {
    installEditorApiMock(rows, {
      editState: "archived",
      captionpanels: {
        eligible: true,
        last_opened_revision: 0,
        changed_since_last_open: true,
        diff_session_id: 42,
      },
    });
    render(<ScenarioEditor storyId={101} userId={1} />);

    const exportButton = await screen.findByRole("button", { name: "Экспорт DOCX" });
    expect(exportButton.closest(".editor-toolbar-sticky")).not.toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Форматирование" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Удалить выбранные" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "CaptionPanels: сценарий изменился после последнего открытия.",
    );
    expect(screen.getByRole("link", { name: "Посмотреть изменения" }))
      .toHaveAttribute("href", "/stories/101/history?session=42");
  });

  it("preserves compact row selection, bulk delete and type-specific add buttons", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const firstRow = within(table).getAllByRole("row")[1];
    const deleteSelected = screen.getByRole("button", { name: "Удалить выбранные" });
    expect(deleteSelected).toBeDisabled();
    fireEvent.click(firstRow);
    expect(deleteSelected).toBeEnabled();

    const blockCell = within(firstRow).getAllByRole("cell")[1];
    expect(within(blockCell).getByRole("button", { name: "Дублировать блок" })).toBeInTheDocument();
    expect(within(blockCell).getByRole("button", { name: "Поднять блок вверх" })).toBeInTheDocument();
    expect(within(blockCell).getByRole("button", { name: "Опустить блок вниз" })).toBeInTheDocument();
    expect(within(blockCell).getByRole("button", { name: "Удалить блок" })).toBeInTheDocument();

    for (const label of ["+ Подводка", "+ ЗК", "+ ЗК+гео", "+ Лайф", "+ СНХ"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    fireEvent.click(deleteSelected);
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(rows.length));
    expect(within(table).queryByText("Ведущий открывает выпуск")).not.toBeInTheDocument();
  });

  it("keeps ctrl multi-selection and inserts a typed block after the last selected row", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    fireEvent.click(bodyRows[0]);
    fireEvent.click(bodyRows[1], { ctrlKey: true });
    expect(table.querySelectorAll("tr.selected-row")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "+ СНХ" }));
    const rowsAfterInsert = within(table).getAllByRole("row").slice(1);
    expect(
      within(rowsAfterInsert[2]).getByRole("combobox", { name: "Тип блока 3" }),
    ).toHaveValue("snh");
    expect(document.activeElement).toHaveAccessibleName("ФИО блока 3");
    expect(screen.getByRole("toolbar", { name: "Форматирование" })).toHaveTextContent(
      "Строка 3: ФИО",
    );
  });

  it("keeps reverse ctrl selection ordered for keyboard actions", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    fireEvent.click(bodyRows[1]);
    fireEvent.click(bodyRows[0], { ctrlKey: true });
    expect(table.querySelectorAll("tr.selected-row")).toHaveLength(2);

    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(7));
    expect(within(table).getAllByText("Закадровый текст")).toHaveLength(2);
    expect(
      within(table).getAllByRole("row").filter((item) =>
        item.textContent?.includes("Ведущий открывает выпуск")),
    ).toHaveLength(1);
  });

  it("restores the established column widths and persists drag resizing", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    expect([...table.querySelectorAll("col")].map((column) => column.getAttribute("style"))).toEqual([
      "width: 36px;",
      "width: 132px;",
      "width: 540px;",
      "width: 220px;",
      "width: 180px;",
    ]);

    const pointerEvent = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: clientX });
      return event;
    };
    fireEvent(
      screen.getByRole("button", { name: "Изменить ширину столбца Текст" }),
      pointerEvent("pointerdown", 100),
    );
    fireEvent(window, pointerEvent("pointermove", 150));
    fireEvent(window, pointerEvent("pointerup", 150));

    expect(table.querySelectorAll("col")[2]).toHaveStyle({ width: "590px" });
    expect(JSON.parse(
      window.localStorage.getItem("newscast-editor-column-widths-v3") || "{}",
    )).toMatchObject({ text: 590 });
  });

  it("removes active resize listeners if the editor unmounts mid-drag", async () => {
    installEditorApiMock();
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ScenarioEditor storyId={101} userId={1} />);

    await screen.findByRole("table");
    const event = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(event, "clientX", { value: 100 });
    fireEvent(
      screen.getByRole("button", { name: "Изменить ширину столбца Текст" }),
      event,
    );
    unmount();

    expect(removeListener).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("pointerup", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("pointercancel", expect.any(Function));
    removeListener.mockRestore();
  });

  it("keeps the editor usable when column width persistence is unavailable", async () => {
    installEditorApiMock();
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const pointerEvent = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "clientX", { value: clientX });
      return event;
    };
    fireEvent(
      screen.getByRole("button", { name: "Изменить ширину столбца Текст" }),
      pointerEvent("pointerdown", 100),
    );
    fireEvent(window, pointerEvent("pointermove", 150));
    fireEvent(window, pointerEvent("pointerup", 150));

    expect(setItem).toHaveBeenCalled();
    expect(table).toBeInTheDocument();
    setItem.mockRestore();
  });

  it("preserves multiple file bundles and timecode normalization in one row", async () => {
    const rowsWithBundles = structuredClone(rows);
    rowsWithBundles[1] = {
      ...rowsWithBundles[1],
      structured_data: {
        file_bundles: [
          { file_name: "synthetic-master.mov", tc_in: "00:01", tc_out: "00:08" },
          { file_name: "synthetic-cutaway.mov", tc_in: "00:09", tc_out: "00:14" },
        ],
      },
    };
    installEditorApiMock(rowsWithBundles);
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const secondRow = within(table).getAllByRole("row")[2];
    expect(within(secondRow).getByDisplayValue("synthetic-master.mov")).toBeInTheDocument();
    expect(within(secondRow).getByDisplayValue("+ synthetic-cutaway.mov")).toBeInTheDocument();
    expect(within(secondRow).getByDisplayValue("00:09")).toBeInTheDocument();
    expect(within(secondRow).getByDisplayValue("00:14")).toBeInTheDocument();
    expect(within(secondRow).getByDisplayValue("synthetic-master.mov")).toHaveAttribute(
      "placeholder",
      "Имя файла / +",
    );
    expect(within(secondRow).getByRole("textbox", { name: "TC IN блока 2, файл 1" }))
      .toHaveAttribute("placeholder", "tc in");
    expect(within(secondRow).getByRole("textbox", { name: "TC OUT блока 2, файл 1" }))
      .toHaveAttribute("placeholder", "tc out");
    expect(secondRow.querySelector(".editor-file-bundle-timecode-divider")).toHaveTextContent("-");

    const secondTcIn = within(secondRow).getByRole("textbox", { name: "TC IN блока 2, файл 2" });
    fireEvent.change(secondTcIn, { target: { value: "1234" } });
    fireEvent.blur(secondTcIn);
    expect(secondTcIn).toHaveValue("12:34");

    const addFile = within(secondRow).getByRole("textbox", { name: "Добавить файл блока 2" });
    fireEvent.focus(addFile);
    fireEvent.change(addFile, { target: { value: "+" } });
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(
      "Имя файла блока 2, файл 3",
    ));
    const focusedFile = document.activeElement as HTMLInputElement;
    expect(focusedFile.selectionStart).toBe(focusedFile.value.length);
    expect(focusedFile.selectionEnd).toBe(focusedFile.value.length);
  });

  it("normalizes hardware plus input without rewriting equals or pasted text", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const secondRow = within(table).getAllByRole("row")[2];
    const draft = within(secondRow).getByRole("textbox", { name: "Добавить файл блока 2" });

    fireEvent.keyDown(draft, { key: "+", code: "Equal", shiftKey: true });

    await waitFor(() => {
      expect(within(secondRow).getByDisplayValue("+")).toBeInTheDocument();
    });
    expect(within(secondRow).queryByDisplayValue("+=")).not.toBeInTheDocument();

    const equalsDraft = within(secondRow).getByRole("textbox", { name: "Добавить файл блока 2" });
    const equalsKeyDown = createEvent.keyDown(equalsDraft, {
      key: "=",
      code: "Equal",
      shiftKey: false,
    });
    fireEvent(equalsDraft, equalsKeyDown);
    expect(equalsKeyDown.defaultPrevented).toBe(false);
    fireEvent.change(equalsDraft, { target: { value: "=" } });
    await waitFor(() => {
      expect(within(secondRow).getByDisplayValue("+ =")).toBeInTheDocument();
    });

    const pasteDraft = within(secondRow).getByRole("textbox", { name: "Добавить файл блока 2" });
    fireEvent.change(pasteDraft, { target: { value: "A+=B" } });
    await waitFor(() => {
      expect(within(secondRow).getByDisplayValue("+ A+=B")).toBeInTheDocument();
    });
  });

  it("restores the caret after replacing a selected plus in an uncommittable draft", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const firstRow = within(table).getAllByRole("row")[1];
    const draft = within(firstRow).getByRole("textbox", {
      name: "Добавить файл блока 1",
    }) as HTMLInputElement;

    fireEvent.change(draft, { target: { value: "+" } });
    draft.setSelectionRange(0, 1);
    fireEvent.keyDown(draft, { key: "+", code: "Equal", shiftKey: true });

    await waitFor(() => {
      expect(draft).toHaveValue("+");
      expect(draft.selectionStart).toBe(1);
      expect(draft.selectionEnd).toBe(1);
    });
  });

  it("preserves text and file bundles while rebuilding structured fields after a block type change", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    vi.useFakeTimers();
    fireEvent.change(within(table).getByRole("combobox", { name: "Тип блока 2" }), {
      target: { value: "zk_geo" },
    });

    expect(within(table).getByRole("textbox", { name: "Гео блока 2" })).toBeInTheDocument();
    expect(within(table).getByRole("textbox", { name: "Текст блока 2" })).toHaveTextContent(
      "Закадровый текст",
    );
    const textEditor = within(table).getByRole("textbox", { name: "Текст блока 2" });
    textEditor.textContent = "Обновлённая строка\nВторая строка";
    fireEvent.input(textEditor);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(saveCall).toBeDefined();
    const savedRows = JSON.parse(String(saveCall?.[1]?.body)).rows as ScenarioRow[];
    expect(savedRows[1]?.structured_data).toEqual({
      geo: "",
      text_lines: ["Обновлённая строка", "Вторая строка"],
      file_bundles: [
        { file_name: "synthetic-master.mov", tc_in: "00:01", tc_out: "00:08" },
      ],
    });
    expect(Object.keys(savedRows[1]?.rich_text.targets || {}).sort()).toEqual([
      "additional_comment",
      "geo",
      "text",
    ]);
    expect(savedRows[1]?.rich_text.targets?.additional_comment?.text).toBe(
      "Синтетический общий план",
    );
  });

  it("escapes plain text when a block type change creates a missing rich-text target", () => {
    const source = row(1, "zk", "<Плашка>\nВторая строка", {
      rich_text: { schema_version: 1, targets: {} },
    });

    const changed = changeScenarioRowBlockType(source, "snh");

    expect(changed.rich_text.targets?.text?.html).toBe("&lt;Плашка&gt;<br>Вторая строка");
  });

  it("preserves the rich-text target for В кадре across a block type change", () => {
    const source = row(1, "zk", "Текст", {
      additional_comment: "Крупный план",
      rich_text: {
        schema_version: 1,
        targets: {
          text: richTarget("Текст"),
          additional_comment: richTarget("Крупный план", "<em>Крупный план</em>"),
        },
      },
    });

    const changed = changeScenarioRowBlockType(source, "snh");

    expect(changed.additional_comment).toBe("Крупный план");
    expect(changed.rich_text.targets?.additional_comment).toEqual(
      richTarget("Крупный план", "<em>Крупный план</em>"),
    );
  });

  it("applies row-level formatting to every selected row", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    fireEvent.focus(within(bodyRows[0]).getByRole("textbox", { name: "Текст блока 1" }));
    fireEvent.click(bodyRows[1], { ctrlKey: true });
    expect(table.querySelectorAll("tr.selected-row")).toHaveLength(2);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Курсив для текста блока 1" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const savedRows = JSON.parse(String(saveCall?.[1]?.body)).rows as ScenarioRow[];
    expect(savedRows[0]?.formatting.targets?.text?.italic).toBe(true);
    expect(savedRows[1]?.formatting.targets?.text?.italic).toBe(true);
  });

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
    expect(
      within(bodyRows[4])
        .getByRole("textbox", { name: "Текст СНХ блока 5" })
        .closest(".editor-core-field"),
    ).toHaveStyle({ fontStyle: "italic" });
    expect(within(bodyRows[1]).getByDisplayValue("synthetic-master.mov")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByDisplayValue("00:01")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByDisplayValue("00:08")).toBeInTheDocument();
  });

  it("preserves the speaker position slot when the SNH name is cleared", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("table");
    const fio = within(table).getByRole("textbox", { name: "ФИО блока 5" });
    vi.useFakeTimers();
    fio.textContent = "";
    fireEvent.input(fio);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const savedRows = JSON.parse(String(saveCall?.[1]?.body)).rows as ScenarioRow[];
    expect(savedRows[4]?.speaker_text).toBe("\nЭксперт лаборатории");
  });

  it("lets the editor select Franklin Gothic Book and serializes its exact canonical formatting", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);

    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    const firstRow = within(table).getAllByRole("row")[1];
    fireEvent.focus(within(firstRow).getByRole("textbox", { name: "Текст блока 1" }));
    const formatToolbar = screen.getByRole("toolbar", { name: "Форматирование" });
    vi.useFakeTimers();

    const fontSelect = within(formatToolbar).getByRole("combobox", { name: "Шрифт для текста блока 1" });
    expect(within(fontSelect).getByRole("option", { name: "Franklin Gothic Book" })).toBeInTheDocument();
    fireEvent.change(fontSelect, {
      target: { value: "Franklin Gothic Book" },
    });
    fireEvent.click(within(formatToolbar).getByRole("button", { name: "Жирный для текста блока 1" }));
    fireEvent.click(within(formatToolbar).getByRole("button", { name: "Курсив для текста блока 1" }));
    fireEvent.click(within(formatToolbar).getByRole("button", { name: "Зачеркнуть для текста блока 1" }));
    fireEvent.click(within(formatToolbar).getByRole("button", { name: "Синий для текста блока 1" }));

    expect(firstRow.querySelector(".editor-core-field")).toHaveStyle({
      fontFamily: '"Franklin Gothic Book", Arial, sans-serif',
      fontWeight: "400",
      fontStyle: "italic",
      textDecoration: "line-through",
      backgroundColor: "#0000ff",
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
          font_family: "Franklin Gothic Book",
          bold: false,
          italic: true,
          strikethrough: true,
          fill_color: "#0000ff",
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
    fireEvent.focus(editor);
    selectEditorText(editor);
    const formatToolbar = screen.getByRole("toolbar", { name: "Форматирование" });
    vi.useFakeTimers();

    fireEvent.click(within(formatToolbar).getByRole("button", { name: "Жирный для текста блока 1" }));
    fireEvent.click(within(formatToolbar).getByRole("button", { name: "Зачеркнуть для текста блока 1" }));

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
    expect(savedRows[0]?.formatting.targets?.text).toMatchObject({
      bold: true,
      strikethrough: false,
    });
  });

  it("supports duplicate, reorder and delete controls without leaving the current editor", async () => {
    installEditorApiMock();
    render(
      <ScenarioEditor storyId={101} userId={1} />
    );

    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    fireEvent.click(within(table).getAllByRole("button", { name: "Дублировать блок" })[0]);
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(7));
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName("Текст блока 2"));
    expect(
      [...table.querySelectorAll(".editor-core-content")].filter((item) =>
        item.textContent?.includes("Ведущий открывает выпуск")
      )
    ).toHaveLength(2);

    const duplicatedRows = within(table).getAllByRole("row").slice(1);
    const duplicateEditor = duplicatedRows[1].querySelector(".editor-core-content") as HTMLElement;
    appendEditorText(duplicateEditor, " — копия");
    expect(duplicatedRows[1]).toHaveTextContent("Ведущий открывает выпуск — копия");

    fireEvent.click(within(table).getAllByRole("button", { name: "Опустить блок вниз" })[0]);
    const movedRows = within(table).getAllByRole("row").slice(1);
    expect(movedRows[0]).toHaveTextContent("Ведущий открывает выпуск — копия");
    expect(movedRows[1]).toHaveTextContent("Ведущий открывает выпуск");
    expect(movedRows[1]).not.toHaveTextContent("— копия");
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName("Текст блока 2"));
    expect(screen.getByRole("toolbar", { name: "Форматирование" })).toHaveTextContent(
      "Строка 2: текста",
    );

    const lifeRow = within(table).getByText("Синтетический интершум").closest("tr");
    expect(lifeRow).not.toBeNull();
    fireEvent.click(within(lifeRow as HTMLTableRowElement).getByRole("button", { name: "Удалить блок" }));
    await waitFor(() => expect(within(table).queryByText("Синтетический интершум")).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName("ФИО блока 5"));
  });

  it("reorders blocks from the accessible drag handle with one structure save", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const sourceRow = bodyRows[0];
    const targetRow = bodyRows[2];
    Object.defineProperty(targetRow, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 200, 900, 100),
    });
    const elementFromPoint = vi.spyOn(document, "elementFromPoint")
      .mockReturnValue(targetRow.querySelector(".editor-text-flow"));
    vi.useFakeTimers();

    const pointerEvent = (type: string, values: Record<string, number | boolean>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries(values).forEach(([key, value]) => {
        Object.defineProperty(event, key, { value });
      });
      return event;
    };
    fireEvent(
      within(sourceRow).getByRole("button", { name: "Перетащить блок 1" }),
      pointerEvent("pointerdown", {
        button: 0,
        isPrimary: true,
        pointerId: 7,
        clientX: 20,
        clientY: 20,
      }),
    );
    fireEvent(document, pointerEvent("pointermove", { pointerId: 7, clientX: 20, clientY: 275 }));
    fireEvent(document, pointerEvent("pointerup", { pointerId: 7, clientX: 20, clientY: 275 }));

    const reorderedRows = within(table).getAllByRole("row").slice(1);
    expect(reorderedRows[0]).toHaveTextContent("Закадровый текст");
    expect(reorderedRows[1]).toHaveTextContent("Текст после гео");
    expect(reorderedRows[2]).toHaveTextContent("Ведущий открывает выпуск");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    const saves = fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT",
    );
    expect(saves).toHaveLength(1);
    expect((JSON.parse(String(saves[0][1]?.body)).rows as ScenarioRow[])
      .map((item) => item.segment_uid)).toEqual([
        "seg_synthetic_2",
        "seg_synthetic_3",
        "seg_synthetic_1",
        "seg_synthetic_4",
        "seg_synthetic_5",
      ]);
    elementFromPoint.mockRestore();
  });

  it("ignores foreign pointer lifecycle events while the owning pointer completes the drag", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const targetRow = bodyRows[2];
    Object.defineProperty(targetRow, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 200, 900, 100),
    });
    const elementFromPoint = vi.spyOn(document, "elementFromPoint")
      .mockReturnValue(targetRow.querySelector(".editor-text-flow"));
    vi.useFakeTimers();
    const pointerEvent = (type: string, values: Record<string, number | boolean>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      return event;
    };

    fireEvent(
      within(bodyRows[0]).getByRole("button", { name: "Перетащить блок 1" }),
      pointerEvent("pointerdown", { button: 0, isPrimary: true, pointerId: 7, clientX: 20, clientY: 20 }),
    );
    fireEvent(document, pointerEvent("pointermove", { pointerId: 99, clientX: 20, clientY: 275 }));
    fireEvent(document, pointerEvent("pointerup", { pointerId: 99, clientX: 20, clientY: 275 }));
    expect(within(table).getAllByRole("row").slice(1)[0]).toHaveTextContent("Ведущий открывает выпуск");
    fireEvent(document, pointerEvent("pointermove", { pointerId: 7, clientX: 20, clientY: 275 }));
    fireEvent(document, pointerEvent("pointerup", { pointerId: 7, clientX: 20, clientY: 275 }));
    expect(within(table).getAllByRole("row").slice(1)[2]).toHaveTextContent("Ведущий открывает выпуск");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT",
    )).toHaveLength(1);
    elementFromPoint.mockRestore();
  });

  it("ignores foreign cancel and cancels when the owning pointer cancels", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const targetRow = bodyRows[2];
    Object.defineProperty(targetRow, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 200, 900, 100),
    });
    const elementFromPoint = vi.spyOn(document, "elementFromPoint")
      .mockReturnValue(targetRow.querySelector(".editor-text-flow"));
    const pointerEvent = (type: string, values: Record<string, number | boolean>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      return event;
    };
    fireEvent(
      within(bodyRows[0]).getByRole("button", { name: "Перетащить блок 1" }),
      pointerEvent("pointerdown", { button: 0, isPrimary: true, pointerId: 7, clientX: 20, clientY: 20 }),
    );
    fireEvent(document, pointerEvent("pointercancel", { pointerId: 99, clientX: 20, clientY: 275 }));
    fireEvent(document, pointerEvent("pointermove", { pointerId: 7, clientX: 20, clientY: 275 }));
    fireEvent(document, pointerEvent("pointercancel", { pointerId: 7, clientX: 20, clientY: 275 }));
    expect(within(table).getAllByRole("row").slice(1)[0]).toHaveTextContent("Ведущий открывает выпуск");
    expect(document.body.style.userSelect).toBe("");
    elementFromPoint.mockRestore();
  });

  it("captures the owning pointer and releases it when the window loses focus", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const handle = within(within(table).getAllByRole("row")[1])
      .getByRole("button", { name: "Перетащить блок 1" });
    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => true);
    const releasePointerCapture = vi.fn();
    Object.assign(handle, { setPointerCapture, hasPointerCapture, releasePointerCapture });
    const event = new Event("pointerdown", { bubbles: true });
    Object.entries({ button: 0, isPrimary: true, pointerId: 7, clientX: 20, clientY: 20 })
      .forEach(([key, value]) => Object.defineProperty(event, key, { value }));

    fireEvent(handle, event);
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.userSelect).toBe("none");
    fireEvent(window, new Event("blur"));
    expect(hasPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.body.style.userSelect).toBe("");
  });

  it("ignores foreign lost capture and cleans up for the owning pointer", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const handle = within(within(table).getAllByRole("row")[1])
      .getByRole("button", { name: "Перетащить блок 1" });
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn(),
    });
    const pointerEvent = (type: string, pointerId: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        button: { value: 0 },
        isPrimary: { value: true },
        pointerId: { value: pointerId },
        clientX: { value: 20 },
        clientY: { value: 20 },
      });
      return event;
    };

    fireEvent(handle, pointerEvent("pointerdown", 7));
    fireEvent(handle, pointerEvent("lostpointercapture", 99));
    expect(document.body.style.userSelect).toBe("none");
    fireEvent(handle, pointerEvent("lostpointercapture", 7));
    expect(document.body.style.userSelect).toBe("");
  });

  it("guards keyboard and button row moves until the active drag completes atomically", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const sourceRow = bodyRows[0];
    const targetRow = bodyRows[2];
    fireEvent.click(sourceRow);
    Object.defineProperty(targetRow, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 200, 900, 100),
    });
    const elementFromPoint = vi.spyOn(document, "elementFromPoint")
      .mockReturnValue(targetRow.querySelector(".editor-text-flow"));
    const handle = within(sourceRow).getByRole("button", { name: "Перетащить блок 1" });
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    });
    const pointerEvent = (type: string, values: Record<string, number | boolean>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      return event;
    };
    vi.useFakeTimers();

    fireEvent(handle, pointerEvent("pointerdown", {
      button: 0, isPrimary: true, pointerId: 7, clientX: 20, clientY: 20,
    }));
    expect(within(sourceRow).getByRole("button", { name: "Опустить блок вниз" }))
      .toBeDisabled();
    expect(fireEvent.keyDown(document.body, {
      key: "ArrowDown", altKey: true, shiftKey: true,
    })).toBe(false);
    expect(within(table).getAllByRole("row").slice(1)[0])
      .toHaveTextContent("Ведущий открывает выпуск");

    fireEvent(document, pointerEvent("pointerup", {
      pointerId: 7, clientX: 20, clientY: 275,
    }));
    expect(within(table).getAllByRole("row").slice(1)[2])
      .toHaveTextContent("Ведущий открывает выпуск");
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(within(table).getAllByRole("row").slice(1)[0])
      .toHaveTextContent("Ведущий открывает выпуск");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT",
    )).toHaveLength(1);
    elementFromPoint.mockRestore();
  });

  it.each([
    ["duplicate", { key: "d", metaKey: true }],
    ["delete", { key: "Delete" }],
    ["backspace", { key: "Backspace" }],
    ["insert", { key: "Enter" }],
  ] as const)("ignores the %s structural keyboard command during drag", async (_label, shortcut) => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const sourceRow = within(table).getAllByRole("row")[1];
    fireEvent.click(sourceRow);
    const handle = within(sourceRow).getByRole("button", { name: "Перетащить блок 1" });
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    });
    const pointerEvent = (type: string, pointerId: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        button: { value: 0 },
        isPrimary: { value: true },
        pointerId: { value: pointerId },
        clientX: { value: 20 },
        clientY: { value: 20 },
      });
      return event;
    };
    vi.useFakeTimers();

    fireEvent(handle, pointerEvent("pointerdown", 7));
    expect(fireEvent.keyDown(document.body, shortcut)).toBe(false);
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(5);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Ведущий открывает выпуск");
    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    fireEvent(document, pointerEvent("pointercancel", 7));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT",
    )).toHaveLength(0);
  });

  it("disables every structural control during drag and records only the final drop", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const firstEditor = within(table).getByRole("textbox", { name: "Текст блока 1" });
    firstEditor.focus();
    appendEditorText(firstEditor, " — до drag");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const sourceRow = bodyRows[0];
    const targetRow = bodyRows[2];
    Object.defineProperty(targetRow, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 200, 900, 100),
    });
    const elementFromPoint = vi.spyOn(document, "elementFromPoint")
      .mockReturnValue(targetRow.querySelector(".editor-text-flow"));
    const handle = within(sourceRow).getByRole("button", { name: "Перетащить блок 1" });
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    });
    const pointerEvent = (type: string, values: Record<string, number | boolean>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      return event;
    };
    vi.useFakeTimers();

    expect(screen.getByRole("button", { name: "Отменить" })).toBeEnabled();
    fireEvent(handle, pointerEvent("pointerdown", {
      button: 0, isPrimary: true, pointerId: 7, clientX: 20, clientY: 20,
    }));

    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Удалить выбранные" })).toBeDisabled();
    screen.getAllByRole("button", { name: /^\+ / }).forEach((button) => {
      expect(button).toBeDisabled();
    });
    expect(within(sourceRow).getByRole("button", { name: "Дублировать блок" })).toBeDisabled();
    expect(within(sourceRow).getByRole("button", { name: "Удалить блок" })).toBeDisabled();
    expect(within(sourceRow).getByRole("combobox", { name: "Тип блока 1" })).toBeDisabled();
    expect(within(sourceRow).getByRole("textbox", { name: "Добавить файл блока 1" })).toBeDisabled();
    expect(within(bodyRows[1]).getByRole("button", { name: "Удалить файл 1 блока 2" }))
      .toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^\+ ЗК$/ }));
    fireEvent.click(within(sourceRow).getByRole("button", { name: "Дублировать блок" }));
    fireEvent.click(within(sourceRow).getByRole("button", { name: "Удалить блок" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить выбранные" }));
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(5);

    fireEvent(document, pointerEvent("pointerup", {
      pointerId: 7, clientX: 20, clientY: 275,
    }));
    expect(within(table).getAllByRole("row").slice(1)[2])
      .toHaveTextContent("Ведущий открывает выпуск — до drag");
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(within(table).getAllByRole("row").slice(1)[0])
      .toHaveTextContent("Ведущий открывает выпуск — до drag");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT",
    )).toHaveLength(1);
    elementFromPoint.mockRestore();
  });

  it("recomputes the pointerup target and cancels when release is outside", async () => {
    const fetchMock = installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("table");
    const sourceRow = within(table).getAllByRole("row")[1];
    const targetRow = within(table).getAllByRole("row")[3];
    Object.defineProperty(targetRow, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 200, 900, 100),
    });
    const elementFromPoint = vi.spyOn(document, "elementFromPoint");
    elementFromPoint.mockReturnValue(targetRow.querySelector(".editor-text-flow"));
    vi.useFakeTimers();
    const pointerEvent = (type: string, values: Record<string, number | boolean>) => {
      const event = new Event(type, { bubbles: true });
      Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
      return event;
    };
    fireEvent(
      within(sourceRow).getByRole("button", { name: "Перетащить блок 1" }),
      pointerEvent("pointerdown", { button: 0, isPrimary: true, pointerId: 7, clientX: 20, clientY: 20 }),
    );
    fireEvent(document, pointerEvent("pointermove", { pointerId: 7, clientX: 20, clientY: 275 }));
    elementFromPoint.mockReturnValue(null);
    fireEvent(document, pointerEvent("pointerup", { pointerId: 7, clientX: 1, clientY: 1 }));
    expect(within(table).getAllByRole("row").slice(1)[0]).toHaveTextContent("Ведущий открывает выпуск");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith("/api/v1/stories/101/scenario") && init?.method === "PUT",
    )).toHaveLength(0);
    expect(document.body.style.userSelect).toBe("");
    elementFromPoint.mockRestore();
  });

  it("undoes and redoes structural, file, formatting and native-field changes globally", async () => {
    installEditorApiMock();
    render(<ScenarioEditor storyId={101} userId={1} />);
    const table = await screen.findByRole("region", { name: "Таблица сценария" });
    const undo = screen.getByRole("button", { name: "Отменить" });
    const redo = screen.getByRole("button", { name: "Повторить" });

    fireEvent.click(screen.getByRole("button", { name: "+ Лайф" }));
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    fireEvent.click(undo);
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    fireEvent.click(redo);
    expect(within(table).getAllByRole("row")).toHaveLength(7);

    fireEvent.click(within(table).getAllByRole("button", { name: "Дублировать блок" })[0]);
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    fireEvent.click(undo);
    expect(within(table).getAllByRole("row")).toHaveLength(7);

    fireEvent.click(within(table).getAllByRole("button", { name: "Опустить блок вниз" })[0]);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Закадровый текст");
    fireEvent.click(undo);
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Ведущий открывает выпуск");

    const lifeRow = within(table).getByText("Синтетический интершум").closest("tr");
    fireEvent.click(within(lifeRow as HTMLTableRowElement).getByRole("button", { name: "Удалить блок" }));
    expect(within(table).queryByText("Синтетический интершум")).not.toBeInTheDocument();
    fireEvent.click(undo);
    expect(within(table).getByText("Синтетический интершум")).toBeInTheDocument();

    const firstRow = within(table).getAllByRole("row")[1];
    const file = within(firstRow).getByRole("textbox", { name: "Добавить файл блока 1" });
    fireEvent.change(file, { target: { value: "new.mov" } });
    expect(within(firstRow).getByRole("textbox", { name: "Имя файла блока 1, файл 1" }))
      .toHaveValue("new.mov");
    fireEvent.click(undo);
    expect(within(firstRow).queryByRole("textbox", { name: "Имя файла блока 1, файл 1" }))
      .not.toBeInTheDocument();
    fireEvent.keyDown(
      within(firstRow).getByRole("textbox", { name: "Добавить файл блока 1" }),
      { key: "y", ctrlKey: true },
    );
    expect(within(firstRow).getByRole("textbox", { name: "Имя файла блока 1, файл 1" }))
      .toHaveValue("new.mov");

    const secondRow = within(table).getAllByRole("row")[2];
    const existingFile = within(secondRow).getByRole("textbox", {
      name: "Имя файла блока 2, файл 1",
    });
    fireEvent.change(existingFile, { target: { value: "synthetic-master-v2.mov" } });
    fireEvent.change(existingFile, { target: { value: "synthetic-master-final.mov" } });
    fireEvent.click(undo);
    expect(existingFile).toHaveValue("synthetic-master.mov");

    const editor = within(firstRow).getByRole("textbox", { name: "Текст блока 1" });
    await act(async () => { await new Promise(requestAnimationFrame); });
    fireEvent.focus(editor);
    fireEvent.click(screen.getByRole("button", { name: "Курсив для текста блока 1" }));
    expect(screen.getByRole("button", { name: "Курсив для текста блока 1" }))
      .toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(screen.getByRole("button", { name: "Курсив для текста блока 1" }))
      .toHaveAttribute("aria-pressed", "false");

    const comment = within(secondRow).getByRole("textbox", { name: "В кадре 2" });
    comment.textContent = "Новая длинная синтетическая ремарка";
    fireEvent.input(comment);
    fireEvent.focus(comment);
    selectEditorText(comment);
    const scrollTo = vi.spyOn(window, "scrollTo");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 321 });
    fireEvent.keyDown(comment, { key: "z", ctrlKey: true });
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(comment).toHaveFocus();
    expect(comment).toHaveTextContent("Синтетический общий план");
    expect(scrollTo).toHaveBeenLastCalledWith(0, 321);
  });
});
