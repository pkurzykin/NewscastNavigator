import { useEffect, useState } from "react";

import {
  projectFocusReasons,
  projectMainBlocker,
  projectOpenActionCount,
  projectQueuePriorityState,
  projectRegistryDateLabel,
  projectRegistryStage,
  projectTeamSummary,
  projectTrackSummary,
  textStateLabel,
  textStateTone,
  trackTone,
} from "../features/projects/projectPresentation";
import type { ProjectListItem, ProjectsView } from "../shared/types";

const NARROW_REGISTRY_QUERY = "(max-width: 900px)";

interface ProjectWorkQueueProps {
  items: ProjectListItem[];
  view: ProjectsView;
  selectedProjectId: number | null;
  onSelectProject: (projectId: number) => void;
  onOpenProject: (projectId: number) => void;
  activeFocusTitle?: string | null;
  focusReasonsByProjectId?: Record<number, string[]>;
}

export default function ProjectWorkQueue({
  items,
  view,
  selectedProjectId,
  onSelectProject,
  onOpenProject,
  activeFocusTitle,
  focusReasonsByProjectId,
}: ProjectWorkQueueProps) {
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(NARROW_REGISTRY_QUERY).matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(NARROW_REGISTRY_QUERY);
    const updateViewportMode = () => setIsNarrowViewport(mediaQuery.matches);
    updateViewportMode();
    mediaQuery.addEventListener("change", updateViewportMode);
    return () => mediaQuery.removeEventListener("change", updateViewportMode);
  }, []);

  function handleRowActivate(projectId: number): void {
    if (isNarrowViewport) {
      onOpenProject(projectId);
      return;
    }
    onSelectProject(projectId);
  }

  return (
    <section className="work-queue-panel" aria-label={view === "archive" ? "Архив сюжетов" : "Реестр сюжетов"}>
      <div className="work-queue-head">
        <div>
          <h3>{view === "archive" ? "Архив сюжетов" : "Реестр сюжетов"}</h3>
          <p className="muted">
            {view === "archive"
              ? "Архивные карточки доступны для просмотра и восстановления."
              : "Все активные карточки newsroom-процесса с главным блокером и ответственными."}
          </p>
        </div>
        <p className="muted">
          Показано: <strong>{items.length}</strong>
        </p>
      </div>

      <div className="work-queue-table-wrap">
        <table className="work-queue-table">
          <thead>
            <tr>
              <th>Сюжет</th>
              <th>Стадия</th>
              <th>Главный блокер</th>
              <th>Ответственные</th>
              <th>Треки</th>
              <th>Выпуск / дата</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {items.map((project) => {
              const reasons = projectFocusReasons(project, focusReasonsByProjectId);
              const selected = selectedProjectId === project.id;
              const openActions = projectOpenActionCount(project);
              const priority = projectQueuePriorityState(project, reasons, openActions);
              const blocker = projectMainBlocker(project, reasons);
              const tracks = projectTrackSummary(project);

              return (
                <tr
                  key={project.id}
                  className={selected ? "selected-row" : undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={`Сюжет ${project.title}. ${isNarrowViewport ? "Открыть карточку" : "Выбрать для предпросмотра"}`}
                  aria-selected={selected}
                  onClick={() => handleRowActivate(project.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleRowActivate(project.id);
                    }
                  }}
                >
                  <td>
                    <div className="work-queue-title-cell">
                      <span className="work-queue-title-row">
                        <span className="work-queue-id">#{project.id}</span>
                        <span className={`work-priority work-priority-${priority.tone}`}>
                          {priority.label}
                        </span>
                      </span>
                      <strong>{project.title}</strong>
                      <span className="muted small">
                        {project.rubric || "Без рубрики"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-state-cell">
                      <strong>{projectRegistryStage(project)}</strong>
                      <span className={`work-chip work-chip-${textStateTone(project)}`}>
                        {textStateLabel(project)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-chip-list">
                      <span className={`work-chip work-chip-${priority.tone === "warn" ? "warn" : "muted"}`}>
                        {blocker}
                      </span>
                      {activeFocusTitle && reasons.length > 1
                        ? reasons.slice(1, 3).map((reason) => (
                            <span key={`${project.id}-${reason}`} className="work-chip work-chip-muted">
                              {reason}
                            </span>
                          ))
                        : null}
                      {openActions > 0 ? (
                        <span className="work-chip work-chip-warn">Правки: {openActions}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-team">
                      {projectTeamSummary(project).map((item) => (
                        <span key={`${project.id}-${item}`}>{item}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-chip-list">
                      <span className={`work-chip work-chip-${trackTone(project.edit_requires_resync)}`}>
                        {tracks[0]}
                      </span>
                      <span className={`work-chip work-chip-${trackTone(project.titles_requires_resync)}`}>
                        {tracks[1]}
                      </span>
                      <span className={`work-chip work-chip-${trackTone(project.voiceover_requires_resync)}`}>
                        {tracks[2]}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-activity">
                      <strong>{projectRegistryDateLabel(project, view === "archive")}</strong>
                      <span className="muted small">
                        {view === "archive"
                          ? `Архивировал: ${project.archived_by_username || "-"}`
                          : project.story_date
                            ? "Дата материала"
                            : "Последняя активность"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-actions">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenProject(project.id);
                        }}
                      >
                        Открыть карточку
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted center">
                  Сюжеты не найдены
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
