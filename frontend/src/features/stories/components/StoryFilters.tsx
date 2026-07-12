import type { StoryListQuery } from "../types";

interface StoryFiltersProps {
  query: StoryListQuery;
  onChange: (query: StoryListQuery) => void;
}

export default function StoryFilters({ query, onChange }: StoryFiltersProps) {
  return (
    <form className="story-filters" onSubmit={(event) => event.preventDefault()} aria-label="Фильтры сюжетов">
      <label>
        Поиск
        <input
          value={query.search || ""}
          onChange={(event) => onChange({ ...query, search: event.target.value || undefined })}
          placeholder="Название, автор или рубрика"
        />
      </label>
      <label>
        Приоритет
        <select value={query.priority || ""} onChange={(event) => onChange({ ...query, priority: (event.target.value || undefined) as StoryListQuery["priority"] })}>
          <option value="">Все</option>
          <option value="high">Высокий</option>
          <option value="standard">Стандарт</option>
        </select>
      </label>
      <label>
        Область
        <select value={query.area || ""} onChange={(event) => onChange({ ...query, area: (event.target.value || undefined) as StoryListQuery["area"] })}>
          <option value="">Все</option>
          <option value="scenario">Сценарий</option>
          <option value="video">Монтаж</option>
          <option value="titles">Титры</option>
          <option value="voiceover">Озвучка</option>
          <option value="external">Согласование</option>
        </select>
      </label>
      <label className="story-filter-checkbox">
        <input type="checkbox" checked={Boolean(query.mine)} onChange={(event) => onChange({ ...query, mine: event.target.checked })} />
        С моим участием
      </label>
    </form>
  );
}
