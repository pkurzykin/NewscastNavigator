import { getProjectPriority } from "../features/projects/projectPriority";
import type { ProjectListItem, UserPublic } from "../shared/types";

interface ProjectSummaryStripProps {
  projects: ProjectListItem[];
  user: UserPublic;
}

export default function ProjectSummaryStrip({
  projects,
  user,
}: ProjectSummaryStripProps) {
  const assignedToMe = projects.filter((project) => {
    return (
      project.author_user_id === user.id ||
      project.proofreader_user_id === user.id ||
      project.edit_assignee_user_id === user.id ||
      project.titles_assignee_user_id === user.id ||
      (project.my_open_action_comment_count || 0) > 0
    );
  }).length;
  const priorities = projects.map((project) => getProjectPriority(project, user));
  const urgentCount = priorities.filter((priority) => priority.level === "urgent").length;
  const highCount = priorities.filter((priority) => priority.level === "high").length;
  const openActions = projects.reduce(
    (sum, project) => sum + (project.open_action_comment_count || 0),
    0
  );

  return (
    <div className="project-summary-strip" aria-label="Сводка рабочей очереди">
      <span>
        <strong>{assignedToMe}</strong> назначено мне
      </span>
      <span>
        <strong>{urgentCount}</strong> срочно
      </span>
      <span>
        <strong>{highCount}</strong> высокий приоритет
      </span>
      <span>
        <strong>{openActions}</strong> открытых правок
      </span>
    </div>
  );
}
