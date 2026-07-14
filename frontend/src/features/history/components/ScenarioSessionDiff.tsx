import type { ScenarioRowDiff, ScenarioSessionDiffResponse } from "../types";

const kindLabels: Record<ScenarioRowDiff["kind"], string> = {
  added: "Добавлен блок",
  removed: "Удалён блок",
  changed: "Изменён блок",
  moved: "Перемещён блок",
};

function blockTitle(change: ScenarioRowDiff): string {
  const snapshot = change.after ?? change.before;
  const position = snapshot?.order_index ? ` · строка ${snapshot.order_index}` : "";
  return `${kindLabels[change.kind]}${position}`;
}

function SnapshotText({ label, text }: { label: string; text: unknown }) {
  if (typeof text !== "string" || !text.trim()) return null;
  return (
    <div className="history-diff-text">
      <span>{label}</span>
      <p>{text}</p>
    </div>
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
              {change.moved && change.kind !== "moved" ? <span className="history-diff-moved">Позиция изменена</span> : null}
            </div>
            <div className="history-diff-columns">
              <SnapshotText label="Было" text={change.before?.text} />
              <SnapshotText label="Стало" text={change.after?.text} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
