export type NavigationBlocker = () => boolean;

const blockers = new Set<NavigationBlocker>();

export const INTERNAL_NAVIGATION_EVENT = "newscast:internal-navigation";
export const NAVIGATION_CONFIRMATION_EVENT = "newscast:navigation-confirmation";
export const NAVIGATION_CONFIRMATION_CANCEL_EVENT =
  "newscast:navigation-confirmation-cancel";

export interface NavigationConfirmationRequest {
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function registerNavigationBlocker(blocker: NavigationBlocker): () => void {
  blockers.add(blocker);
  return () => blockers.delete(blocker);
}

export function hasBlockedNavigation(): boolean {
  return [...blockers].some((blocker) => blocker());
}

export function cancelPendingNavigationConfirmation(): void {
  window.dispatchEvent(new Event(NAVIGATION_CONFIRMATION_CANCEL_EVENT));
}

export function requestNavigation(
  onConfirm: () => void,
  onCancel?: () => void,
): boolean {
  if (!hasBlockedNavigation()) {
    onConfirm();
    return true;
  }
  window.dispatchEvent(new CustomEvent<NavigationConfirmationRequest>(
    NAVIGATION_CONFIRMATION_EVENT,
    {
      detail: {
        message: "Есть несохранённые изменения. Текстовый черновик останется локально, "
          + "но данные сюжета могут ещё сохраняться. Покинуть редактор?",
        onConfirm,
        onCancel,
      },
    },
  ));
  return false;
}
