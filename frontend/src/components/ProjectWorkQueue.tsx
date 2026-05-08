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

const STATUS_LABELS: Record<string, string> = {
  archived: "Архив",
  delivered: "Сдано",
  draft: "Черновик",
  in_editing: "В работе",
  in_proofreading: "На корректуре",
  ready: "Готово",
  reviewed: "На проверке",
};

const TRACK_LABELS: Record<string, string> = {
  changes_requested: "Нужны правки",
  done: "Готово",
  in_progress: "В работе",
  not_started: "Не начато",
  review: "На проверке",
};

function formatDateTime(isoValue?: string | null): string {
  if (!isoValue) {
    return "-";
  }
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return isoValue;
  }
  return parsed.toLocaleString("ru-RU");
}

function formatTextSeq(value?: number | null): string {
  if (!value || value < 1) {
    return "-";
  }
  return `#${value}`;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status || "-";
}

function trackLabel(status?: string | null): string {
  return TRACK_LABELS[status || "not_started"] || status || "Не начато";
}

function textStateTone(project: ProjectListItem): "ok" | "warn" | "muted" {
  if (!project.current_text_seq) {
    return "muted";
  }
  if (!project.current_text_is_latest || !project.latest_text_is_proofread) {
    return "warn";
  }
  return "ok";
}

function textStateLabel(project: ProjectListItem): string {
  if (!project.current_text_seq) {
    return "Нет current";
  }
  if (!project.current_text_is_latest) {
    return "Current устарел";
  }
  if (!project.latest_text_is_proofread) {
    return "Нужна вычитка";
  }
  return "Текст готов";
}

function trackTone(isResyncRequired?: boolean): "ok" | "warn" | "muted" {
  return isResyncRequired ? "warn" : "muted";
}

function actionCount(project: ProjectListItem): number {
  return project.open_action_comment_count || 0;
}

function focusReasons(project: ProjectListItem, focusReasonsByProjectId?: Record<number, string[]>): string[] {
  return focusReasonsByProjectId?.[project.id] || [];
}

function priorityState(
  project: ProjectListItem,
  reasons: string[],
  openActions: number
): { label: string; tone: "ok" | "warn" | "muted" } {
  const assignedActions =
    (project.my_open_action_comment_count || 0) + (project.my_in_progress_action_comment_count || 0);

  if (
    assignedActions > 0 ||
    openActions > 0 ||
    project.titles_requires_resync ||
    project.edit_requires_resync ||
    project.voiceover_requires_resync ||
    (!!project.current_text_seq && !project.current_text_is_latest)
  ) {
    return { label: "Срочно", tone: "warn" };
  }

  if (!project.current_text_seq || !project.latest_text_is_proofread || reasons.length > 0) {
    return { label: "В работе", tone: "muted" };
  }

  return { label: "Стабильно", tone: "ok" };
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
    <section className="work-queue-panel" aria-label="Рабочая очередь сюжетов">
      <div className="work-queue-head">
        <div>
          <h3>{view === "archive" ? "Архив сюжетов" : "Очередь сюжетов"}</h3>
          <p className="muted">
            {view === "archive"
              ? "Архивные карточки доступны для просмотра и восстановления."
              : "Один список для выбора сюжета, открытия редактора и контроля handoff-сигналов."}
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
              <th>Текст</th>
              <th>Производство</th>
              <th>Участники</th>
              <th>{view === "archive" ? "Архив" : "Даты"}</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {items.map((project) => {
              const reasons = focusReasons(project, focusReasonsByProjectId);
              const selected = selectedProjectId === project.id;
              const openActions = actionCount(project);
              const priority = priorityState(project, reasons, openActions);

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
                        {project.rubric || "Без рубрики"} · {statusLabel(project.status)}
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
                      <span className="muted small">
                        workspace {formatTextSeq(project.text_seq)} · current {formatTextSeq(project.current_text_seq)}
                      </span>
                      <span className="muted small">
                        вычитка {formatTextSeq(project.proofread_text_seq)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-chip-list">
                      <span className={`work-chip work-chip-${trackTone(project.edit_requires_resync)}`}>
                        Монтаж: {project.edit_requires_resync ? "ресинк" : trackLabel(project.edit_status)}
                      </span>
                      <span className={`work-chip work-chip-${trackTone(project.titles_requires_resync)}`}>
                        Титры: {project.titles_requires_resync ? "ресинк" : trackLabel(project.titles_status)}
                      </span>
                      <span className={`work-chip work-chip-${trackTone(project.voiceover_requires_resync)}`}>
                        Озвучка: {project.voiceover_requires_resync ? "ресинк" : trackLabel(project.voiceover_status)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-people">
                      <span>Автор: {project.author_username || "-"}</span>
                      <span>Исполнитель: {project.executor_username || "-"}</span>
                      <span>Корректор: {project.proofreader_username || "-"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="work-queue-people">
                      <span>Создан: {formatDateTime(project.created_at)}</span>
                      <span>
                        {view === "archive" ? "Архивирован" : "Статус"}:{" "}
                        {formatDateTime(view === "archive" ? project.archived_at : project.status_changed_at)}
                      </span>
                      {view === "archive" ? <span>Кем: {project.archived_by_username || "-"}</span> : null}
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
                        Открыть
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
