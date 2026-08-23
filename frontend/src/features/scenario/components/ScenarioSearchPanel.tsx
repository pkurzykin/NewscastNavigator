import { useEffect, useRef, type KeyboardEvent } from "react";

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
      <label className="scenario-search-field">
        <span>Найти</span>
        <input
          ref={queryRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      {mode === "replace" ? (
        <label className="scenario-search-field">
          <span>Заменить на</span>
          <input
            value={replacement}
            onChange={(event) => onReplacementChange(event.target.value)}
          />
        </label>
      ) : null}
      <div className="scenario-search-navigation">
        <span className="scenario-search-count" role="status" aria-live="polite">
          {currentOrdinal} из {matches.length}
        </span>
        <button
          type="button"
          className="secondary"
          aria-label="Предыдущее совпадение"
          disabled={!hasMatches}
          onClick={onPrevious}
        >
          ↑
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="Следующее совпадение"
          disabled={!hasMatches}
          onClick={onNext}
        >
          ↓
        </button>
      </div>
      <label className="scenario-search-case">
        <input
          type="checkbox"
          checked={matchCase}
          onChange={(event) => onMatchCaseChange(event.target.checked)}
        />
        Учитывать регистр
      </label>
      {mode === "replace" ? (
        <div className="scenario-search-replace-actions">
          <button
            type="button"
            className="secondary"
            disabled={!editable || !hasMatches}
            onClick={onReplace}
          >
            Заменить
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!editable || !query || !hasMatches}
            onClick={onReplaceAll}
          >
            Заменить всё
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="secondary scenario-search-close"
        aria-label="Закрыть поиск"
        onClick={onClose}
      >
        ×
      </button>
    </section>
  );
}
