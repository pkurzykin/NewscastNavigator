import type { WorkflowMark, WorkflowReadModel } from "../types";


interface Props { workflow: WorkflowReadModel; }

function markText(mark: WorkflowMark | null): string {
  if (!mark) return "Не отмечено";
  const at = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(mark.at));
  return `${mark.actor.display_name}, редакция ${mark.revision}, ${at}`;
}

export default function WorkflowSummary({ workflow }: Props) {
  return (
    <section className="workflow-summary" aria-label="Редакционная проверка и корректура">
      <h3>Редакционная проверка и корректура</h3>
      <dl>
        <div><dt>Запрос проверки</dt><dd>{markText(workflow.review_request)}</dd></div>
        <div><dt>Редакционная готовность</dt><dd>{markText(workflow.editorial_check)}</dd></div>
        <div><dt>Корректура</dt><dd>{markText(workflow.proofread)}</dd></div>
        {workflow.reproofread_request ? (
          <div><dt>Повторная вычитка</dt><dd>{markText(workflow.reproofread_request)}</dd></div>
        ) : null}
      </dl>
      {workflow.changed_after_proofread ? (
        <p className="workflow-changed-warning">Изменён после вычитки</p>
      ) : null}
    </section>
  );
}
