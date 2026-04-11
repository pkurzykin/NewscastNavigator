import { useCallback, useEffect, useState } from "react";

import ProjectsTable from "../components/ProjectsTable";
import {
  archiveProject,
  cloneLastProject,
  cloneSelectedProject,
  createEmptyProject,
  fetchProjects,
  restoreProject
} from "../shared/api";
import type { ProjectFilters, ProjectListItem, ProjectsView, UserPublic } from "../shared/types";

const PROJECT_STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "reviewed", label: "На проверке" },
  { value: "in_editing", label: "В работе" },
  { value: "in_proofreading", label: "На корректуре" },
  { value: "ready", label: "Готово" },
  { value: "delivered", label: "Сдано" },
  { value: "archived", label: "Архив" }
];

interface MainPageProps {
  user: UserPublic;
  token: string;
  onLogout: () => void;
  onOpenEditor: (projectId: number) => void;
  onOpenChangePassword: () => void;
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

interface MyWorkItem {
  project: ProjectListItem;
  tone: "warn" | "fresh" | "muted";
  title: string;
  detail: string;
}

type QueueFilterKey =
  | "all"
  | "my_work"
  | "open_actions"
  | "text"
  | "edit"
  | "titles"
  | "voiceover";

interface QueueFilterOption {
  key: QueueFilterKey;
  title: string;
  detail: string;
  tone: "warn" | "fresh" | "muted";
  count: number;
}

interface MyWorkState {
  items: MyWorkItem[];
  byProjectId: Record<number, MyWorkItem[]>;
}

function collectMyWorkItems(project: ProjectListItem, user: UserPublic): MyWorkItem[] {
  const result: MyWorkItem[] = [];

  if ((project.open_action_comment_count || 0) > 0) {
    if (project.edit_assignee_user_id === user.id && (project.open_edit_action_comment_count || 0) > 0) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по монтажу",
        detail: `Открытых комментариев по монтажу: ${project.open_edit_action_comment_count || 0}.`
      });
    }
    if (
      project.titles_assignee_user_id === user.id &&
      (project.open_titles_action_comment_count || 0) > 0
    ) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по титрам",
        detail: `Открытых комментариев по титрам: ${project.open_titles_action_comment_count || 0}.`
      });
    }
    if (
      (project.author_user_id === user.id || project.proofreader_user_id === user.id) &&
      (project.open_text_action_comment_count || 0) > 0
    ) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по тексту",
        detail: `Открытых комментариев по тексту: ${project.open_text_action_comment_count || 0}.`
      });
    }
    if (
      project.proofreader_user_id === user.id &&
      (project.open_voiceover_action_comment_count || 0) > 0
    ) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по озвучке",
        detail: `Открытых комментариев по озвучке: ${project.open_voiceover_action_comment_count || 0}.`
      });
    }
  }

  if (project.author_user_id === user.id) {
    if ((project.text_seq || 0) < 1) {
      result.push({
        project,
        tone: "warn",
        title: "Нужно начать текст",
        detail: "В карточке пока нет сохраненного текста."
      });
    } else if (!project.current_text_seq) {
      result.push({
        project,
        tone: "warn",
        title: "Нужно назначить current",
        detail: "Текст уже есть, но handoff-состояние еще не назначено."
      });
    } else if (!project.current_text_is_latest) {
      result.push({
        project,
        tone: "warn",
        title: "Current текста устарел",
        detail: "В workspace появились новые правки после последнего handoff."
      });
    }
  }

  if (project.proofreader_user_id === user.id) {
    if (!project.current_text_seq) {
      result.push({
        project,
        tone: "muted",
        title: "Ждем current для корректуры",
        detail: "Корректура начнется после назначения текущей версии текста."
      });
    } else if (!project.proofread_text_is_current) {
      result.push({
        project,
        tone: "warn",
        title: "Нужна вычитка",
        detail: "Current текста новее последней вычитанной версии."
      });
    }
  }

  if (project.titles_assignee_user_id === user.id) {
    if (project.titles_requires_resync) {
      result.push({
        project,
        tone: "warn",
        title: "Титры надо пересинхронизировать",
        detail: "Текст изменился после того, как титры уже были взяты в работу."
      });
    } else if (!project.titles_text_seq && project.latest_text_is_proofread) {
      result.push({
        project,
        tone: "fresh",
        title: "Можно брать текст в титры",
        detail: "Есть вычитанная версия текста, готовая для титрования."
      });
    }
  }

  if (project.edit_assignee_user_id === user.id) {
    if (project.edit_requires_resync) {
      result.push({
        project,
        tone: "warn",
        title: "Монтаж на старом handoff",
        detail: "Current текста изменился после последней синхронизации монтажа."
      });
    } else if (!project.edit_text_seq && project.current_text_seq) {
      result.push({
        project,
        tone: "fresh",
        title: "Можно брать current в монтаж",
        detail: "Для монтажа уже назначен handoff текста."
      });
    }
  }

  return result;
}

function buildMyWorkState(items: ProjectListItem[], user: UserPublic): MyWorkState {
  const itemsList: MyWorkItem[] = [];
  const byProjectId: Record<number, MyWorkItem[]> = {};

  for (const project of items) {
    const projectItems = collectMyWorkItems(project, user);
    if (projectItems.length > 0) {
      byProjectId[project.id] = projectItems;
      itemsList.push(...projectItems);
    }
  }

  const sortedItems = itemsList.sort((left, right) => {
    const toneWeight = { warn: 0, fresh: 1, muted: 2 };
    const toneDelta = toneWeight[left.tone] - toneWeight[right.tone];
    if (toneDelta !== 0) {
      return toneDelta;
    }
    return right.project.id - left.project.id;
  });

  return {
    items: sortedItems,
    byProjectId
  };
}

function quickFilterMatches(project: ProjectListItem, user: UserPublic, filter: QueueFilterKey): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "my_work") {
    return collectMyWorkItems(project, user).length > 0;
  }
  if (filter === "open_actions") {
    return (project.open_action_comment_count || 0) > 0;
  }
  if (filter === "text") {
    return (
      (project.open_text_action_comment_count || 0) > 0 ||
      !project.current_text_seq ||
      !project.current_text_is_latest ||
      !project.latest_text_is_proofread
    );
  }
  if (filter === "edit") {
    return (
      (project.open_edit_action_comment_count || 0) > 0 ||
      !!project.edit_requires_resync ||
      (!project.edit_text_seq && !!project.current_text_seq)
    );
  }
  if (filter === "titles") {
    return (
      (project.open_titles_action_comment_count || 0) > 0 ||
      !!project.titles_requires_resync ||
      (!project.titles_text_seq && !!project.latest_text_is_proofread)
    );
  }
  return (
    (project.open_voiceover_action_comment_count || 0) > 0 ||
    !!project.voiceover_requires_resync ||
    (!project.voiceover_text_seq && !!project.latest_text_is_proofread)
  );
}

function quickFilterReasons(
  project: ProjectListItem,
  user: UserPublic,
  filter: QueueFilterKey,
  myWorkByProjectId: Record<number, MyWorkItem[]>
): string[] {
  if (filter === "my_work") {
    return Array.from(new Set((myWorkByProjectId[project.id] || []).map((item) => item.title)));
  }

  const reasons: string[] = [];

  if (filter === "open_actions") {
    if ((project.open_text_action_comment_count || 0) > 0) {
      reasons.push(`Текст: ${project.open_text_action_comment_count || 0}`);
    }
    if ((project.open_edit_action_comment_count || 0) > 0) {
      reasons.push(`Монтаж: ${project.open_edit_action_comment_count || 0}`);
    }
    if ((project.open_titles_action_comment_count || 0) > 0) {
      reasons.push(`Титры: ${project.open_titles_action_comment_count || 0}`);
    }
    if ((project.open_voiceover_action_comment_count || 0) > 0) {
      reasons.push(`Озвучка: ${project.open_voiceover_action_comment_count || 0}`);
    }
    if (reasons.length === 0 && (project.open_action_comment_count || 0) > 0) {
      reasons.push(`Открытых правок: ${project.open_action_comment_count || 0}`);
    }
    return reasons;
  }

  if (filter === "text") {
    if (!project.current_text_seq) {
      reasons.push("Нет текущей версии текста");
    } else if (!project.current_text_is_latest) {
      reasons.push("Current текста устарел");
    }
    if (!project.latest_text_is_proofread) {
      reasons.push("Нужна вычитка current");
    }
    if ((project.open_text_action_comment_count || 0) > 0) {
      reasons.push(`Есть открытые текстовые правки: ${project.open_text_action_comment_count || 0}`);
    }
  }

  if (filter === "edit") {
    if (project.edit_requires_resync) {
      reasons.push("Монтаж на старом handoff");
    } else if (!project.edit_text_seq && project.current_text_seq) {
      reasons.push("Монтаж можно брать в работу");
    }
    if ((project.open_edit_action_comment_count || 0) > 0) {
      reasons.push(`Есть открытые правки по монтажу: ${project.open_edit_action_comment_count || 0}`);
    }
  }

  if (filter === "titles") {
    if (project.titles_requires_resync) {
      reasons.push("Титры требуют пересинхронизации");
    } else if (!project.titles_text_seq && project.latest_text_is_proofread) {
      reasons.push("Есть текст, готовый для титров");
    }
    if ((project.open_titles_action_comment_count || 0) > 0) {
      reasons.push(`Есть открытые правки по титрам: ${project.open_titles_action_comment_count || 0}`);
    }
  }

  if (filter === "voiceover") {
    if (project.voiceover_requires_resync) {
      reasons.push("Озвучка на старом тексте");
    } else if (!project.voiceover_text_seq && project.latest_text_is_proofread) {
      reasons.push("Есть вычитанный текст для озвучки");
    }
    if ((project.open_voiceover_action_comment_count || 0) > 0) {
      reasons.push(`Есть открытые правки по озвучке: ${project.open_voiceover_action_comment_count || 0}`);
    }
  }

  if (filter === "all") {
    return Array.from(new Set((myWorkByProjectId[project.id] || []).map((item) => item.title))).slice(0, 3);
  }

  if (reasons.length === 0 && quickFilterMatches(project, user, filter)) {
    reasons.push("Проект попал в текущую рабочую очередь");
  }

  return reasons;
}

export default function MainPage({
  user,
  token,
  onLogout,
  onOpenEditor,
  onOpenChangePassword
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
  const [queueFilter, setQueueFilter] = useState<QueueFilterKey>("all");
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canCreate = user.role === "admin" || user.role === "editor" || user.role === "author";
  const canArchiveManage = user.role === "admin" || user.role === "editor";
  const selectedProject = items.find((item) => item.id === selectedProjectId) || null;
  const myWorkState = buildMyWorkState(items, user);
  const myWorkItems = myWorkState.items;
  const displayItems =
    view === "main"
      ? items.filter((item) => quickFilterMatches(item, user, queueFilter))
      : items;
  const queueFilterOptions: QueueFilterOption[] =
    view === "main"
      ? [
          {
            key: "all",
            title: "Весь MAIN",
            detail: "Все активные карточки без дополнительного сужения.",
            tone: "muted",
            count: items.length
          },
          {
            key: "my_work",
            title: "Ждет меня",
            detail: "Карточки, где система ждет действия именно от вас.",
            tone: "warn",
            count: items.filter((item) => (myWorkState.byProjectId[item.id] || []).length > 0).length
          },
          {
            key: "open_actions",
            title: "Есть правки",
            detail: "Хотя бы один открытый комментарий с requires action.",
            tone: "warn",
            count: items.filter((item) => (item.open_action_comment_count || 0) > 0).length
          },
          {
            key: "text",
            title: "Текст",
            detail: "Нет current, current устарел или нужна вычитка/текстовая правка.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "text")).length
          },
          {
            key: "edit",
            title: "Монтаж",
            detail: "Монтаж ждет handoff, работает на старом тексте или имеет открытые правки.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "edit")).length
          },
          {
            key: "titles",
            title: "Титры",
            detail: "Титры ждут вычитанный текст, требуют пересинхронизации или правок.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "titles")).length
          },
          {
            key: "voiceover",
            title: "Озвучка",
            detail: "Озвучка ждет вычитанный текст, требует пересинхронизации или правок.",
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
    <section className="card">
      <div className="row between wrap">
        <div>
          <h2>MAIN / ARCHIVE (Web)</h2>
          <p className="muted">
            Пользователь: <strong>{user.full_name || user.username}</strong> ({user.role})
          </p>
          {user.job_title ? <p className="muted">Должность: <strong>{user.job_title}</strong></p> : null}
          <p className="muted">
            Выбранный проект:{" "}
            <strong>{selectedProject ? `#${selectedProject.id} ${selectedProject.title}` : "-"}</strong>
          </p>
        </div>
        <div className="row wrap">
          <button type="button" className="secondary" onClick={onOpenChangePassword}>
            Сменить пароль
          </button>
          <button type="button" onClick={onLogout} className="secondary">
            Выйти
          </button>
        </div>
      </div>

      <div className="row controls wrap">
        <select
          value={view}
          onChange={(event) => {
            setView(event.target.value as ProjectsView);
            setSelectedProjectId(null);
            setQueueFilter("all");
          }}
        >
          <option value="main">MAIN</option>
          <option value="archive">ARCHIVE</option>
        </select>
        <input
          placeholder="Поиск по названию"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" onClick={() => void loadProjects()} disabled={loading}>
          {loading ? "Загрузка..." : "Обновить"}
        </button>
        <button type="button" className="secondary" onClick={resetFilters}>
          Сбросить фильтры
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!selectedProjectId}
          onClick={() => {
            if (!selectedProjectId) {
              return;
            }
            onOpenEditor(selectedProjectId);
          }}
        >
          Открыть EDITOR
        </button>
      </div>

      <div className="card">
        <div className="row between wrap">
          <div>
            <h3>Что ждет меня</h3>
            <p className="muted">
              Карточки, где сейчас ожидается действие именно от вашей роли или вашего назначения.
            </p>
          </div>
          <p className="muted">
            Всего сигналов: <strong>{myWorkItems.length}</strong>
          </p>
        </div>
        {myWorkItems.length === 0 ? (
          <p className="muted">Сейчас для вашей учетной записи нет явных handoff-сигналов.</p>
        ) : (
          <div className="my-work-grid">
            {myWorkItems.map((item) => (
              <button
                key={`${item.project.id}-${item.title}`}
                type="button"
                className={`my-work-card my-work-card-${item.tone}`}
                onClick={() => onOpenEditor(item.project.id)}
              >
                <span className="my-work-card-title">{item.title}</span>
                <strong>#{item.project.id} {item.project.title}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "main" ? (
        <div className="card">
          <div className="row between wrap">
            <div>
              <h3>Рабочая очередь MAIN</h3>
              <p className="muted">
                Быстрый фокус по тем проектам, где сейчас есть действие, правка или явный handoff-сигнал.
              </p>
            </div>
            <p className="muted">
              В таблице: <strong>{displayItems.length}</strong> из <strong>{items.length}</strong>
            </p>
          </div>
          <div className="queue-filter-grid">
            {queueFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`queue-filter-card queue-filter-card-${option.tone} ${
                  option.key === queueFilter ? "queue-filter-card-active" : ""
                }`}
                onClick={() => setQueueFilter(option.key)}
              >
                <span className="queue-filter-card-title">{option.title}</span>
                <strong>{option.count}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h3>Фильтры списка</h3>
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
      </div>

      <div className="row controls wrap">
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
          Создать новый (пустой)
        </button>
        <button
          type="button"
          disabled={!canCreate || actionLoading}
          onClick={() =>
            void runProjectAction(
              () => cloneLastProject(token),
              { forceView: "main", selectNewProject: true }
            )
          }
        >
          Создать из последнего
        </button>
        <button
          type="button"
          disabled={!canCreate || actionLoading || !selectedProjectId}
          onClick={() => {
            if (!selectedProjectId) {
              return;
            }
            void runProjectAction(
              () => cloneSelectedProject(token, selectedProjectId),
              { forceView: "main", selectNewProject: true }
            );
          }}
        >
          Создать из выбранного
        </button>
        <button
          type="button"
          className="danger"
          disabled={view !== "main" || !canArchiveManage || actionLoading || !selectedProjectId}
          onClick={() => {
            if (!selectedProjectId) {
              return;
            }
            void runProjectAction(
              () => archiveProject(token, selectedProjectId),
              { forceView: "main", selectNewProject: false }
            );
          }}
        >
          В архив
        </button>
        <button
          type="button"
          className="secondary"
          disabled={view !== "archive" || !canArchiveManage || actionLoading || !selectedProjectId}
          onClick={() => {
            if (!selectedProjectId) {
              return;
            }
            void runProjectAction(
              () => restoreProject(token, selectedProjectId),
              { forceView: "archive", selectNewProject: false }
            );
          }}
        >
          Вернуть в MAIN
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}

      <ProjectsTable
        items={displayItems}
        view={view}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        activeFocusTitle={view === "main" ? activeQueueFilter?.title || null : null}
        focusReasonsByProjectId={focusReasonsByProjectId}
      />
    </section>
  );
}
