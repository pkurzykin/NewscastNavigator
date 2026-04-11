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

function buildMyWorkItems(items: ProjectListItem[], user: UserPublic): MyWorkItem[] {
  const result: MyWorkItem[] = [];

  for (const project of items) {
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
  }

  return result.sort((left, right) => {
    const toneWeight = { warn: 0, fresh: 1, muted: 2 };
    const toneDelta = toneWeight[left.tone] - toneWeight[right.tone];
    if (toneDelta !== 0) {
      return toneDelta;
    }
    return right.project.id - left.project.id;
  });
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
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canCreate = user.role === "admin" || user.role === "editor" || user.role === "author";
  const canArchiveManage = user.role === "admin" || user.role === "editor";
  const selectedProject = items.find((item) => item.id === selectedProjectId) || null;
  const myWorkItems = buildMyWorkItems(items, user);

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
        items={items}
        view={view}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
      />
    </section>
  );
}
