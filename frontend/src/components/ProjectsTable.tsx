import type { ProjectListItem, ProjectsView } from "../shared/types";

interface ProjectsTableProps {
  items: ProjectListItem[];
  view: ProjectsView;
  selectedProjectId: number | null;
  onSelectProject: (projectId: number) => void;
  activeFocusTitle?: string | null;
  focusReasonsByProjectId?: Record<number, string[]>;
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

function formatTextSeq(value?: number | null): string {
  if (!value || value < 1) {
    return "-";
  }
  return `#${value}`;
}

function projectTextStateBadges(item: ProjectListItem): Array<{ tone: "fresh" | "warn" | "muted"; label: string }> {
  const badges: Array<{ tone: "fresh" | "warn" | "muted"; label: string }> = [];
  if (!item.current_text_seq) {
    badges.push({ tone: "muted", label: "Нет current" });
  } else if (!item.current_text_is_latest) {
    badges.push({ tone: "warn", label: "Есть новые правки" });
  } else {
    badges.push({ tone: "fresh", label: "Current актуален" });
  }

  if (!item.proofread_text_seq) {
    badges.push({ tone: "muted", label: "Не вычитано" });
  } else if (!item.latest_text_is_proofread) {
    badges.push({ tone: "warn", label: "Корректура устарела" });
  } else {
    badges.push({ tone: "fresh", label: "Вычитано" });
  }

  if ((item.titles_status || "not_started") === "not_started") {
    badges.push({ tone: "muted", label: "Титры не начаты" });
  } else if (item.titles_requires_resync) {
    badges.push({ tone: "warn", label: "Титры на старом тексте" });
  } else {
    badges.push({ tone: "fresh", label: "Титры синхронизированы" });
  }

  if ((item.edit_status || "not_started") === "not_started") {
    badges.push({ tone: "muted", label: "Монтаж не начат" });
  } else if (item.edit_requires_resync) {
    badges.push({ tone: "warn", label: "Монтаж на старом handoff" });
  } else {
    badges.push({ tone: "fresh", label: "Монтаж синхронизирован" });
  }

  if ((item.voiceover_status || "not_started") === "not_started") {
    badges.push({ tone: "muted", label: "Озвучка не начата" });
  } else if (item.voiceover_requires_resync) {
    badges.push({ tone: "warn", label: "Озвучка на старом тексте" });
  } else {
    badges.push({ tone: "fresh", label: "Озвучка синхронизирована" });
  }

  if ((item.final_review_status || "not_started") === "approved") {
    badges.push({ tone: "fresh", label: "Сверху утверждено" });
  } else if ((item.final_review_status || "not_started") === "changes_requested") {
    badges.push({ tone: "warn", label: "Сверху есть правки" });
  } else if ((item.final_review_status || "not_started") === "submitted") {
    badges.push({ tone: "fresh", label: "Ушло на внешнюю сдачу" });
  } else {
    badges.push({ tone: "muted", label: "Наверх еще не отправлялось" });
  }

  if ((item.open_action_comment_count || 0) > 0) {
    badges.push({
      tone: "warn",
      label: `Открытых правок: ${item.open_action_comment_count || 0}`,
    });
  }

  return badges;
}

function projectActionTargetBadges(item: ProjectListItem): string[] {
  const badges: string[] = [];
  if ((item.open_text_action_comment_count || 0) > 0) {
    badges.push(`Текст ${item.open_text_action_comment_count || 0}`);
  }
  if ((item.open_edit_action_comment_count || 0) > 0) {
    badges.push(`Монтаж ${item.open_edit_action_comment_count || 0}`);
  }
  if ((item.open_titles_action_comment_count || 0) > 0) {
    badges.push(`Титры ${item.open_titles_action_comment_count || 0}`);
  }
  if ((item.open_voiceover_action_comment_count || 0) > 0) {
    badges.push(`Озвучка ${item.open_voiceover_action_comment_count || 0}`);
  }
  if (badges.length === 0 && (item.open_action_comment_count || 0) > 0) {
    badges.push(`Правки ${item.open_action_comment_count || 0}`);
  }
  return badges;
}

export default function ProjectsTable({
  items,
  view,
  selectedProjectId,
  onSelectProject,
  activeFocusTitle,
  focusReasonsByProjectId
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
                <td>
                  <div className="project-title-cell">
                    <div>{row.title}</div>
                    <div className="project-text-state-meta muted small">
                      Текст {formatTextSeq(row.text_seq)} · current {formatTextSeq(row.current_text_seq)} ·
                      озвучка {formatTextSeq(row.voiceover_text_seq)} · монтаж {formatTextSeq(row.edit_text_seq)} ·
                      корректура {formatTextSeq(row.proofread_text_seq)} · титры {formatTextSeq(row.titles_text_seq)}
                    </div>
                    <div className="project-text-state-badges">
                      {projectTextStateBadges(row).map((badge) => (
                        <span
                          key={`${row.id}-${badge.label}`}
                          className={`project-text-state-badge project-text-state-badge-${badge.tone}`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                    {projectActionTargetBadges(row).length > 0 ? (
                      <div className="project-action-target-badges">
                        <span className="project-focus-prefix">Action:</span>
                        {projectActionTargetBadges(row).map((badge) => (
                          <span key={`${row.id}-action-${badge}`} className="project-action-target-badge">
                            {badge}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {(focusReasonsByProjectId?.[row.id] || []).length > 0 ? (
                      <div className="project-focus-badges">
                        <span className="project-focus-prefix">
                          {activeFocusTitle || "Фокус"}:
                        </span>
                        {(focusReasonsByProjectId?.[row.id] || []).map((reason) => (
                          <span
                            key={`${row.id}-focus-${reason}`}
                            className="project-focus-badge"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </td>
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
