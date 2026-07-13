import type { ScenarioDraft, ScenarioRow } from "./types";

export function scenarioDraftKey(storyId: number, userId: number): string {
  return `newscast:scenario-draft:${storyId}:${userId}`;
}

export function readScenarioDraft(storyId: number, userId: number): ScenarioDraft | null {
  try {
    const raw = window.localStorage.getItem(scenarioDraftKey(storyId, userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as ScenarioDraft;
    return typeof value?.revision === "number" && Array.isArray(value.rows) ? value : null;
  } catch {
    return null;
  }
}

export function writeScenarioDraft(storyId: number, userId: number, revision: number, rows: ScenarioRow[]): void {
  try {
    const draft: ScenarioDraft = { revision, rows, saved_at: new Date().toISOString() };
    window.localStorage.setItem(scenarioDraftKey(storyId, userId), JSON.stringify(draft));
  } catch {
    // A full or unavailable browser storage must not interrupt local editing.
  }
}

export function clearScenarioDraft(storyId: number, userId: number): void {
  try { window.localStorage.removeItem(scenarioDraftKey(storyId, userId)); } catch { /* no-op */ }
}
