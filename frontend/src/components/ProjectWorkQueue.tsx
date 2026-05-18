import {
  currentTextSeqTone,
  projectFocusReasons,
  projectOpenActionCount,
  projectQueuePriorityState,
  proofreadTextSeqTone,
  textStateLabel,
  textStateTone,
  trackTone,
} from "../features/projects/projectPresentation";
import { formatDateTime, formatTextSeq } from "../shared/date";
import { projectStatusLabel, trackStatusLabel } from "../shared/labels";
import type { ProjectListItem, ProjectsView } from "../shared/types";

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
  return (
    <section className="work-queue-panel" aria-label="Список сюжетов">
      <div className="work-queue-head">
        <div>
          <h3>{view === "archive" ? "Архив сюжетов" : "Список сюжетов"}</h3>
          <p className="muted">
            {view === "archive"
              ? "Архивные карточки доступны для просмотра и восстановления."
              : "Общий реестр для выбора сюжета, открытия карточки и контроля передачи текста."}
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
              <th>{activeFocusTitle || "Фокус"}</th>
              <th>Состояние текста</th>
              <th>Производство</th>
              <th>Команда</th>
              <th>{view === "archive" ? "Архив" : "Активность"}</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {items.map((project) => {
              const reasons = projectFocusReasons(project, focusReasonsByProjectId);
              const selected = selectedProjectId === project.id;
              const openActions = projectOpenActionCount(project);
              const priority = projectQueuePriorityState(project, reasons, openActions);

              return (
                <tr key={project.id} className={selected ? "selected-row" : undefined}>
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
                        {project.rubric || "Без рубрики"} · {projectStatusLabel(project.status)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-chip-list">
                      {reasons.length > 0 ? (
                        reasons.slice(0, 3).map((reason) => (
                          <span key={`${project.id}-${reason}`} className="work-chip work-chip-warn">
                            {reason}
                          </span>
                        ))
                      ) : (
                        <span className="work-chip work-chip-muted">Нет срочного сигнала</span>
                      )}
                      {openActions > 0 ? (
                        <span className="work-chip work-chip-warn">Правки: {openActions}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-state-cell">
                      <span className={`work-chip work-chip-${textStateTone(project)}`}>
                        {textStateLabel(project)}
                      </span>
                      <div className="text-handoff-grid" aria-label="Состояние текста">
                        <span>
                          <small>Рабочий текст</small>
                          <strong>{formatTextSeq(project.text_seq)}</strong>
                        </span>
                        <span className={`text-handoff-step text-handoff-step-${currentTextSeqTone(project)}`}>
                          <small>Текущий текст</small>
                          <strong>{formatTextSeq(project.current_text_seq)}</strong>
                        </span>
                        <span className={`text-handoff-step text-handoff-step-${proofreadTextSeqTone(project)}`}>
                          <small>Вычитано</small>
                          <strong>{formatTextSeq(project.proofread_text_seq)}</strong>
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-chip-list">
                      <span className={`work-chip work-chip-${trackTone(project.edit_requires_resync)}`}>
                        Монтаж: {project.edit_requires_resync ? "ресинк" : trackStatusLabel(project.edit_status)}
                      </span>
                      <span className={`work-chip work-chip-${trackTone(project.titles_requires_resync)}`}>
                        Титры: {project.titles_requires_resync ? "ресинк" : trackStatusLabel(project.titles_status)}
                      </span>
                      <span className={`work-chip work-chip-${trackTone(project.voiceover_requires_resync)}`}>
                        Озвучка: {project.voiceover_requires_resync ? "ресинк" : trackStatusLabel(project.voiceover_status)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-team">
                      <span>
                        <small>Автор</small>
                        {project.author_username || "-"}
                      </span>
                      <span>
                        <small>Исполнитель</small>
                        {project.executor_username || "-"}
                      </span>
                      <span>
                        <small>Корректор</small>
                        {project.proofreader_username || "-"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-activity">
                      <strong>
                        {formatDateTime(view === "archive" ? project.archived_at : project.status_changed_at)}
                      </strong>
                      <span className="muted small">
                        {view === "archive"
                          ? `Архивировал: ${project.archived_by_username || "-"}`
                          : `Создан: ${formatDateTime(project.created_at)}`}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => onSelectProject(project.id)}
                      >
                        Выбрать
                      </button>
                      <button type="button" onClick={() => onOpenProject(project.id)}>
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
