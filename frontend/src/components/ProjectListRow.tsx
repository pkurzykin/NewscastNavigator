import { useState } from "react";

import { getProjectPriority } from "../features/projects/projectPriority";
import { getProjectRowPresentation } from "../features/projects/projectPresentation";
import type { ProjectListItem, UserPublic } from "../shared/types";
import PriorityBadge from "./PriorityBadge";
import StatusBadge from "./StatusBadge";

interface ProjectListRowProps {
  project: ProjectListItem;
  user: UserPublic;
  selected: boolean;
  onOpenProject: (projectId: number) => void;
  onSelectProject: (projectId: number) => void;
}

export default function ProjectListRow({
  project,
  user,
  selected,
  onOpenProject,
  onSelectProject,
}: ProjectListRowProps) {
  const [expanded, setExpanded] = useState(false);
  const presentation = getProjectRowPresentation(project, user);
  const priority = getProjectPriority(project, user);

  return (
    <>
      <tr
        className={selected ? "selected-row" : undefined}
        onClick={() => onSelectProject(project.id)}
      >
        <td>
          <strong className="project-list-title">{project.title}</strong>
          <span className="project-list-meta">{project.rubric || "Без рубрики"}</span>
        </td>
        <td>
          <strong>{presentation.reasonTitle}</strong>
          <span className="project-list-meta">{presentation.reasonDetail}</span>
        </td>
        <td>{presentation.nextAction}</td>
        <td>
          <div className="project-list-badges">
            {presentation.stateBadges.map((badge) => (
              <StatusBadge key={badge.label} tone={badge.tone}>
                {badge.label}
              </StatusBadge>
            ))}
          </div>
        </td>
        <td>
          <PriorityBadge
            level={priority.level}
            label={priority.label}
            reason={priority.reason}
          />
        </td>
        <td>
          <div className="project-list-actions">
            <button
              type="button"
              className="text-button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenProject(project.id);
              }}
            >
              Открыть
            </button>
            <button
              type="button"
              className="text-button"
              onClick={(event) => {
                event.stopPropagation();
                onSelectProject(project.id);
              }}
            >
              Выбрать
            </button>
            {presentation.tasks.length > 0 ? (
              <button
                type="button"
                className="text-button"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded((value) => !value);
                }}
              >
                {expanded ? "Свернуть" : "Развернуть"}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="project-list-expanded-row">
          <td colSpan={6}>
            <div className="project-list-task-grid">
              {presentation.tasks.map((task) => (
                <div
                  key={`${task.title}-${task.detail}`}
                  className={`project-list-task project-list-task-${task.tone}`}
                >
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
