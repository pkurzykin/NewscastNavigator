import type { ProjectListItem, ProjectsView } from "../shared/types";

interface ProjectsTableProps {
  items: ProjectListItem[];
  view: ProjectsView;
  selectedProjectId: number | null;
  onSelectProject: (projectId: number) => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  reviewed: "На проверке",
  in_editing: "В работе",
  in_proofreading: "На корректуре",
  ready: "Готово",
  delivered: "Сдано",
  archived: "Архив"
};

function formatDate(isoValue?: string | null): string {
  if (!isoValue) {
    return "-";
  }
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return isoValue;
  }
  return parsed.toLocaleString("ru-RU");
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status || "-";
}

export default function ProjectsTable({
  items,
  view,
  selectedProjectId,
  onSelectProject
}: ProjectsTableProps) {
  const emptyColSpan = view === "archive" ? 11 : 11;

  return (
    <div className="card">
      <h3>
        Список проектов{" "}
        <span className="muted small">
          (клик по строке выбирает проект для действий)
        </span>
      </h3>
      <div className="table-wrap">
        <table className="projects-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Название</th>
              <th>Статус</th>
              <th>Рубрика</th>
              <th>Хрон.</th>
              <th>Автор</th>
              <th>Исполнитель</th>
              <th>Корректор</th>
              <th>Создан</th>
              <th>{view === "archive" ? "Архивирован" : "Статус изменен"}</th>
              <th>{view === "archive" ? "Кто архивировал" : "Источник"}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr
                key={row.id}
                className={selectedProjectId === row.id ? "selected-row" : ""}
                onClick={() => onSelectProject(row.id)}
              >
                <td>{row.id}</td>
                <td>{row.title}</td>
                <td>{statusLabel(row.status)}</td>
                <td>{row.rubric || "-"}</td>
                <td>{row.planned_duration || "-"}</td>
                <td>{row.author_username || "-"}</td>
                <td>{row.executor_username || "-"}</td>
                <td>{row.proofreader_username || "-"}</td>
                <td>{formatDate(row.created_at)}</td>
                <td>
                  {view === "archive"
                    ? formatDate(row.archived_at)
                    : formatDate(row.status_changed_at)}
                </td>
                <td>
                  {view === "archive"
                    ? row.archived_by_username || "-"
                    : row.source_project_id
                      ? `#${row.source_project_id}`
                      : "-"}
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={emptyColSpan} className="muted center">
                  Проекты не найдены
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
