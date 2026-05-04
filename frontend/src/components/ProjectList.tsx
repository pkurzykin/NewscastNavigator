import { getProjectPriority } from "../features/projects/projectPriority";
import type { ProjectListItem, UserPublic } from "../shared/types";
import ProjectListRow from "./ProjectListRow";

interface ProjectListProps {
  projects: ProjectListItem[];
  user: UserPublic;
  selectedProjectId: number | null;
  onOpenProject: (projectId: number) => void;
  onSelectProject: (projectId: number) => void;
}

export default function ProjectList({
  projects,
  user,
  selectedProjectId,
  onOpenProject,
  onSelectProject,
}: ProjectListProps) {
  const sortedProjects = [...projects].sort((left, right) => {
    const priorityDelta =
      getProjectPriority(right, user).sortWeight -
      getProjectPriority(left, user).sortWeight;

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return right.id - left.id;
  });

  return (
    <div className="project-list-panel">
      <table className="project-list-table">
        <thead>
          <tr>
            <th>Сюжет</th>
            <th>Почему здесь</th>
            <th>Что сделать</th>
            <th>Состояние</th>
            <th>Приоритет</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          {sortedProjects.map((project) => (
            <ProjectListRow
              key={project.id}
              project={project}
              user={user}
              selected={project.id === selectedProjectId}
              onOpenProject={onOpenProject}
              onSelectProject={onSelectProject}
            />
          ))}
          {sortedProjects.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted center">
                Сюжеты не найдены
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
