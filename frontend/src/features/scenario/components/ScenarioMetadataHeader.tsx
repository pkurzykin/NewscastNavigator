import { useEffect, useMemo, useReducer, useRef } from "react";

import type { RubricRef } from "../../../shared/contracts";
import { getMetadataSaveCoordinator } from "../metadataSaveCoordinator";

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
  const coordinator = useMemo(
    () => getMetadataSaveCoordinator(storyId, {
      title: story.title,
      rubricId: story.rubric.id,
    }),
    [storyId],
  );
  const [, rerender] = useReducer((version: number) => version + 1, 0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const rubricsRef = useRef(rubrics);
  rubricsRef.current = rubrics;

  useEffect(() => {
    let seenAckVersion = coordinator.snapshot().ackVersion;
    const notifyParent = () => {
      const snapshot = coordinator.snapshot();
      if (snapshot.ackVersion <= seenAckVersion || !snapshot.lastAckPatch) return;
      seenAckVersion = snapshot.ackVersion;
      const changed: { title?: string; rubric?: RubricRef } = {};
      if (snapshot.lastAckPatch.title !== undefined) {
        changed.title = snapshot.lastAckPatch.title;
      }
      if (snapshot.lastAckPatch.rubric_id !== undefined) {
        changed.rubric = rubricsRef.current.find(
          (rubric) => rubric.id === snapshot.lastAckPatch?.rubric_id,
        );
      }
      onChangedRef.current?.(changed);
    };
    const initial = coordinator.snapshot();
    const initialChanged: { title?: string; rubric?: RubricRef } = {};
    if (initial.persisted.title !== story.title) {
      initialChanged.title = initial.persisted.title;
    }
    if (initial.persisted.rubricId !== story.rubric.id) {
      initialChanged.rubric = rubricsRef.current.find(
        (rubric) => rubric.id === initial.persisted.rubricId,
      );
    }
    if (initialChanged.title !== undefined || initialChanged.rubric !== undefined) {
      onChangedRef.current?.(initialChanged);
    }
    return coordinator.subscribe(() => {
      notifyParent();
      rerender();
    });
  }, [coordinator]);

  const snapshot = coordinator.snapshot();
  const currentRubricIsActive = rubrics.some(
    (rubric) => rubric.id === story.rubric.id,
  );
  const options = currentRubricIsActive
    ? rubrics
    : [story.rubric, ...rubrics];

  const saveTitle = () => {
    const normalized = coordinator.snapshot().desired.title.trim();
    if (!editable) return;
    if (!normalized) {
      coordinator.setValidationError("Название сюжета не может быть пустым");
      return;
    }
    if (normalized !== coordinator.snapshot().desired.title) {
      coordinator.setDesiredTitle(normalized);
    }
    coordinator.queueLatestDesired();
  };

  const saveRubric = (nextRubricId: number) => {
    coordinator.setDesiredRubric(nextRubricId);
    coordinator.queueLatestDesired();
  };

  const retry = () => {
    const normalized = coordinator.snapshot().desired.title.trim();
    if (!normalized) {
      coordinator.setValidationError("Название сюжета не может быть пустым");
      return;
    }
    coordinator.setDesiredTitle(normalized);
    coordinator.retry();
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
          value={snapshot.desired.title}
          disabled={!editable}
          maxLength={255}
          onChange={(event) => {
            coordinator.setDesiredTitle(event.target.value);
          }}
          onBlur={saveTitle}
        />
      </label>
      <label>
        Рубрика
        <select
          aria-label="Рубрика"
          value={snapshot.desired.rubricId}
          disabled={!editable}
          onChange={(event) => saveRubric(Number(event.target.value))}
        >
          {options.map((rubric) => (
            <option
              key={rubric.id}
              value={rubric.id}
              disabled={!currentRubricIsActive && rubric.id === story.rubric.id}
            >
              {rubric.name}
            </option>
          ))}
        </select>
      </label>
      {snapshot.error ? (
        <p className="editor-metadata-error" role="alert">
          {snapshot.error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={retry}
          >
            Повторить сохранение данных сюжета
          </button>
        </p>
      ) : null}
    </div>
  );
}
