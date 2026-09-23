import type { ReactNode } from "react";
import type { WorkflowMark, WorkflowReadModel } from "../types";

export type WorkflowStage = "review" | "editorial" | "proofread";
interface Props {
  workflow: WorkflowReadModel;
  actions?: Partial<Record<WorkflowStage, ReactNode>>;
  error?: ReactNode;
}

function markText(mark: WorkflowMark | null): string {
  if (!mark) return "Не отмечено";
  const at = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(mark.at));
  return `${mark.actor.display_name.trim() || mark.actor.username}, ${at}`;
}

export default function WorkflowSummary({ workflow, actions, error }: Props) {
  return (
    <section className="workflow-summary" aria-label="Редакционная проверка и корректура">
      <dl>
        <div>
          <dt>Запрос проверки</dt>
          <dd>{markText(workflow.review_request)}</dd>
          {actions?.review ? <dd className="workflow-stage-actions">{actions.review}</dd> : null}
        </div>
        <div>
          <dt>Редакционная готовность</dt>
          <dd>{markText(workflow.editorial_check)}</dd>
          {actions?.editorial ? <dd className="workflow-stage-actions">{actions.editorial}</dd> : null}
        </div>
        <div>
          <dt>Корректура</dt>
          <dd>{workflow.proofread ? <><span className="workflow-mark-complete">Вычитано</span><span className="workflow-mark-detail">{markText(workflow.proofread)}</span></> : "Не отмечено"}</dd>
          {workflow.reproofread_request ? <dd className="workflow-reproofread">Повторная вычитка: {markText(workflow.reproofread_request)}</dd> : null}
          {workflow.changed_after_proofread ? <dd className="workflow-changed-warning">Изменён после вычитки</dd> : null}
          {actions?.proofread ? <dd className="workflow-stage-actions">{actions.proofread}</dd> : null}
        </div>
      </dl>
      {error}
    </section>
  );
}
