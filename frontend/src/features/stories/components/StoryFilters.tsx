import type { StoryListQuery } from "../types";

interface StoryFiltersProps {
  query: StoryListQuery;
  onChange: (query: StoryListQuery) => void;
}

export default function StoryFilters({ query, onChange }: StoryFiltersProps) {
  return (
    <form className="story-filters" onSubmit={(event) => event.preventDefault()} aria-label="Фильтры сюжетов">
      <label className="story-filter-field story-search-field">
        <span>Поиск</span>
        <input
          value={query.search || ""}
          onChange={(event) => onChange({ ...query, search: event.target.value || undefined })}
          placeholder="Найти по названию, автору или рубрике"
        />
      </label>
      <label className="story-filter-field">
        <span>Приоритет</span>
        <select value={query.priority || ""} onChange={(event) => onChange({ ...query, priority: (event.target.value || undefined) as StoryListQuery["priority"] })}>
          <option value="">Приоритет: все</option>
          <option value="high">Приоритет: высокий</option>
          <option value="standard">Приоритет: стандарт</option>
        </select>
      </label>
      <label className="story-filter-field">
        <span>Область</span>
        <select value={query.area || ""} onChange={(event) => onChange({ ...query, area: (event.target.value || undefined) as StoryListQuery["area"] })}>
          <option value="">Область: все</option>
          <option value="scenario">Область: сценарий</option>
          <option value="video">Область: монтаж</option>
          <option value="titles">Область: титры</option>
          <option value="voiceover">Область: озвучка</option>
          <option value="external">Область: согласование</option>
        </select>
      </label>
      <label className="story-filter-checkbox">
        <input type="checkbox" checked={Boolean(query.mine)} onChange={(event) => onChange({ ...query, mine: event.target.checked })} />
        С моим участием
      </label>
    </form>
  );
}
