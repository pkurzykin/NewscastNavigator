import type { ScenarioDraft, ScenarioContentSnapshot } from "./types";

// A document nonce, deliberately not sessionStorage: duplicated browser tabs copy
// sessionStorage. Recovery discovers previous documents without owning their writes.
const documentId = crypto.randomUUID();
const adopted = new Set<string>();
export function adoptRecoveredScenarioDraft(storyId: number, userId: number) { adopted.add(baseKey(storyId, userId)); }
const recovered = new Map<string, { key: string; raw: string }>();
const baseKey = (storyId: number, userId: number) => `newscast:scenario-draft:${storyId}:${userId}`;
export function scenarioDraftKey(storyId: number, userId: number): string {
  return `${baseKey(storyId, userId)}:${documentId}`;
}
export function readScenarioDraft(storyId: number, userId: number): ScenarioDraft | null {
  try {
    const base = baseKey(storyId, userId);
    const keys = [scenarioDraftKey(storyId, userId), ...Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i))
      .filter((key): key is string => key !== null && (key === base || key.startsWith(`${base}:`)))];
    let selected: { key: string; raw: string; draft: ScenarioDraft } | null = null;
    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const draft = JSON.parse(raw) as ScenarioDraft;
        if (typeof draft?.revision !== "number" || !Array.isArray(draft.rows)) continue;
        if (draft.default_font_family === undefined) draft.default_font_family = "PT Sans";
        if (!["PT Sans", "Franklin Gothic Book"].includes(draft.default_font_family)) continue;
        if (!selected || (draft.saved_at || "") > (selected.draft.saved_at || "")) selected = { key, raw, draft };
      } catch { /* An invalid older candidate cannot hide a valid one. */ }
    }
    if (!selected) return null;
    recovered.set(base, { key: selected.key, raw: selected.raw });
    return selected.draft;
  } catch { return null; }
}
export function writeScenarioDraft(storyId: number, userId: number, revision: number, snapshot: ScenarioContentSnapshot): void {
  try {
    const draft: ScenarioDraft = { revision, ...snapshot, saved_at: new Date().toISOString() };
    window.localStorage.setItem(scenarioDraftKey(storyId, userId), JSON.stringify(draft));
  } catch { /* Storage failure must not interrupt local editing. */ }
}
export function clearScenarioDraft(storyId: number, userId: number, discardRecovered = false): void {
  try {
    window.localStorage.removeItem(scenarioDraftKey(storyId, userId));
    if (discardRecovered || adopted.has(baseKey(storyId, userId))) {
      const item = recovered.get(baseKey(storyId, userId));
      if (item && window.localStorage.getItem(item.key) === item.raw) window.localStorage.removeItem(item.key);
      recovered.delete(baseKey(storyId, userId));
      adopted.delete(baseKey(storyId, userId));
    }
  } catch { /* no-op */ }
}

export function fieldCandidateKey(storyId: number, userId: number, fieldId: string): string {
  return `newscast:scenario-input:${storyId}:${userId}:${documentId}:${fieldId}`;
}
