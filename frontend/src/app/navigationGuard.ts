export type NavigationBlocker = () => boolean;

const blockers = new Set<NavigationBlocker>();

export const INTERNAL_NAVIGATION_EVENT = "newscast:internal-navigation";

export function registerNavigationBlocker(blocker: NavigationBlocker): () => void {
  blockers.add(blocker);
  return () => blockers.delete(blocker);
}

export function hasBlockedNavigation(): boolean {
  return [...blockers].some((blocker) => blocker());
}

export function confirmNavigationAway(): boolean {
  if (!hasBlockedNavigation()) return true;
  return window.confirm(
    "Есть несохранённые изменения. Они останутся в локальном черновике. Покинуть редактор?",
  );
}
