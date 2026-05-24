import { useCallback, useEffect, useState } from "react";

import ProjectWorkQueue from "../components/ProjectWorkQueue";
import {
  projectMainBlocker,
  projectQueuePriorityState,
  projectRegistryDateLabel,
  projectTeamSummary,
  projectTrackSummary,
} from "../features/projects/projectPresentation";
import { sortProjectQueueItems } from "../features/projects/projectPriority";
import {
  buildMyWorkState,
  quickFilterMatches,
  quickFilterReasons,
  type NewsroomRegistryViewKey,
  type NewsroomRegistryViewOption,
} from "../features/projects/newsroomRegistry";
import {
  archiveProject,
  cloneLastProject,
  cloneSelectedProject,
  createEmptyProject,
  fetchProjects,
  restoreProject,
} from "../shared/api";
import type {
  ProjectFilters,
  ProjectListItem,
  ProjectsView,
  UserPublic,
} from "../shared/types";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
} from "../shared/labels";

const PROJECT_STATUS_OPTIONS = PROJECT_STATUS_ORDER.map((value) => ({
  value,
  label: PROJECT_STATUS_LABELS[value]
}));

interface MainPageProps {
  user: UserPublic;
  token: string;
  onOpenEditor: (projectId: number) => void;
}

function buildFilters(params: {
  search: string;
  statusFilter: string[];
  rubricFilter: string;
  participantFilter: string;
  createdFrom: string;
  createdTo: string;
  archivedByFilter: string;
  archivedFrom: string;
  archivedTo: string;
}): ProjectFilters {
  return {
    search: params.search,
    status: params.statusFilter,
    rubric: params.rubricFilter,
    participant: params.participantFilter,
    created_from: params.createdFrom,
    created_to: params.createdTo,
    archived_by: params.archivedByFilter,
    archived_from: params.archivedFrom,
    archived_to: params.archivedTo
  };
}

function countMyActionTasks(items: ProjectListItem[]): number {
  return items.reduce(
    (total, project) =>
      total +
      (project.my_open_action_comment_count || 0) +
      (project.my_in_progress_action_comment_count || 0) +
      (project.my_recently_resolved_action_comment_count || 0),
    0
  );
}

export default function MainPage({
  user,
  token,
  onOpenEditor,
}: MainPageProps) {
  const [view, setView] = useState<ProjectsView>("main");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [rubricFilter, setRubricFilter] = useState("");
  const [participantFilter, setParticipantFilter] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [archivedByFilter, setArchivedByFilter] = useState("");
  const [archivedFrom, setArchivedFrom] = useState("");
  const [archivedTo, setArchivedTo] = useState("");
  const [queueFilter, setQueueFilter] = useState<NewsroomRegistryViewKey>("all");
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canCreate = user.role === "admin" || user.role === "editor" || user.role === "author";
  const canArchiveManage = user.role === "admin" || user.role === "editor";
  const myWorkState = buildMyWorkState(items, user);
  const myWorkItems = myWorkState.items;
  const myActionTaskCount = countMyActionTasks(items);
  const myWorkCountByProjectId = Object.fromEntries(
    Object.entries(myWorkState.byProjectId).map(([projectId, projectItems]) => [
      Number(projectId),
      projectItems.length
    ])
  );
  const displayItems = sortProjectQueueItems(
    view === "main"
      ? items.filter((item) => quickFilterMatches(item, user, queueFilter))
      : items,
    view,
    myWorkCountByProjectId
  );
  const selectedProject = displayItems.find((item) => item.id === selectedProjectId) || null;
  const visibleSelectedProjectId = selectedProject?.id ?? null;
  const queueFilterOptions: NewsroomRegistryViewOption[] =
    view === "main"
      ? [
          {
            key: "all",
            title: "Все активные",
            detail: "Все активные карточки общего реестра без дополнительного сужения.",
            tone: "muted",
            count: items.length
          },
          {
            key: "my_stories",
            title: "Мои сюжеты",
            detail: "Сюжеты, где вы указаны в рабочей роли или назначенной правке.",
            tone: "fresh",
            count: items.filter((item) => quickFilterMatches(item, user, "my_stories")).length
          },
          {
            key: "assigned_to_me",
            title: "Назначено мне",
            detail: "Сюжеты с вашим прямым участием: текст, корректура, монтаж, титры или правка.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "assigned_to_me")).length
          },
          {
            key: "waiting_me",
            title: "Ждет моего действия",
            detail: "Карточки, где система ждет действия именно от вас.",
            tone: "warn",
            count: items.filter((item) => (myWorkState.byProjectId[item.id] || []).length > 0).length
          },
          {
            key: "in_progress",
            title: "В работе",
            detail: "Сюжеты и производственные треки, которые сейчас находятся в работе.",
            tone: "fresh",
            count: items.filter((item) => quickFilterMatches(item, user, "in_progress")).length
          },
          {
            key: "urgent",
            title: "Срочные",
            detail: "Сюжеты с открытыми правками, устаревшим текстом или рассинхронизацией производства.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "urgent")).length
          },
          {
            key: "open_actions",
            title: "Правки",
            detail: "Хотя бы одна открытая правка требует действия.",
            tone: "warn",
            count: items.filter((item) => (item.open_action_comment_count || 0) > 0).length
          },
          {
            key: "text",
            title: "Текст",
            detail: "Нет текущего текста, текущий текст устарел или нужна вычитка/текстовая правка.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "text")).length
          },
          {
            key: "edit",
            title: "Монтаж",
            detail: "Монтаж ждет передачи текста, работает на старом тексте или имеет открытые правки.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "edit")).length
          },
          {
            key: "titles",
            title: "Титры",
            detail: "Титры ждут вычитанный текст, требуют обновления или правок.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "titles")).length
          },
          {
            key: "voiceover",
            title: "Озвучка",
            detail: "Озвучка ждет вычитанный текст, требует обновления или правок.",
            tone: "fresh",
            count: items.filter((item) => quickFilterMatches(item, user, "voiceover")).length
          }
        ]
      : [];
  const activeQueueFilter =
    queueFilterOptions.find((option) => option.key === queueFilter) || null;
  const focusReasonsByProjectId =
    view === "main"
      ? Object.fromEntries(
          displayItems.map((item) => [
            item.id,
            quickFilterReasons(item, user, queueFilter, myWorkState.byProjectId)
          ])
        )
      : {};
  const queueSummary = {
    shown: displayItems.length,
    urgent: view === "main"
      ? displayItems.filter((item) => projectQueuePriorityState(
          item,
          focusReasonsByProjectId[item.id] || [],
          item.open_action_comment_count || 0
        ).tone === "warn").length
      : 0,
    textWarnings:
      view === "main" ? items.filter((item) => quickFilterMatches(item, user, "text")).length : 0,
    openActions:
      view === "main" ? items.filter((item) => quickFilterMatches(item, user, "open_actions")).length : 0,
  };
  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const filters = buildFilters({
        search,
        statusFilter,
        rubricFilter,
        participantFilter,
        createdFrom,
        createdTo,
        archivedByFilter,
        archivedFrom,
        archivedTo
      });
      const payload = await fetchProjects(view, filters, token);
      setItems(payload.items);
      setSelectedProjectId((prevSelectedId) =>
        payload.items.some((item) => item.id === prevSelectedId)
          ? prevSelectedId
          : null
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить список проектов"
      );
    } finally {
      setLoading(false);
    }
  }, [
    archivedByFilter,
    archivedFrom,
    archivedTo,
    createdFrom,
    createdTo,
    participantFilter,
    rubricFilter,
    search,
    statusFilter,
    token,
    view
  ]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function runProjectAction(
    action: () => Promise<{ message: string; project: ProjectListItem }>,
    options?: { forceView?: ProjectsView; selectNewProject?: boolean }
  ): Promise<void> {
    setActionLoading(true);
    setError("");
    setSuccess("");
    try {
      const payload = await action();
      setSuccess(payload.message);

      const nextView = options?.forceView || view;
      if (options?.forceView && options.forceView !== view) {
        setView(options.forceView);
      }

      const filters = buildFilters({
        search,
        statusFilter,
        rubricFilter,
        participantFilter,
        createdFrom,
        createdTo,
        archivedByFilter,
        archivedFrom,
        archivedTo
      });
      const refreshed = await fetchProjects(nextView, filters, token);
      setItems(refreshed.items);

      if (options?.selectNewProject) {
        setSelectedProjectId(payload.project.id);
      } else {
        setSelectedProjectId((prevSelectedId) =>
          refreshed.items.some((item) => item.id === prevSelectedId)
            ? prevSelectedId
            : null
        );
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось выполнить действие"
      );
    } finally {
      setActionLoading(false);
    }
  }

  function resetFilters(): void {
    setSearch("");
    setStatusFilter([]);
    setRubricFilter("");
    setParticipantFilter("");
    setCreatedFrom("");
    setCreatedTo("");
    setArchivedByFilter("");
    setArchivedFrom("");
    setArchivedTo("");
    setQueueFilter("all");
  }

  return (
    <section className="main-workspace">
      <section className="main-hero">
        <div>
          <p className="muted small">общий newsroom-реестр</p>
          <h2>{view === "archive" ? "Архив сюжетов" : "Реестр сюжетов"}</h2>
          <p className="muted">Единый реестр активных карточек, приоритетов и сигналов передачи текста.</p>
        </div>
      </section>

      <section className="main-command-center" aria-label="Управление реестром сюжетов">
        <div className="queue-summary-strip" aria-label="Сводка реестра сюжетов">
          <div>
            <span>Показано карточек</span>
            <strong>{queueSummary.shown}</strong>
          </div>
          <div>
            <span>Срочные сигналы</span>
            <strong>{queueSummary.urgent}</strong>
          </div>
          <div>
            <span>Текст требует внимания</span>
            <strong>{queueSummary.textWarnings}</strong>
          </div>
          <div>
            <span>Открытые правки</span>
            <strong>{queueSummary.openActions}</strong>
          </div>
        </div>

        <div className="main-toolbar" aria-label="Фильтры реестра сюжетов">
          <div className="main-view-toggle" aria-label="Контур списка">
            <button
              type="button"
              className={view === "main" ? "active" : ""}
              onClick={() => {
                setView("main");
                setSelectedProjectId(null);
                setQueueFilter("all");
              }}
            >
              Все активные
            </button>
            <button
              type="button"
              className={view === "archive" ? "active" : ""}
              onClick={() => {
                setView("archive");
                setSelectedProjectId(null);
                setQueueFilter("all");
              }}
            >
              Архив
            </button>
          </div>
          <label className="main-search-field">
            Поиск
            <input
              placeholder="Название, рубрика, участник"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => void loadProjects()} disabled={loading}>
            {loading ? "Загрузка..." : "Обновить"}
          </button>
          <button type="button" className="secondary" onClick={resetFilters}>
            Сбросить
          </button>
        </div>

        {view === "main" ? (
          <div className="queue-filter-strip" aria-label="Представления реестра сюжетов">
            {queueFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`queue-filter-pill queue-filter-pill-${option.tone} ${
                  option.key === queueFilter ? "active" : ""
                }`}
                title={option.detail}
                onClick={() => setQueueFilter(option.key)}
              >
                <span>{option.title}</span>
                <strong>{option.count}</strong>
              </button>
            ))}
          </div>
        ) : null}

        <div className="registry-command-strip">
          <div>
            <span className="muted small">Рабочие сигналы</span>
            <strong>Сигналы: {myWorkItems.length} · задачи правок: {myActionTaskCount}</strong>
          </div>
          <div className="project-action-buttons">
            <button
              type="button"
              disabled={!canCreate || actionLoading}
              onClick={() =>
                void runProjectAction(
                  () => createEmptyProject(token),
                  { forceView: "main", selectNewProject: true }
                )
              }
            >
              Создать карточку
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!canCreate || actionLoading}
              onClick={() =>
                void runProjectAction(
                  () => cloneLastProject(token),
                  { forceView: "main", selectNewProject: true }
                )
              }
            >
              Из последнего
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!canCreate || actionLoading || !visibleSelectedProjectId}
              onClick={() => {
                if (!visibleSelectedProjectId) {
                  return;
                }
                void runProjectAction(
                  () => cloneSelectedProject(token, visibleSelectedProjectId),
                  { forceView: "main", selectNewProject: true }
                );
              }}
            >
              Из выбранного
            </button>
            <button
              type="button"
              className="danger"
              disabled={view !== "main" || !canArchiveManage || actionLoading || !visibleSelectedProjectId}
              onClick={() => {
                if (!visibleSelectedProjectId) {
                  return;
                }
                void runProjectAction(
                  () => archiveProject(token, visibleSelectedProjectId),
                  { forceView: "main", selectNewProject: false }
                );
              }}
            >
              В архив
            </button>
            <button
              type="button"
              className="secondary"
              disabled={view !== "archive" || !canArchiveManage || actionLoading || !visibleSelectedProjectId}
              onClick={() => {
                if (!visibleSelectedProjectId) {
                  return;
                }
                void runProjectAction(
                  () => restoreProject(token, visibleSelectedProjectId),
                  { forceView: "archive", selectNewProject: false }
                );
              }}
            >
              Вернуть
            </button>
          </div>
        </div>

        <details className="advanced-filter-panel">
          <summary>Расширенные фильтры</summary>
          <div className="filters-grid">
            <label>
              Статусы
              <select
                multiple
                size={5}
                className="multi-select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    Array.from(event.target.selectedOptions, (option) => option.value)
                  )
                }
              >
                {PROJECT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Рубрика содержит
              <input
                value={rubricFilter}
                onChange={(event) => setRubricFilter(event.target.value)}
                placeholder="Новости, спецрепортаж..."
              />
            </label>

            <label>
              Участник содержит
              <input
                value={participantFilter}
                onChange={(event) => setParticipantFilter(event.target.value)}
                placeholder="Автор, исполнитель, корректор"
              />
            </label>

            <label>
              Создан от
              <input
                type="date"
                value={createdFrom}
                onChange={(event) => setCreatedFrom(event.target.value)}
              />
            </label>

            <label>
              Создан до
              <input
                type="date"
                value={createdTo}
                onChange={(event) => setCreatedTo(event.target.value)}
              />
            </label>
          </div>

          {view === "archive" ? (
            <div className="filters-grid">
              <label>
                Кто архивировал
                <input
                  value={archivedByFilter}
                  onChange={(event) => setArchivedByFilter(event.target.value)}
                  placeholder="Логин пользователя"
                />
              </label>
              <label>
                Архивирован от
                <input
                  type="date"
                  value={archivedFrom}
                  onChange={(event) => setArchivedFrom(event.target.value)}
                />
              </label>
              <label>
                Архивирован до
                <input
                  type="date"
                  value={archivedTo}
                  onChange={(event) => setArchivedTo(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </details>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}

      <div className="registry-layout">
        <ProjectWorkQueue
          items={displayItems}
          view={view}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onOpenProject={onOpenEditor}
          activeFocusTitle={view === "main" ? activeQueueFilter?.title || null : null}
          focusReasonsByProjectId={focusReasonsByProjectId}
        />
        <aside className="registry-preview-panel" aria-label="Предпросмотр выбранной карточки">
          {selectedProject ? (
            <>
              <div className="registry-preview-head">
                <span className="work-queue-id">#{selectedProject.id}</span>
                <h3>{selectedProject.title}</h3>
                <p className="muted">{selectedProject.rubric || "Без рубрики"}</p>
              </div>

              <div className="registry-preview-section">
                <span className="muted small">Стадия</span>
                <strong>{PROJECT_STATUS_LABELS[selectedProject.status] || selectedProject.status}</strong>
              </div>

              <div className="registry-preview-section">
                <span className="muted small">Главный блокер</span>
                <strong>
                  {projectMainBlocker(
                    selectedProject,
                    focusReasonsByProjectId[selectedProject.id] || []
                  )}
                </strong>
              </div>

              <div className="registry-preview-section">
                <span className="muted small">Ответственные</span>
                <div className="registry-preview-list">
                  {projectTeamSummary(selectedProject).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>

              <div className="registry-preview-section">
                <span className="muted small">Треки</span>
                <div className="registry-preview-list">
                  {projectTrackSummary(selectedProject).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>

              <div className="registry-preview-section">
                <span className="muted small">Последняя активность</span>
                <strong>{projectRegistryDateLabel(selectedProject, view === "archive")}</strong>
              </div>

              <button type="button" onClick={() => onOpenEditor(selectedProject.id)}>
                Открыть карточку
              </button>
            </>
          ) : (
            <div className="registry-preview-empty">
              <h3>Выберите сюжет</h3>
              <p className="muted">Предпросмотр покажет стадию, блокер, ответственных и состояние треков.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
