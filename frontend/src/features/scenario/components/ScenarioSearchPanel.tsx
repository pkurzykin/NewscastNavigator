import { useEffect, useRef, type KeyboardEvent } from "react";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";

import type { ScenarioSearchMatch } from "../scenarioSearch";

interface Props {
  mode: "find" | "replace";
  query: string;
  replacement: string;
  matchCase: boolean;
  activeIndex: number;
  matches: ScenarioSearchMatch[];
  editable: boolean;
  focusRequest?: number;
  onQueryChange: (query: string) => void;
  onReplacementChange: (replacement: string) => void;
  onMatchCaseChange: (matchCase: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export default function ScenarioSearchPanel({
  mode,
  query,
  replacement,
  matchCase,
  activeIndex,
  matches,
  editable,
  focusRequest = 0,
  onQueryChange,
  onReplacementChange,
  onMatchCaseChange,
  onPrevious,
  onNext,
  onReplace,
  onReplaceAll,
  onClose,
}: Props) {
  const queryRef = useRef<HTMLInputElement | null>(null);
  const hasMatches = matches.length > 0;
  const currentOrdinal = hasMatches
    ? Math.max(0, Math.min(activeIndex, matches.length - 1)) + 1
    : 0;

  useEffect(() => {
    queryRef.current?.focus({ preventScroll: true });
    queryRef.current?.select();
  }, [focusRequest, mode]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <section
      className="scenario-search-panel"
      role="search"
      aria-label="Найти и заменить"
      onKeyDown={handleKeyDown}
    >
      <TextField
        className="scenario-search-field"
        label="Найти"
        type="search"
        inputRef={queryRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      {mode === "replace" ? (
        <TextField
          className="scenario-search-field"
          label="Заменить на"
          value={replacement}
          onChange={(event) => onReplacementChange(event.target.value)}
        />
      ) : null}
      <div className="scenario-search-navigation">
        <span className="scenario-search-count" role="status" aria-live="polite">
          {currentOrdinal} из {matches.length}
        </span>
        <IconButton
          type="button"
          aria-label="Предыдущее совпадение"
          title="Предыдущее совпадение"
          disabled={!hasMatches}
          onClick={onPrevious}
        >
          ↑
        </IconButton>
        <IconButton
          type="button"
          aria-label="Следующее совпадение"
          title="Следующее совпадение"
          disabled={!hasMatches}
          onClick={onNext}
        >
          ↓
        </IconButton>
      </div>
      <FormControlLabel
        className="scenario-search-case"
        control={<Checkbox
          checked={matchCase}
          onChange={(event) => onMatchCaseChange(event.target.checked)}
        />}
        label="Учитывать регистр"
      />
      {mode === "replace" ? (
        <div className="scenario-search-replace-actions">
          <Button
            type="button"
            variant="outlined"
            disabled={!editable || !hasMatches}
            onClick={onReplace}
          >
            Заменить
          </Button>
          <Button
            type="button"
            variant="outlined"
            disabled={!editable || !query || !hasMatches}
            onClick={onReplaceAll}
          >
            Заменить всё
          </Button>
        </div>
      ) : null}
      <IconButton
        type="button"
        className="scenario-search-close"
        aria-label="Закрыть поиск"
        title="Закрыть поиск"
        onClick={onClose}
      >
        ×
      </IconButton>
    </section>
  );
}
