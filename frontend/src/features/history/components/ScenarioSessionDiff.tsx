import type { ScenarioRowDiff, ScenarioSessionDiffResponse } from "../types";

const kindLabels: Record<ScenarioRowDiff["kind"], string> = {
  added: "Добавлен блок",
  removed: "Удалён блок",
  changed: "Изменён блок",
  moved: "Перемещён блок",
};

const fieldLabels: Record<string, string> = {
  block_type: "Тип блока",
  text: "Текст",
  speaker_text: "Спикер",
  file_name: "Имя файла",
  tc_in: "TC IN",
  tc_out: "TC OUT",
  additional_comment: "Комментарий",
  structured_data: "Структурированные данные",
  formatting: "Форматирование",
  rich_text: "Расширенный текст",
};

function blockTitle(change: ScenarioRowDiff): string {
  const snapshot = change.after ?? change.before;
  const position = snapshot?.order_index ? ` · строка ${snapshot.order_index}` : "";
  return `${kindLabels[change.kind]}${position}`;
}

function formatSnapshotValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function SnapshotValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="history-diff-text">
      <span>{label}</span>
      <p>{formatSnapshotValue(value)}</p>
    </div>
  );
}

function ChangedField({ change, field }: { change: ScenarioRowDiff; field: string }) {
  return (
    <section className="history-diff-field" aria-label={fieldLabels[field] ?? field}>
      <strong>{fieldLabels[field] ?? field}</strong>
      <div className="history-diff-columns">
        <SnapshotValue label="Было" value={change.before?.[field]} />
        <SnapshotValue label="Стало" value={change.after?.[field]} />
      </div>
    </section>
  );
}

export default function ScenarioSessionDiff({ diff }: { diff: ScenarioSessionDiffResponse }) {
  if (diff.changes.length === 0) {
    return <p className="muted history-diff-empty">Содержательных изменений нет.</p>;
  }

  return (
    <section className="history-diff" aria-label={`Изменения редакций ${diff.session.from_revision}–${diff.session.to_revision}`}>
      <h4>Изменения сценария</h4>
      <ol className="history-diff-list">
        {diff.changes.map((change) => (
          <li key={change.segment_uid} className={`history-diff-row history-diff-row-${change.kind}`}>
            <div className="history-diff-row-heading">
              <strong>{blockTitle(change)}</strong>
              {change.moved ? (
                <span className="history-diff-moved">
                  Порядок: {change.before?.order_index ?? "—"} → {change.after?.order_index ?? "—"}
                </span>
              ) : null}
            </div>
            {change.changed_fields.map((field) => <ChangedField key={field} change={change} field={field} />)}
            {change.changed_fields.length === 0 && !change.moved ? (
              <div className="history-diff-columns">
                <SnapshotValue label="Было" value={change.before?.text} />
                <SnapshotValue label="Стало" value={change.after?.text} />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
