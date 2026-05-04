import type { ProjectsView } from "../shared/types";

export interface ProjectQueueFilterOption {
  key: string;
  title: string;
  detail: string;
  count: number;
  tone: "warn" | "fresh" | "muted";
}

interface ProjectFiltersBarProps {
  search: string;
  view: ProjectsView;
  loading: boolean;
  activeFilterKey: string;
  filterOptions: ProjectQueueFilterOption[];
  onSearchChange: (value: string) => void;
  onViewChange: (value: ProjectsView) => void;
  onFilterChange: (value: string) => void;
  onRefresh: () => void;
  onReset: () => void;
}

export default function ProjectFiltersBar({
  search,
  view,
  loading,
  activeFilterKey,
  filterOptions,
  onSearchChange,
  onViewChange,
  onFilterChange,
  onRefresh,
  onReset,
}: ProjectFiltersBarProps) {
  return (
    <div className="project-filters-bar">
      <label className="project-filter-search">
        Поиск
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Название, рубрика, участник"
        />
      </label>

      <div className="project-filter-segment" aria-label="Список сюжетов">
        <button
          type="button"
          className={view === "main" ? "secondary active" : "secondary"}
          onClick={() => onViewChange("main")}
        >
          Основной список
        </button>
        <button
          type="button"
          className={view === "archive" ? "secondary active" : "secondary"}
          onClick={() => onViewChange("archive")}
        >
          Архив
        </button>
      </div>

      {view === "main" && filterOptions.length > 0 ? (
        <div className="project-filter-chips" aria-label="Фильтр рабочей очереди">
          {filterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={
                option.key === activeFilterKey
                  ? `project-filter-chip project-filter-chip-${option.tone} active`
                  : `project-filter-chip project-filter-chip-${option.tone}`
              }
              title={option.detail}
              onClick={() => onFilterChange(option.key)}
            >
              <span>{option.title}</span>
              <strong>{option.count}</strong>
            </button>
          ))}
        </div>
      ) : null}

      <div className="project-filter-actions">
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? "Загрузка..." : "Обновить"}
        </button>
        <button type="button" className="secondary" onClick={onReset}>
          Сбросить
        </button>
      </div>
    </div>
  );
}
