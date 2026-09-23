import type { CSSProperties, ReactNode } from "react";
import { textChangeRanges, type TextChangeRange } from "../textChangeRanges";

import { editorFontCssStack, isAllowedEditorFont } from "../../editor-core/fontRegistry";
import {
  FILL_COLOR_OPTIONS,
} from "../../scenario/scenarioTableModel";
import {
  buildSemanticScenarioDiff,
  type SemanticFieldDiff,
  type SemanticRowDiff,
  type SemanticValue,
} from "../semanticScenarioDiff";
import type { ScenarioSessionDiffResponse } from "../types";

const kindLabels: Record<SemanticRowDiff["kind"], string> = {
  added: "Добавлен блок",
  removed: "Удалён блок",
  changed: "Изменён блок",
  moved: "Перемещён блок",
};

const allowedFillColors = new Set<string>(
  FILL_COLOR_OPTIONS.map((option) => option.value),
);

function valueStyle(value: SemanticValue | null): CSSProperties {
  const formatting = value?.formatting;
  return {
    fontFamily: isAllowedEditorFont(formatting?.font_family)
      ? editorFontCssStack(formatting.font_family)
      : undefined,
    fontWeight: formatting?.bold ? 700 : undefined,
    fontStyle: formatting?.italic ? "italic" : undefined,
    textDecoration: formatting?.strikethrough ? "line-through" : undefined,
    backgroundColor: formatting?.fill_color
      && allowedFillColors.has(formatting.fill_color)
      ? formatting.fill_color
      : undefined,
  };
}

function blockTitle(change: SemanticRowDiff): string {
  const position = change.after_order ?? change.before_order;
  return `${kindLabels[change.kind]}${position === null ? "" : ` · строка ${position}`}`;
}

function changedText(value: SemanticValue, ranges: TextChangeRange[], side: "before" | "after"): ReactNode {
  if (!ranges.length && !value.runs?.length) return value.text;
  const runs = value.runs?.length ? value.runs : [{ text: value.text, formatting: value.formatting }];
  const result: ReactNode[] = [];
  let offset = 0;
  let rangeIndex = 0;
  for (const run of runs) {
    const end = offset + run.text.length;
    let cursor = offset;
    const pieces: ReactNode[] = [];
    while (cursor < end) {
      while (rangeIndex < ranges.length && ranges[rangeIndex].end <= cursor) rangeIndex++;
      const range = ranges[rangeIndex];
      const changed = range !== undefined && range.start <= cursor;
      const next = Math.min(end, range ? (changed ? range.end : range.start) : end);
      const text = run.text.slice(cursor - offset, next - offset);
      pieces.push(changed
        ? side === "before"
          ? <del className="history-diff-removed-text" key={cursor}>{text}</del>
          : <ins className="history-diff-added-text" key={cursor}>{text}</ins>
        : text);
      cursor = next;
    }
    result.push(<span className="history-diff-run" key={offset} style={valueStyle({ text: run.text, formatting: run.formatting })}>{pieces}</span>);
    offset = end;
  }
  return result;
}

function formattingDescription(value: SemanticValue | null): string {
  const formats = value?.runs?.length ? value.runs.map(run => run.formatting) : [value?.formatting];
  return [...new Set(formats.map(format => [
    format?.font_family || "Основной шрифт",
    format?.bold ? "полужирный" : "обычный",
    format?.italic ? "курсив" : "",
    format?.strikethrough ? "зачёркнутый" : "",
    format?.fill_color && format.fill_color !== "#ffffff"
      ? `заливка: ${FILL_COLOR_OPTIONS.find(option => option.value === format.fill_color)?.label || "цветная"}` : "",
  ].filter(Boolean).join(" · ")))].join("; ");
}

function SemanticValueText({ label, side, value, ranges }: {
  label: string; side: "before" | "after"; value: SemanticValue | null; ranges: TextChangeRange[];
}) {
  return <div className="history-diff-text">
    <span className="history-diff-label">{label}</span>
    <p data-side={side} style={valueStyle(value)}>{value ? changedText(value, ranges, side) : "—"}</p>
  </div>;
}

function SemanticField({
  change,
  field,
}: {
  change: SemanticRowDiff;
  field: SemanticFieldDiff;
}) {
  const singleSide = change.kind === "added"
    ? { label: "Добавлено", side: "after" as const, value: field.after }
    : change.kind === "removed"
      ? { label: "Удалено", side: "before" as const, value: field.before }
      : null;

  if (singleSide && !singleSide.value) return null;
  const ranges = textChangeRanges(field.before?.text ?? "", field.after?.text ?? "");
  const formattingOnly = Boolean(field.before && field.after && field.before.text === field.after.text);

  return (
    <section className="history-diff-field" aria-label={field.label}>
      <strong>{field.label}</strong>
      {formattingOnly ? <div className="history-format-change">
        <strong>Изменено оформление</strong>
        <span>Было: {formattingDescription(field.before)}</span>
        <span>Стало: {formattingDescription(field.after)}</span>
      </div> : null}
      {singleSide ? (
        <SemanticValueText {...singleSide} ranges={ranges[singleSide.side]} />
      ) : (
        <div className="history-diff-columns">
          <SemanticValueText label="Было" side="before" value={field.before} ranges={ranges.before} />
          <SemanticValueText label="Стало" side="after" value={field.after} ranges={ranges.after} />
        </div>
      )}
    </section>
  );
}

export default function ScenarioSessionDiff({ diff }: { diff: ScenarioSessionDiffResponse }) {
  const changes = buildSemanticScenarioDiff(diff.changes, diff.default_font_family);
  const fonts = diff.default_font_family;
  const fontChanged = Boolean(fonts && fonts.before !== fonts.after);

  if (changes.length === 0 && !fontChanged) {
    return <p className="muted history-diff-empty">Содержательных изменений нет.</p>;
  }

  return (
    <section className="history-diff" aria-label="Изменения сценария">
      <div className="history-diff-head">
        <h4>Изменения сценария</h4>
        <span className="history-diff-state-range">
          Сохранённые состояния {diff.session.from_revision} → {diff.session.to_revision}
        </span>
      </div>
      {fontChanged && fonts ? <section className="history-format-change" aria-label="Шрифт сценария">
        <strong>Изменён основной шрифт сценария</strong>
        <div className="history-diff-columns">
          <SemanticValueText label="Было" side="before" value={{ text: fonts.before }} ranges={[]} />
          <SemanticValueText label="Стало" side="after" value={{ text: fonts.after }} ranges={[]} />
        </div>
        <span>Шрифты, выбранные вручную, сохранены.</span>
      </section> : null}
      {changes.length ? <div className="history-diff-legend" aria-label="Обозначения изменений">
        <span className="history-diff-removed-text">Удалённые фрагменты</span>
        <span className="history-diff-added-text">Добавленные фрагменты</span>
      </div> : null}
      <ol className="history-diff-list">
        {changes.map((change) => (
          <li key={change.segment_uid} className={`history-diff-row history-diff-row-${change.kind}`}>
            <div className="history-diff-row-heading">
              <strong>{blockTitle(change)}</strong>
              {change.moved ? (
                <span className="history-diff-moved">
                  Строка: {change.before_order ?? "—"} → {change.after_order ?? "—"}
                </span>
              ) : null}
            </div>
            {change.fields.map((field) => (
              <SemanticField key={field.key} change={change} field={field} />
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
