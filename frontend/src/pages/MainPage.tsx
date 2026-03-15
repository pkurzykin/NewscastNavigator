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

export default function MainPage({
  user,
  token,
  onLogout,
  onOpenEditor
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
            Пользователь: <strong>{user.username}</strong> ({user.role})
          </p>
          <p className="muted">
            Выбранный проект:{" "}
            <strong>{selectedProject ? `#${selectedProject.id} ${selectedProject.title}` : "-"}</strong>
          </p>
        </div>
        <button type="button" onClick={onLogout} className="secondary">
          Выйти
        </button>
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
