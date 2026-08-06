import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";

import type { RubricRef } from "../../../shared/contracts";
import {
  getMetadataSaveCoordinator,
  type MetadataSaveCoordinator,
} from "../metadataSaveCoordinator";

interface ScenarioMetadataHeaderProps {
  storyId: number;
  coordinator?: MetadataSaveCoordinator;
  story: {
    id: number;
    title: string;
    rubric: RubricRef;
    duration_text: string | null;
  };
  editable: boolean;
  rubrics: RubricRef[];
  onChanged?: (patch: {
    title?: string;
    rubric?: RubricRef;
    duration_text?: string | null;
  }) => void;
}

export function normalizeStoryTitleInput(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ");
}

function resizeTitle(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export default function ScenarioMetadataHeader({
  storyId,
  coordinator: ownedCoordinator,
  story,
  editable,
  rubrics,
  onChanged,
}: ScenarioMetadataHeaderProps) {
  const coordinator = useMemo(
    () => ownedCoordinator ?? getMetadataSaveCoordinator(storyId, {
      title: story.title,
      rubricId: story.rubric.id,
      durationText: story.duration_text,
    }),
    [ownedCoordinator, storyId],
  );
  const [, rerender] = useReducer((version: number) => version + 1, 0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const rubricsRef = useRef(rubrics);
  rubricsRef.current = rubrics;
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let seenAckVersion = coordinator.snapshot().ackVersion;
    const notifyParent = () => {
      const snapshot = coordinator.snapshot();
      if (snapshot.ackVersion <= seenAckVersion || !snapshot.lastAckPatch) return;
      seenAckVersion = snapshot.ackVersion;
      const changed: {
        title?: string;
        rubric?: RubricRef;
        duration_text?: string | null;
      } = {};
      if (snapshot.lastAckPatch.title !== undefined) {
        changed.title = snapshot.lastAckPatch.title;
      }
      if (snapshot.lastAckPatch.rubric_id !== undefined) {
        const rubric = rubricsRef.current.find(
          (rubric) => rubric.id === snapshot.lastAckPatch?.rubric_id,
        );
        if (rubric !== undefined) changed.rubric = rubric;
      }
      if (snapshot.lastAckPatch.duration_text !== undefined) {
        changed.duration_text = snapshot.lastAckPatch.duration_text;
      }
      onChangedRef.current?.(changed);
    };
    const initial = coordinator.snapshot();
    const initialChanged: {
      title?: string;
      rubric?: RubricRef;
      duration_text?: string | null;
    } = {};
    if (initial.persisted.title !== story.title) {
      initialChanged.title = initial.persisted.title;
    }
    if (initial.persisted.rubricId !== story.rubric.id) {
      const rubric = rubricsRef.current.find(
        (rubric) => rubric.id === initial.persisted.rubricId,
      );
      if (rubric !== undefined) initialChanged.rubric = rubric;
    }
    if (initial.persisted.durationText !== story.duration_text) {
      initialChanged.duration_text = initial.persisted.durationText;
    }
    if (
      initialChanged.title !== undefined
      || initialChanged.rubric !== undefined
      || initialChanged.duration_text !== undefined
    ) {
      onChangedRef.current?.(initialChanged);
    }
    return coordinator.subscribe(() => {
      notifyParent();
      rerender();
    });
  }, [coordinator]);

  const snapshot = coordinator.snapshot();
  useLayoutEffect(() => {
    resizeTitle(titleRef.current);
  }, [snapshot.desired.title]);
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

  const saveDuration = () => {
    if (!editable) return;
    const normalized = coordinator.snapshot().desired.durationText?.trim() || null;
    if (normalized !== coordinator.snapshot().desired.durationText) {
      coordinator.setDesiredDuration(normalized);
    }
    coordinator.queueLatestDesired();
  };

  const retry = () => {
    const normalized = coordinator.snapshot().desired.title.trim();
    if (!normalized) {
      coordinator.setValidationError("Название сюжета не может быть пустым");
      return;
    }
    coordinator.setDesiredTitle(normalized);
    const normalizedDuration = coordinator.snapshot().desired.durationText?.trim() || null;
    coordinator.setDesiredDuration(normalizedDuration);
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
        <textarea
          ref={titleRef}
          className="editor-story-title-input"
          aria-label="Название"
          value={snapshot.desired.title}
          disabled={!editable}
          maxLength={255}
          rows={1}
          onChange={(event) => {
            coordinator.setDesiredTitle(normalizeStoryTitleInput(event.target.value));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
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
      <label>
        Хронометраж
        <input
          aria-label="Хронометраж"
          value={snapshot.desired.durationText ?? ""}
          disabled={!editable}
          maxLength={64}
          onChange={(event) => {
            coordinator.setDesiredDuration(event.target.value);
          }}
          onBlur={saveDuration}
        />
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
