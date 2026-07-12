import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import { EditorCoreField, type EditorCoreFieldChangePayload } from "../features/editor-core/EditorField";
import { fetchLegacyBridgeEditor, saveLegacyBridgeEditor } from "../features/scenario/legacyBridgeApi";
import type {
  ScriptElementFormattingTarget,
  ScriptElementRichTextTarget,
  ScriptElementRow,
} from "../features/scenario/legacyBridgeTypes";

interface EditorPageProps {
  storyId: number;
}

const BLOCK_OPTIONS = [
  { value: "podvodka", label: "Подводка" },
  { value: "zk", label: "ЗК" },
  { value: "zk_geo", label: "ЗК+гео" },
  { value: "life", label: "Лайф" },
  { value: "snh", label: "СНХ" },
] as const;

const AUTOSAVE_DELAY_MS = 1400;
const DEFAULT_FONT_FAMILY = "PT Sans";
const DEFAULT_FILL_COLOR = "#ffffff";
const FONT_OPTIONS = ["PT Sans", "Arial", "Times New Roman"] as const;
const FILL_COLOR_OPTIONS = [
  { value: "#ffffff", label: "белая" },
  { value: "#dceeff", label: "голубая" },
  { value: "#fff3bf", label: "жёлтая" },
  { value: "#d3f9d8", label: "зелёная" },
] as const;

type FormattingTarget = "text" | "geo" | "speaker_fio" | "speaker_position";

function createSegmentUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `seg_${crypto.randomUUID()}`;
  }
  return `seg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cloneRow(row: ScriptElementRow): ScriptElementRow {
  return JSON.parse(JSON.stringify(row)) as ScriptElementRow;
}

function richTarget(row: ScriptElementRow, target: string): ScriptElementRichTextTarget | null {
  return row.rich_text.targets?.[target] ?? null;
}

function textForTarget(row: ScriptElementRow, target: string): string {
  if (target === "text") return row.text;
  if (target === "geo") return typeof row.structured_data.geo === "string" ? row.structured_data.geo : "";
  const [fio = "", position = ""] = row.speaker_text.split("\n");
  return target === "speaker_fio" ? fio : position;
}

function defaultFormattingTarget(blockType: string, target: FormattingTarget): ScriptElementFormattingTarget {
  const normalizedBlockType = blockType.trim().toLowerCase();
  const italic =
    normalizedBlockType === "life" ||
    (normalizedBlockType === "zk_geo" && target === "geo") ||
    (normalizedBlockType === "snh" && target !== "text");
  return {
    font_family: DEFAULT_FONT_FAMILY,
    bold: normalizedBlockType === "snh" && target !== "text",
    italic,
    strikethrough: false,
    fill_color: DEFAULT_FILL_COLOR,
  };
}

function formattingTarget(row: ScriptElementRow, target: FormattingTarget): ScriptElementFormattingTarget {
  const defaults = defaultFormattingTarget(row.block_type, target);
  const source = row.formatting.targets?.[target];
  return {
    ...defaults,
    ...source,
    font_family: source?.font_family?.trim() || defaults.font_family,
    fill_color: source?.fill_color?.trim() || defaults.fill_color,
  };
}

function formattingStyle(target: ScriptElementFormattingTarget) {
  return {
    fontFamily: target.font_family || DEFAULT_FONT_FAMILY,
    fontWeight: target.bold ? 700 : 400,
    fontStyle: target.italic ? "italic" : "normal",
    textDecoration: target.strikethrough ? "line-through" : "none",
    backgroundColor: target.fill_color || DEFAULT_FILL_COLOR,
  };
}

function updateFormattingTarget(
  row: ScriptElementRow,
  target: FormattingTarget,
  patch: Partial<ScriptElementFormattingTarget>
): ScriptElementRow {
  return {
    ...row,
    formatting: {
      ...row.formatting,
      targets: {
        ...(row.formatting.targets ?? {}),
        [target]: {
          ...formattingTarget(row, target),
          ...patch,
        },
      },
    },
  };
}

function formattingTargetLabel(target: FormattingTarget): string {
  switch (target) {
    case "geo":
      return "гео";
    case "speaker_fio":
      return "ФИО";
    case "speaker_position":
      return "должности";
    default:
      return "текста";
  }
}

function updateTextTarget(
  row: ScriptElementRow,
  target: string,
  payload: EditorCoreFieldChangePayload
): ScriptElementRow {
  const next = cloneRow(row);
  const targets = { ...(next.rich_text.targets ?? {}) };
  targets[target] = payload;
  next.rich_text = { ...next.rich_text, schema_version: next.rich_text.schema_version || 1, targets };

  if (target === "text") {
    next.text = payload.text;
  } else if (target === "geo") {
    next.structured_data = { ...next.structured_data, geo: payload.text };
  } else {
    const fio = target === "speaker_fio" ? payload.text : textForTarget(row, "speaker_fio");
    const position = target === "speaker_position" ? payload.text : textForTarget(row, "speaker_position");
    next.speaker_text = [fio, position].filter(Boolean).join("\n");
  }
  return next;
}

function createEmptyRow(orderIndex: number): ScriptElementRow {
  return {
    id: null,
    segment_uid: createSegmentUid(),
    order_index: orderIndex,
    block_type: "zk",
    text: "",
    speaker_text: "",
    file_name: "",
    tc_in: "",
    tc_out: "",
    additional_comment: "",
    structured_data: {},
    formatting: {},
    rich_text: { schema_version: 1, targets: {} },
  };
}

function withOrderIndexes(rows: ScriptElementRow[]): ScriptElementRow[] {
  return rows.map((row, index) => ({ ...row, order_index: index + 1 }));
}

function updateField(row: ScriptElementRow, field: "file_name" | "tc_in" | "tc_out" | "additional_comment", value: string): ScriptElementRow {
  return { ...row, [field]: value };
}

function ScenarioRow({
  row,
  index,
  rowCount,
  onChange,
  onDuplicate,
  onMove,
  onDelete,
}: {
  row: ScriptElementRow;
  index: number;
  rowCount: number;
  onChange: (next: ScriptElementRow) => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [activeFormattingTarget, setActiveFormattingTarget] = useState<FormattingTarget>("text");
  const currentRowRef = useRef(row);
  const editorsRef = useRef<Partial<Record<FormattingTarget, TiptapEditor>>>({});
  currentRowRef.current = row;

  const notifyRowChange = useCallback((next: ScriptElementRow) => {
    currentRowRef.current = next;
    onChange(next);
  }, [onChange]);

  const changeRichText = (target: string) => (payload: EditorCoreFieldChangePayload) => {
    notifyRowChange(updateTextTarget(currentRowRef.current, target, payload));
  };
  const activeFormatting = formattingTarget(row, activeFormattingTarget);
  const editorLabel = `блока ${index + 1}`;
  const changeFormatting = (patch: Partial<ScriptElementFormattingTarget>) => {
    notifyRowChange(updateFormattingTarget(currentRowRef.current, activeFormattingTarget, patch));
  };
  const focusTarget = (target: FormattingTarget) => () => setActiveFormattingTarget(target);
  const registerTargetEditor = useCallback((target: FormattingTarget) => (_editorId: string, editor: TiptapEditor | null) => {
    if (editor) {
      editorsRef.current[target] = editor;
    } else {
      delete editorsRef.current[target];
    }
  }, []);
  const applyFormatting = (patch: Partial<ScriptElementFormattingTarget>) => {
    const editor = editorsRef.current[activeFormattingTarget];
    if (editor) {
      const chain = editor.chain().focus();
      if (patch.font_family !== undefined) chain.setFontFamily(patch.font_family);
      if (patch.bold !== undefined) {
        if (patch.bold) chain.setMark("bold");
        else chain.unsetMark("bold");
      }
      if (patch.italic !== undefined) {
        if (patch.italic) chain.setMark("italic");
        else chain.unsetMark("italic");
      }
      if (patch.strikethrough !== undefined) {
        if (patch.strikethrough) chain.setMark("strike");
        else chain.unsetMark("strike");
      }
      if (patch.fill_color !== undefined) chain.setHighlight({ color: patch.fill_color });
      chain.run();
    }
    changeFormatting(patch);
  };

  return (
    <tr>
      <td>{index + 1}</td>
      <td>
        <select
          aria-label={`Тип блока ${index + 1}`}
          value={row.block_type}
          onChange={(event) => onChange({ ...row, block_type: event.target.value })}
        >
          {BLOCK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </td>
      <td>
        {row.block_type === "zk_geo" ? (
          <>
            <EditorCoreField
              editorId={`${row.segment_uid ?? row.id ?? index}:geo`}
              richTextTarget={richTarget(row, "geo")}
              plainTextValue={textForTarget(row, "geo")}
              disabled={false}
              placeholder="Гео"
              className="editor-cell editor-cell-geo"
              style={formattingStyle(formattingTarget(row, "geo"))}
              onFocusField={focusTarget("geo")}
              onChangeValue={changeRichText("geo")}
              onRegister={registerTargetEditor("geo")}
              onSelectionChange={() => {}}
            />
            <EditorCoreField
              editorId={`${row.segment_uid ?? row.id ?? index}:text`}
              richTextTarget={richTarget(row, "text")}
              plainTextValue={row.text}
              disabled={false}
              placeholder="Текст"
              className="editor-cell"
              style={formattingStyle(formattingTarget(row, "text"))}
              onFocusField={focusTarget("text")}
              onChangeValue={changeRichText("text")}
              onRegister={registerTargetEditor("text")}
              onSelectionChange={() => {}}
            />
          </>
        ) : row.block_type === "snh" ? (
          <>
            <EditorCoreField
              editorId={`${row.segment_uid ?? row.id ?? index}:speaker_fio`}
              richTextTarget={richTarget(row, "speaker_fio")}
              plainTextValue={textForTarget(row, "speaker_fio")}
              disabled={false}
              placeholder="ФИО"
              className="editor-cell editor-cell-speaker"
              style={formattingStyle(formattingTarget(row, "speaker_fio"))}
              onFocusField={focusTarget("speaker_fio")}
              onChangeValue={changeRichText("speaker_fio")}
              onRegister={registerTargetEditor("speaker_fio")}
              onSelectionChange={() => {}}
            />
            <EditorCoreField
              editorId={`${row.segment_uid ?? row.id ?? index}:speaker_position`}
              richTextTarget={richTarget(row, "speaker_position")}
              plainTextValue={textForTarget(row, "speaker_position")}
              disabled={false}
              placeholder="Должность"
              className="editor-cell editor-cell-speaker"
              style={formattingStyle(formattingTarget(row, "speaker_position"))}
              onFocusField={focusTarget("speaker_position")}
              onChangeValue={changeRichText("speaker_position")}
              onRegister={registerTargetEditor("speaker_position")}
              onSelectionChange={() => {}}
            />
            <EditorCoreField
              editorId={`${row.segment_uid ?? row.id ?? index}:text`}
              richTextTarget={richTarget(row, "text")}
              plainTextValue={row.text}
              disabled={false}
              placeholder="Текст СНХ"
              className="editor-cell"
              style={formattingStyle(formattingTarget(row, "text"))}
              onFocusField={focusTarget("text")}
              onChangeValue={changeRichText("text")}
              onRegister={registerTargetEditor("text")}
              onSelectionChange={() => {}}
            />
          </>
        ) : (
          <EditorCoreField
            editorId={`${row.segment_uid ?? row.id ?? index}:text`}
            richTextTarget={richTarget(row, "text")}
            plainTextValue={row.text}
            disabled={false}
            placeholder="Текст блока"
            className="editor-cell"
            style={formattingStyle(formattingTarget(row, "text"))}
            onFocusField={focusTarget("text")}
            onChangeValue={changeRichText("text")}
            onRegister={registerTargetEditor("text")}
            onSelectionChange={() => {}}
          />
        )}
        <div className="editor-format-toolbar" role="group" aria-label={`Форматирование ${editorLabel}`}>
          <label>
            Шрифт
            <select
              aria-label={`Шрифт для ${formattingTargetLabel(activeFormattingTarget)} ${editorLabel}`}
              value={activeFormatting.font_family}
              onChange={(event) => applyFormatting({ font_family: event.target.value })}
            >
              {FONT_OPTIONS.map((fontFamily) => <option key={fontFamily} value={fontFamily}>{fontFamily}</option>)}
            </select>
          </label>
          <button
            type="button"
            aria-label={`Жирный для ${formattingTargetLabel(activeFormattingTarget)} ${editorLabel}`}
            aria-pressed={Boolean(activeFormatting.bold)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyFormatting({ bold: !activeFormatting.bold })}
          >Жирный</button>
          <button
            type="button"
            aria-label={`Курсив для ${formattingTargetLabel(activeFormattingTarget)} ${editorLabel}`}
            aria-pressed={Boolean(activeFormatting.italic)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyFormatting({ italic: !activeFormatting.italic })}
          >Курсив</button>
          <button
            type="button"
            aria-label={`Зачеркнуть для ${formattingTargetLabel(activeFormattingTarget)} ${editorLabel}`}
            aria-pressed={Boolean(activeFormatting.strikethrough)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyFormatting({ strikethrough: !activeFormatting.strikethrough })}
          >Зачеркнуть</button>
          {FILL_COLOR_OPTIONS.map((color) => (
            <button
              key={color.value}
              type="button"
              className="editor-color-swatch"
              aria-label={`Заливка: ${color.label} для ${formattingTargetLabel(activeFormattingTarget)} ${editorLabel}`}
              aria-pressed={activeFormatting.fill_color === color.value}
              style={{ backgroundColor: color.value }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyFormatting({ fill_color: color.value })}
            />
          ))}
        </div>
      </td>
      <td>
        <input aria-label={`Имя файла ${index + 1}`} value={row.file_name} onChange={(event) => onChange(updateField(row, "file_name", event.target.value))} />
        <input aria-label={`TC IN ${index + 1}`} value={row.tc_in} onChange={(event) => onChange(updateField(row, "tc_in", event.target.value))} />
        <input aria-label={`TC OUT ${index + 1}`} value={row.tc_out} onChange={(event) => onChange(updateField(row, "tc_out", event.target.value))} />
      </td>
      <td>
        <input aria-label={`В кадре ${index + 1}`} value={row.additional_comment} onChange={(event) => onChange(updateField(row, "additional_comment", event.target.value))} />
      </td>
      <td>
        <button type="button" aria-label="Дублировать блок" onClick={onDuplicate}>Дублировать</button>
        <button type="button" aria-label="Поднять блок вверх" disabled={index === 0} onClick={() => onMove(-1)}>Вверх</button>
        <button type="button" aria-label="Опустить блок вниз" disabled={index === rowCount - 1} onClick={() => onMove(1)}>Вниз</button>
        <button type="button" aria-label="Удалить блок" onClick={onDelete}>Удалить</button>
      </td>
    </tr>
  );
}

export default function EditorPage({ storyId }: EditorPageProps) {
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<ScriptElementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autosaveState, setAutosaveState] = useState<"idle" | "pending" | "saving" | "error">("idle");
  const rowsRef = useRef<ScriptElementRow[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const loadedRef = useRef(false);

  const replaceRows = useCallback((nextRows: ScriptElementRow[]) => {
    const ordered = withOrderIndexes(nextRows);
    rowsRef.current = ordered;
    setRows(ordered);
  }, []);

  const loadEditor = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchLegacyBridgeEditor(storyId);
      setTitle(payload.story.title);
      replaceRows(payload.elements);
      loadedRef.current = true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить сценарий");
    } finally {
      setLoading(false);
    }
  }, [replaceRows, storyId]);

  useEffect(() => { void loadEditor(); }, [loadEditor]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  const scheduleSave = useCallback((nextRows: ScriptElementRow[]) => {
    if (!loadedRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    setAutosaveState("pending");
    saveTimerRef.current = window.setTimeout(async () => {
      setAutosaveState("saving");
      try {
        const payload = await saveLegacyBridgeEditor(storyId, nextRows);
        setTitle(payload.story.title);
        // CP2 bridge intentionally follows the historical response contract. CP3 replaces it
        // with local-authoritative single-flight autosave and acknowledgement-only responses.
        replaceRows(payload.elements);
        setAutosaveState("idle");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Не удалось сохранить сценарий");
        setAutosaveState("error");
      }
    }, AUTOSAVE_DELAY_MS);
  }, [replaceRows, storyId]);

  const mutateRows = useCallback((updater: (current: ScriptElementRow[]) => ScriptElementRow[]) => {
    const next = withOrderIndexes(updater(rowsRef.current));
    rowsRef.current = next;
    setRows(next);
    scheduleSave(next);
  }, [scheduleSave]);

  if (loading) return <p className="muted" role="status">Загрузка сценария...</p>;
  if (error && rows.length === 0) return <p className="error" role="alert">{error}</p>;

  return (
    <section className="editor-page" aria-label="Редактор сценария">
      <div className="editor-page-heading">
        <h2>{title || "Сценарий"}</h2>
        {autosaveState === "pending" ? <span className="muted">Черновик изменен</span> : null}
        {autosaveState === "saving" ? <span className="muted">Автосохранение...</span> : null}
        {autosaveState === "error" ? <span className="error" role="alert">Сценарий остался в редакторе: {error}</span> : null}
      </div>
      <section className="editor-table-wrap" aria-label="Таблица сценария">
        <table>
          <thead><tr><th>№</th><th>Блок</th><th>Текст</th><th>Имя файла / TC</th><th>В кадре</th><th>Действия</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <ScenarioRow
                key={row.segment_uid ?? `row-${row.id ?? index}`}
                row={row}
                index={index}
                rowCount={rows.length}
                onChange={(next) => mutateRows((current) => current.map((item, itemIndex) => itemIndex === index ? next : item))}
                onDuplicate={() => mutateRows((current) => {
                  const duplicate = cloneRow(current[index]);
                  duplicate.id = null;
                  duplicate.segment_uid = createSegmentUid();
                  return [...current.slice(0, index + 1), duplicate, ...current.slice(index + 1)];
                })}
                onMove={(direction) => mutateRows((current) => {
                  const targetIndex = index + direction;
                  if (targetIndex < 0 || targetIndex >= current.length) return current;
                  const next = [...current];
                  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
                  return next;
                })}
                onDelete={() => mutateRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              />
            ))}
          </tbody>
        </table>
      </section>
      <button type="button" onClick={() => mutateRows((current) => [...current, createEmptyRow(current.length + 1)])}>Добавить блок</button>
    </section>
  );
}
