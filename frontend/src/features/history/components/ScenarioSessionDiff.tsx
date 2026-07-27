import type { CSSProperties } from "react";

import {
  FILL_COLOR_OPTIONS,
  FONT_OPTIONS,
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

const allowedFonts = new Set<string>(FONT_OPTIONS);
const allowedFillColors = new Set<string>(
  FILL_COLOR_OPTIONS.map((option) => option.value),
);

function valueStyle(value: SemanticValue | null): CSSProperties {
  const formatting = value?.formatting;
  return {
    fontFamily: formatting?.font_family
      && allowedFonts.has(formatting.font_family)
      ? formatting.font_family
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

function SemanticValueText({
  label,
  side,
  value,
}: {
  label: string;
  side: "before" | "after";
  value: SemanticValue | null;
}) {
  return (
    <div className="history-diff-text">
      <span>{label}</span>
      <p data-side={side} style={valueStyle(value)}>
        {value?.text || "—"}
      </p>
    </div>
  );
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

  return (
    <section className="history-diff-field" aria-label={field.label}>
      <strong>{field.label}</strong>
      {singleSide ? (
        <SemanticValueText {...singleSide} />
      ) : (
        <div className="history-diff-columns">
          <SemanticValueText label="Было" side="before" value={field.before} />
          <SemanticValueText label="Стало" side="after" value={field.after} />
        </div>
      )}
    </section>
  );
}

export default function ScenarioSessionDiff({ diff }: { diff: ScenarioSessionDiffResponse }) {
  const changes = buildSemanticScenarioDiff(diff.changes);

  if (changes.length === 0) {
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
