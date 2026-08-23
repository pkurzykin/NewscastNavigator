import type { ScenarioRow } from "./types";

export type ScenarioMutationMeta =
  | {
      kind: "typing" | "field";
      groupKey: string;
      timestamp?: number;
    }
  | {
      kind: "formatting" | "structure" | "replace" | "replace-all";
      timestamp?: number;
    };

export interface ScenarioHistoryTransition {
  state: ScenarioHistoryState;
  rows: ScenarioRow[];
}

export interface ScenarioHistorySnapshot {
  rows: ScenarioRow[];
}

export interface ScenarioHistoryState {
  past: ScenarioHistorySnapshot[];
  future: ScenarioHistorySnapshot[];
  lastGroupKey: string | null;
  lastRecordedAt: number;
}

export const SCENARIO_HISTORY_LIMIT = 100;
export const SCENARIO_TYPING_GROUP_MS = 750;

export function breakScenarioHistoryGroup(
  state: ScenarioHistoryState,
): ScenarioHistoryState {
  if (state.lastGroupKey === null && state.lastRecordedAt === 0) return state;
  return {
    ...cloneHistoryState(state),
    lastGroupKey: null,
    lastRecordedAt: 0,
  };
}

function cloneRows(rows: ScenarioRow[]): ScenarioRow[] {
  return structuredClone(rows);
}

function cloneSnapshot(snapshot: ScenarioHistorySnapshot): ScenarioHistorySnapshot {
  return { rows: cloneRows(snapshot.rows) };
}

function cloneHistoryState(state: ScenarioHistoryState): ScenarioHistoryState {
  return {
    past: state.past.map(cloneSnapshot),
    future: state.future.map(cloneSnapshot),
    lastGroupKey: state.lastGroupKey,
    lastRecordedAt: state.lastRecordedAt,
  };
}

function valuesEqual(left: unknown, right: unknown, seen = new Map<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;

  const leftObject = left as object;
  const rightObject = right as object;
  if (seen.get(leftObject) === rightObject) return true;
  seen.set(leftObject, rightObject);

  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date
      && right instanceof Date
      && Object.is(left.getTime(), right.getTime());
  }

  if (left instanceof Map || right instanceof Map) {
    if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
    for (const [leftKey, leftValue] of left) {
      const matchingEntry = [...right.entries()].find(([rightKey]) => valuesEqual(leftKey, rightKey, new Map(seen)));
      if (!matchingEntry || !valuesEqual(leftValue, matchingEntry[1], seen)) return false;
    }
    return true;
  }

  if (left instanceof Set || right instanceof Set) {
    if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false;
    return [...left].every((leftValue) => [...right].some((rightValue) => valuesEqual(leftValue, rightValue, new Map(seen))));
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index], seen));
  }

  const leftKeys = Reflect.ownKeys(left).sort((a, b) => String(a).localeCompare(String(b)));
  const rightKeys = Reflect.ownKeys(right).sort((a, b) => String(a).localeCompare(String(b)));
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => (
    Object.is(key, rightKeys[index])
    && valuesEqual(left[key as keyof typeof left], right[rightKeys[index] as keyof typeof right], seen)
  ));
}

function rowsEqual(left: ScenarioRow[], right: ScenarioRow[]): boolean {
  return valuesEqual(left, right);
}

function mutationTimestamp(meta: ScenarioMutationMeta): number {
  return meta.timestamp ?? Date.now();
}

function isGroupedMutation(
  state: ScenarioHistoryState,
  meta: ScenarioMutationMeta,
  timestamp: number,
): meta is Extract<ScenarioMutationMeta, { groupKey: string }> {
  return (
    (meta.kind === "typing" || meta.kind === "field")
    && state.lastGroupKey === meta.groupKey
    && timestamp >= state.lastRecordedAt
    && timestamp - state.lastRecordedAt <= SCENARIO_TYPING_GROUP_MS
  );
}

export function recordScenarioMutation(
  state: ScenarioHistoryState,
  beforeRows: ScenarioRow[],
  nextRows: ScenarioRow[],
  meta: ScenarioMutationMeta,
): ScenarioHistoryState {
  const nextState = cloneHistoryState(state);
  if (rowsEqual(beforeRows, nextRows)) return nextState;

  const timestamp = mutationTimestamp(meta);
  const grouped = isGroupedMutation(nextState, meta, timestamp);
  const past = grouped
    ? nextState.past
    : [
        ...nextState.past,
        { rows: cloneRows(beforeRows) },
      ].slice(-SCENARIO_HISTORY_LIMIT);

  return {
    past,
    future: [],
    lastGroupKey: meta.kind === "typing" || meta.kind === "field" ? meta.groupKey : null,
    lastRecordedAt: timestamp,
  };
}

export function undoScenarioMutation(
  state: ScenarioHistoryState,
  currentRows: ScenarioRow[],
): ScenarioHistoryTransition | null {
  if (state.past.length === 0) return null;

  const nextState = cloneHistoryState(state);
  const previous = nextState.past.pop() as ScenarioHistorySnapshot;
  nextState.future.unshift({ rows: cloneRows(currentRows) });
  nextState.lastGroupKey = null;
  nextState.lastRecordedAt = 0;

  return {
    state: nextState,
    rows: cloneRows(previous.rows),
  };
}

export function redoScenarioMutation(
  state: ScenarioHistoryState,
  currentRows: ScenarioRow[],
): ScenarioHistoryTransition | null {
  if (state.future.length === 0) return null;

  const nextState = cloneHistoryState(state);
  const next = nextState.future.shift() as ScenarioHistorySnapshot;
  nextState.past.push({ rows: cloneRows(currentRows) });
  nextState.lastGroupKey = null;
  nextState.lastRecordedAt = 0;

  return {
    state: nextState,
    rows: cloneRows(next.rows),
  };
}

export function resetScenarioHistory(): ScenarioHistoryState {
  return {
    past: [],
    future: [],
    lastGroupKey: null,
    lastRecordedAt: 0,
  };
}
