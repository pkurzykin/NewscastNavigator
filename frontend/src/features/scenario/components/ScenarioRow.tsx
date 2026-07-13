import { useCallback, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import { EditorCoreField, type EditorCoreFieldChangePayload } from "../../editor-core/EditorField";
import type { ScenarioFormattingTarget, ScenarioRow as Row } from "../types";

const blockOptions = [["podvodka", "Подводка"], ["zk", "ЗК"], ["zk_geo", "ЗК+гео"], ["life", "Лайф"], ["snh", "СНХ"]] as const;
const fontOptions = ["PT Sans", "Arial", "Times New Roman"] as const;
const colors = [["#ffffff", "белая"], ["#dceeff", "голубая"], ["#fff3bf", "жёлтая"], ["#d3f9d8", "зелёная"]] as const;
type Target = "text" | "geo" | "speaker_fio" | "speaker_position";

function clone(row: Row): Row { return structuredClone(row); }
function targetText(row: Row, target: Target): string {
  if (target === "text") return row.text;
  if (target === "geo") return typeof row.structured_data.geo === "string" ? row.structured_data.geo : "";
  const [fio = "", position = ""] = row.speaker_text.split("\n");
  return target === "speaker_fio" ? fio : position;
}
function defaultFormat(row: Row, target: Target): ScenarioFormattingTarget {
  const italic = row.block_type === "life" || (row.block_type === "zk_geo" && target === "geo") || (row.block_type === "snh" && target !== "text");
  return { font_family: "PT Sans", bold: row.block_type === "snh" && target !== "text", italic, strikethrough: false, fill_color: "#ffffff" };
}
function format(row: Row, target: Target): ScenarioFormattingTarget { return { ...defaultFormat(row, target), ...(row.formatting.targets?.[target] || {}) }; }
function setFormat(row: Row, target: Target, patch: Partial<ScenarioFormattingTarget>): Row {
  return { ...row, formatting: { ...row.formatting, targets: { ...(row.formatting.targets || {}), [target]: { ...format(row, target), ...patch } } } };
}
function setRichText(row: Row, target: Target, payload: EditorCoreFieldChangePayload): Row {
  const next = clone(row);
  next.rich_text = { ...next.rich_text, schema_version: next.rich_text.schema_version || 1, targets: { ...(next.rich_text.targets || {}), [target]: payload } };
  if (target === "text") next.text = payload.text;
  else if (target === "geo") next.structured_data = { ...next.structured_data, geo: payload.text };
  else {
    const fio = target === "speaker_fio" ? payload.text : targetText(row, "speaker_fio");
    const position = target === "speaker_position" ? payload.text : targetText(row, "speaker_position");
    next.speaker_text = [fio, position].filter(Boolean).join("\n");
  }
  return next;
}

export default function ScenarioRow({ row, index, rowCount, readOnly, onChange, onDuplicate, onMove, onDelete }: {
  row: Row; index: number; rowCount: number; readOnly: boolean; onChange: (row: Row) => void; onDuplicate: () => void; onMove: (direction: -1 | 1) => void; onDelete: () => void;
}) {
  const [activeTarget, setActiveTarget] = useState<Target>("text");
  const rowRef = useRef(row); rowRef.current = row;
  const editorsRef = useRef<Partial<Record<Target, TiptapEditor>>>({});
  const currentFormat = format(row, activeTarget);
  const update = useCallback((next: Row) => { rowRef.current = next; onChange(next); }, [onChange]);
  const editor = (target: Target, placeholder: string, className = "editor-cell") => (
    <EditorCoreField
      editorId={`${row.segment_uid}:${target}`} richTextTarget={row.rich_text.targets?.[target] ?? null} plainTextValue={targetText(row, target)} disabled={readOnly}
      placeholder={placeholder} className={className} ariaLabel={`${placeholder} блока ${index + 1}`}
      style={{ fontFamily: format(row, target).font_family, fontWeight: format(row, target).bold ? 700 : 400, fontStyle: format(row, target).italic ? "italic" : "normal", textDecoration: format(row, target).strikethrough ? "line-through" : "none", backgroundColor: format(row, target).fill_color }}
      onFocusField={() => setActiveTarget(target)} onSelectionChange={() => {}} onChangeValue={(payload) => update(setRichText(rowRef.current, target, payload))}
      onRegister={(_id, instance) => { if (instance) editorsRef.current[target] = instance; else delete editorsRef.current[target]; }}
    />
  );
  const applyFormat = (patch: Partial<ScenarioFormattingTarget>) => {
    const activeEditor = editorsRef.current[activeTarget];
    if (activeEditor) {
      const chain = activeEditor.chain().focus();
      if (patch.font_family !== undefined) chain.setFontFamily(patch.font_family);
      if (patch.bold !== undefined) patch.bold ? chain.setMark("bold") : chain.unsetMark("bold");
      if (patch.italic !== undefined) patch.italic ? chain.setMark("italic") : chain.unsetMark("italic");
      if (patch.strikethrough !== undefined) patch.strikethrough ? chain.setMark("strike") : chain.unsetMark("strike");
      if (patch.fill_color !== undefined) chain.setHighlight({ color: patch.fill_color });
      chain.run();
    }
    update(setFormat(rowRef.current, activeTarget, patch));
  };
  const label = activeTarget === "geo" ? "гео" : activeTarget === "speaker_fio" ? "ФИО" : activeTarget === "speaker_position" ? "должности" : "текста";
  return <tr>
    <td>{index + 1}</td>
    <td><select aria-label={`Тип блока ${index + 1}`} disabled={readOnly} value={row.block_type} onChange={(event) => onChange({ ...row, block_type: event.target.value as Row["block_type"] })}>{blockOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></td>
    <td>
      {row.block_type === "zk_geo" ? <>{editor("geo", "Гео", "editor-cell editor-cell-geo")}{editor("text", "Текст")}</> : row.block_type === "snh" ? <>{editor("speaker_fio", "ФИО", "editor-cell editor-cell-speaker")}{editor("speaker_position", "Должность", "editor-cell editor-cell-speaker")}{editor("text", "Текст СНХ")}</> : editor("text", "Текст")}
      {!readOnly && <div className="editor-format-toolbar" role="group" aria-label={`Форматирование блока ${index + 1}`}>
        <label>Шрифт<select aria-label={`Шрифт для ${label} блока ${index + 1}`} value={currentFormat.font_family} onChange={(event) => applyFormat({ font_family: event.target.value })}>{fontOptions.map((font) => <option key={font}>{font}</option>)}</select></label>
        <button type="button" aria-label={`Жирный для ${label} блока ${index + 1}`} aria-pressed={!!currentFormat.bold} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat({ bold: !currentFormat.bold })}>Жирный</button>
        <button type="button" aria-label={`Курсив для ${label} блока ${index + 1}`} aria-pressed={!!currentFormat.italic} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat({ italic: !currentFormat.italic })}>Курсив</button>
        <button type="button" aria-label={`Зачеркнуть для ${label} блока ${index + 1}`} aria-pressed={!!currentFormat.strikethrough} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat({ strikethrough: !currentFormat.strikethrough })}>Зачеркнуть</button>
        {colors.map(([value, name]) => <button key={value} type="button" className="editor-color-swatch" aria-label={`Заливка: ${name} для ${label} блока ${index + 1}`} aria-pressed={currentFormat.fill_color === value} style={{ backgroundColor: value }} onMouseDown={(event) => event.preventDefault()} onClick={() => applyFormat({ fill_color: value })} />)}
      </div>}
    </td>
    <td><input aria-label={`Имя файла ${index + 1}`} disabled={readOnly} value={row.file_name} onChange={(event) => onChange({ ...row, file_name: event.target.value })} /><input aria-label={`TC IN ${index + 1}`} disabled={readOnly} value={row.tc_in} onChange={(event) => onChange({ ...row, tc_in: event.target.value })} /><input aria-label={`TC OUT ${index + 1}`} disabled={readOnly} value={row.tc_out} onChange={(event) => onChange({ ...row, tc_out: event.target.value })} /></td>
    <td><input aria-label={`В кадре ${index + 1}`} disabled={readOnly} value={row.additional_comment} onChange={(event) => onChange({ ...row, additional_comment: event.target.value })} /></td>
    <td>{!readOnly && <><button type="button" aria-label="Дублировать блок" onClick={onDuplicate}>Дублировать</button><button type="button" aria-label="Поднять блок вверх" disabled={index === 0} onClick={() => onMove(-1)}>Вверх</button><button type="button" aria-label="Опустить блок вниз" disabled={index === rowCount - 1} onClick={() => onMove(1)}>Вниз</button><button type="button" aria-label="Удалить блок" onClick={onDelete}>Удалить</button></>}</td>
  </tr>;
}
