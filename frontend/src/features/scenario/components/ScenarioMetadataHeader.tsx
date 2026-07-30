import { useCallback, useEffect, useRef, useState } from "react";

import { registerNavigationBlocker } from "../../../app/navigationGuard";
import type { RubricRef } from "../../../shared/contracts";
import { updateStoryMetadata } from "../../stories/api";

interface ScenarioMetadataHeaderProps {
  storyId: number;
  story: { id: number; title: string; rubric: RubricRef };
  editable: boolean;
  rubrics: RubricRef[];
  onChanged?: (patch: { title?: string; rubric?: RubricRef }) => void;
}

interface MetadataValues {
  title: string;
  rubricId: number;
}

interface MetadataPatch {
  title?: string;
  rubric_id?: number;
}

export default function ScenarioMetadataHeader({
  storyId,
  story,
  editable,
  rubrics,
  onChanged,
}: ScenarioMetadataHeaderProps) {
  const [title, setTitle] = useState(story.title);
  const [rubricId, setRubricId] = useState(story.rubric.id);
  const [error, setError] = useState("");
  const persistedRef = useRef<MetadataValues>({
    title: story.title,
    rubricId: story.rubric.id,
  });
  const desiredRef = useRef<MetadataValues>({
    title: story.title,
    rubricId: story.rubric.id,
  });
  const queuedPatchRef = useRef<MetadataPatch | null>(null);
  const inFlightPatchRef = useRef<MetadataPatch | null>(null);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const currentRubricIsActive = rubrics.some((rubric) => rubric.id === story.rubric.id);
  const options = currentRubricIsActive
    ? rubrics
    : [story.rubric, ...rubrics];
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const refreshDirty = useCallback(() => {
    const desired = desiredRef.current;
    const persisted = persistedRef.current;
    dirtyRef.current = (
      inFlightRef.current
      || queuedPatchRef.current !== null
      || desired.title !== persisted.title
      || desired.rubricId !== persisted.rubricId
    );
  }, []);

  const desiredPatch = useCallback((): MetadataPatch => {
    const desired = desiredRef.current;
    const persisted = persistedRef.current;
    const inFlight = inFlightPatchRef.current;
    const projected = {
      title: inFlight?.title ?? persisted.title,
      rubricId: inFlight?.rubric_id ?? persisted.rubricId,
    };
    return {
      ...(desired.title !== projected.title ? { title: desired.title } : {}),
      ...(desired.rubricId !== projected.rubricId
        ? { rubric_id: desired.rubricId }
        : {}),
    };
  }, []);

  const drainQueue = useCallback(async () => {
    if (inFlightRef.current || queuedPatchRef.current === null) return;
    const candidate = queuedPatchRef.current;
    queuedPatchRef.current = null;
    const persisted = persistedRef.current;
    const payload: MetadataPatch = {
      ...(candidate.title !== undefined && candidate.title !== persisted.title
        ? { title: candidate.title }
        : {}),
      ...(candidate.rubric_id !== undefined && candidate.rubric_id !== persisted.rubricId
        ? { rubric_id: candidate.rubric_id }
        : {}),
    };
    if (payload.title === undefined && payload.rubric_id === undefined) {
      if (mountedRef.current) setError("");
      refreshDirty();
      return;
    }

    inFlightRef.current = true;
    inFlightPatchRef.current = payload;
    refreshDirty();
    let succeeded = false;
    let receivedNewerPatch = false;
    try {
      await updateStoryMetadata(storyId, payload);
      if (payload.title !== undefined) persistedRef.current.title = payload.title;
      if (payload.rubric_id !== undefined) {
        persistedRef.current.rubricId = payload.rubric_id;
      }
      succeeded = true;
      if (mountedRef.current) {
        const changed: { title?: string; rubric?: RubricRef } = {};
        if (payload.title !== undefined) changed.title = payload.title;
        if (payload.rubric_id !== undefined) {
          changed.rubric = optionsRef.current.find(
            (rubric) => rubric.id === payload.rubric_id,
          );
        }
        setError("");
        onChangedRef.current?.(changed);
      }
    } catch (requestError) {
      const newerPatch = queuedPatchRef.current;
      receivedNewerPatch = newerPatch !== null;
      queuedPatchRef.current = {
        ...payload,
        ...(newerPatch ?? {}),
      };
      if (mountedRef.current) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Не удалось сохранить данные сюжета",
        );
      }
    } finally {
      inFlightRef.current = false;
      inFlightPatchRef.current = null;
      refreshDirty();
      if (
        queuedPatchRef.current !== null
        && (succeeded || receivedNewerPatch)
      ) {
        void drainQueue();
      }
    }
  }, [refreshDirty, storyId]);

  const queueLatestDesired = useCallback(() => {
    const latest = desiredPatch();
    if (latest.title === undefined && latest.rubric_id === undefined) {
      queuedPatchRef.current = null;
      refreshDirty();
      return;
    }
    queuedPatchRef.current = latest;
    refreshDirty();
    void drainQueue();
  }, [desiredPatch, drainQueue, refreshDirty]);

  useEffect(() => {
    mountedRef.current = true;
    const isDirty = () => dirtyRef.current;
    const unregisterNavigationBlocker = registerNavigationBlocker(isDirty);
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      mountedRef.current = false;
      unregisterNavigationBlocker();
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, []);

  const saveTitle = () => {
    const normalized = desiredRef.current.title.trim();
    if (!editable) return;
    if (!normalized) {
      setError("Название сюжета не может быть пустым");
      refreshDirty();
      return;
    }
    if (normalized !== desiredRef.current.title) {
      desiredRef.current.title = normalized;
      setTitle(normalized);
    }
    queueLatestDesired();
  };

  const saveRubric = (nextRubricId: number) => {
    desiredRef.current.rubricId = nextRubricId;
    setRubricId(nextRubricId);
    refreshDirty();
    queueLatestDesired();
  };

  const retry = () => {
    const normalized = desiredRef.current.title.trim();
    if (!normalized) {
      setError("Название сюжета не может быть пустым");
      return;
    }
    desiredRef.current.title = normalized;
    setTitle(normalized);
    setError("");
    queueLatestDesired();
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
          onChange={(event) => {
            desiredRef.current.title = event.target.value;
            setTitle(event.target.value);
            refreshDirty();
          }}
          onBlur={saveTitle}
        />
      </label>
      <label>
        Рубрика
        <select
          aria-label="Рубрика"
          value={rubricId}
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
      {error ? (
        <p className="editor-metadata-error" role="alert">
          {error}{" "}
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
