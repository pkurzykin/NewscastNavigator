import { getProjectPriority } from "../../features/projects/projectPriority";
import { trackStatusLabel } from "../../shared/labels";
import type { ProjectListItem, UserPublic } from "../../shared/types";

interface ProjectOverviewTabProps {
  project: ProjectListItem;
  user: UserPublic;
  onOpenText: () => void;
}

export default function ProjectOverviewTab({
  project,
  user,
  onOpenText,
}: ProjectOverviewTabProps) {
  const priority = getProjectPriority(project, user);

  return (
    <section className="project-overview-grid">
      <article className="card project-next-action">
        <h3>Следующее действие</h3>
        <p>
          {priority.level === "urgent" || priority.level === "high"
            ? priority.reason
            : "Открыть карточку и продолжить штатный этап."}
        </p>
        <button type="button" onClick={onOpenText}>
          Открыть текст
        </button>
      </article>

      <article className="card">
        <h3>Этапы производства</h3>
        <div className="project-stage-grid">
          <span>
            Текст:{" "}
            {project.current_text_seq ? "текущий текст есть" : "нет текущего текста"}
          </span>
          <span>
            Вычитка:{" "}
            {project.latest_text_is_proofread ? "актуальна" : "требует проверки"}
          </span>
          <span>Озвучка: {trackStatusLabel(project.voiceover_status)}</span>
          <span>Монтаж: {trackStatusLabel(project.edit_status)}</span>
          <span>
            Титры:{" "}
            {project.titles_requires_resync
              ? "требуют проверки"
              : trackStatusLabel(project.titles_status)}
          </span>
        </div>
      </article>

      <article className="card">
        <h3>Основные данные</h3>
        <p>Рубрика: {project.rubric || "не указана"}</p>
        <p>Плановый хронометраж: {project.planned_duration || "не указан"}</p>
        <p>
          Приоритет: {priority.label} · {priority.reason}
        </p>
      </article>
    </section>
  );
}
