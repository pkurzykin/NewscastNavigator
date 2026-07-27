import { useEffect, useRef, useState } from "react";

import type { RubricRef } from "../../../shared/contracts";
import { updateStoryMetadata } from "../../stories/api";

interface ScenarioMetadataHeaderProps {
  storyId: number;
  story: { id: number; title: string; rubric: RubricRef };
  editable: boolean;
  rubrics: RubricRef[];
  onChanged?: (patch: { title?: string; rubric?: RubricRef }) => void;
}

export default function ScenarioMetadataHeader({
  storyId,
  story,
  editable,
  rubrics,
  onChanged,
}: ScenarioMetadataHeaderProps) {
  const [title, setTitle] = useState(story.title);
  const [savedTitle, setSavedTitle] = useState(story.title);
  const [rubricId, setRubricId] = useState(story.rubric.id);
  const [error, setError] = useState("");
  const titleRequestRef = useRef(0);
  const rubricRequestRef = useRef(0);
  const currentStoryIdRef = useRef(storyId);

  if (currentStoryIdRef.current !== storyId) {
    currentStoryIdRef.current = storyId;
    titleRequestRef.current += 1;
    rubricRequestRef.current += 1;
  }

  useEffect(() => {
    titleRequestRef.current += 1;
    setTitle(story.title);
    setSavedTitle(story.title);
  }, [story.id, story.title, storyId]);

  useEffect(() => {
    rubricRequestRef.current += 1;
    setRubricId(story.rubric.id);
  }, [story.id, story.rubric.id, storyId]);

  useEffect(() => {
    setError("");
  }, [story.id, storyId]);

  const options = rubrics.length ? rubrics : [story.rubric];

  const saveTitle = async () => {
    const normalized = title.trim();
    if (!editable || normalized === savedTitle) return;
    if (!normalized) {
      setTitle(savedTitle);
      setError("Название сюжета не может быть пустым");
      return;
    }
    const requestId = titleRequestRef.current + 1;
    titleRequestRef.current = requestId;
    const requestStoryId = storyId;
    try {
      await updateStoryMetadata(storyId, { title: normalized });
      if (
        requestId !== titleRequestRef.current
        || requestStoryId !== currentStoryIdRef.current
      ) return;
      setTitle(normalized);
      setSavedTitle(normalized);
      setError("");
      onChanged?.({ title: normalized });
    } catch (requestError) {
      if (
        requestId !== titleRequestRef.current
        || requestStoryId !== currentStoryIdRef.current
      ) return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось сохранить название сюжета",
      );
    }
  };

  const saveRubric = async (nextRubricId: number) => {
    const previousRubricId = rubricId;
    const requestId = rubricRequestRef.current + 1;
    rubricRequestRef.current = requestId;
    const requestStoryId = storyId;
    setRubricId(nextRubricId);
    try {
      await updateStoryMetadata(storyId, { rubric_id: nextRubricId });
      if (
        requestId !== rubricRequestRef.current
        || requestStoryId !== currentStoryIdRef.current
      ) return;
      setError("");
      onChanged?.({ rubric: options.find((rubric) => rubric.id === nextRubricId) });
    } catch (requestError) {
      if (
        requestId !== rubricRequestRef.current
        || requestStoryId !== currentStoryIdRef.current
      ) return;
      setRubricId(previousRubricId);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось сохранить рубрику",
      );
    }
  };

  return (
    <div
      className="editor-table-header-panel"
      role="group"
      aria-label="Шапка таблицы сценария"
    >
      <label>
        Название
        <input
          aria-label="Название"
          value={title}
          disabled={!editable}
          maxLength={255}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void saveTitle()}
        />
      </label>
      <label>
        Рубрика
        <select
          aria-label="Рубрика"
          value={rubricId}
          disabled={!editable}
          onChange={(event) => void saveRubric(Number(event.target.value))}
        >
          {options.map((rubric) => (
            <option key={rubric.id} value={rubric.id}>{rubric.name}</option>
          ))}
        </select>
      </label>
      {error ? <p className="editor-metadata-error" role="alert">{error}</p> : null}
    </div>
  );
}
