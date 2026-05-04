import { getProjectStateBadges } from "../../features/projects/projectPresentation";
import { formatDateTime } from "../../shared/date";
import { projectStatusLabel } from "../../shared/labels";
import type { ProjectListItem } from "../../shared/types";
import StatusBadge from "../StatusBadge";

interface ProjectCardHeaderProps {
  project: ProjectListItem;
  onBack: () => void;
}

export default function ProjectCardHeader({
  project,
  onBack,
}: ProjectCardHeaderProps) {
  return (
    <>
      <button
        type="button"
        className="text-button project-card-back"
        onClick={onBack}
      >
        ← К списку сюжетов
      </button>
      <section className="project-card-header">
        <div className="project-card-heading">
          <div>
            <p className="muted small">
              карточка сюжета · {project.rubric || "без рубрики"}
            </p>
            <h2>{project.title}</h2>
            <p className="muted small">
              Статус: {projectStatusLabel(project.status)} · обновлено{" "}
              {formatDateTime(project.status_changed_at || project.created_at)}
            </p>
          </div>
        </div>
        <div className="project-card-status-strip">
          {getProjectStateBadges(project)
            .slice(0, 5)
            .map((badge) => (
              <StatusBadge key={badge.label} tone={badge.tone}>
                {badge.label}
              </StatusBadge>
            ))}
        </div>
      </section>
    </>
  );
}
