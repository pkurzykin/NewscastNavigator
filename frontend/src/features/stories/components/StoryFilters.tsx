import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";

import type { StoryListQuery } from "../types";

interface StoryFiltersProps {
  query: StoryListQuery;
  onChange: (query: StoryListQuery) => void;
}

export default function StoryFilters({ query, onChange }: StoryFiltersProps) {
  return (
    <form className="story-filters" onSubmit={(event) => event.preventDefault()} aria-label="Фильтры сюжетов">
      <TextField
        className="story-search-field"
        label="Поиск"
        value={query.search || ""}
        onChange={(event) => onChange({ ...query, search: event.target.value || undefined })}
        placeholder="Название, автор или рубрика"
      />
      <FormControl size="small">
        <InputLabel id="story-filter-priority-label">Приоритет</InputLabel>
        <Select
          labelId="story-filter-priority-label"
          id="story-filter-priority"
          label="Приоритет"
          value={query.priority || ""}
          onChange={(event) => onChange({
            ...query,
            priority: (event.target.value || undefined) as StoryListQuery["priority"],
          })}
        >
          <MenuItem value="">Все</MenuItem>
          <MenuItem value="high">Высокий</MenuItem>
          <MenuItem value="standard">Стандарт</MenuItem>
        </Select>
      </FormControl>
      <FormControl size="small">
        <InputLabel id="story-filter-area-label">Область</InputLabel>
        <Select
          labelId="story-filter-area-label"
          id="story-filter-area"
          label="Область"
          value={query.area || ""}
          onChange={(event) => onChange({
            ...query,
            area: (event.target.value || undefined) as StoryListQuery["area"],
          })}
        >
          <MenuItem value="">Все</MenuItem>
          <MenuItem value="scenario">Сценарий</MenuItem>
          <MenuItem value="video">Монтаж</MenuItem>
          <MenuItem value="titles">Титры</MenuItem>
          <MenuItem value="voiceover">Озвучка</MenuItem>
          <MenuItem value="external">Согласование</MenuItem>
        </Select>
      </FormControl>
      <FormControlLabel
        className="story-filter-checkbox"
        control={(
          <Checkbox
            checked={Boolean(query.mine)}
            onChange={(event) => onChange({ ...query, mine: event.target.checked })}
          />
        )}
        label="С моим участием"
      />
    </form>
  );
}
