import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import { releaseNoteStorageKey, type ReleaseNote } from "./releaseNotes";

interface Props {
  userId: number;
  version: string;
  releaseNote: ReleaseNote | null | undefined;
  onDismiss: () => void;
}

function wasSeen(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden"));
}

function isAvailableFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  if (
    (element instanceof HTMLButtonElement
      || element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement)
    && element.disabled
  ) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function focusProgrammaticTarget(element: HTMLElement | null): boolean {
  if (!isAvailableFocusTarget(element)) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

function focusSequentialTarget(element: HTMLElement | null): boolean {
  if (!isAvailableFocusTarget(element) || element.tabIndex < 0) return false;
  return focusProgrammaticTarget(element);
}

function focusFallback(): void {
  const selector = 'button:not([disabled]), [href], input:not([disabled]), '
    + 'select:not([disabled]), textarea:not([disabled]), '
    + '[contenteditable="true"], [tabindex]:not([tabindex="-1"])';
  const roots = [document.querySelector<HTMLElement>("main"), document.querySelector<HTMLElement>(".app-shell-header")];
  for (const root of roots) {
    if (!root) continue;
    if (focusSequentialTarget(root)) return;
    for (const candidate of root.querySelectorAll<HTMLElement>(selector)) {
      if (focusSequentialTarget(candidate)) return;
    }
  }
}

const PAGE_SHORTCUT_KEYS = new Set(["d", "f", "h", "y", "z"]);

export default function WhatsNewDialog({
  userId,
  version,
  releaseNote,
  onDismiss,
}: Props) {
  const storageKey = useMemo(() => (
    releaseNote?.version === version ? releaseNoteStorageKey(userId, version) : null
  ), [releaseNote, userId, version]);
  const [, renderDismissal] = useReducer((revision: number) => revision + 1, 0);
  const dismissedKeysRef = useRef(new Set<string>());
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const focusSessionKeyRef = useRef<string | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const open = Boolean(
    storageKey
    && releaseNote
    && !dismissedKeysRef.current.has(storageKey)
    && !wasSeen(storageKey),
  );
  if (open && focusSessionKeyRef.current !== storageKey) {
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (activeElement && activeElement !== document.body) {
      previousFocusRef.current = activeElement;
    }
    focusSessionKeyRef.current = storageKey;
  }

  const dismiss = useCallback(() => {
    if (!storageKey || dismissedKeysRef.current.has(storageKey)) return;
    dismissedKeysRef.current.add(storageKey);
    renderDismissal();
    try {
      window.localStorage.setItem(storageKey, "seen");
    } catch {
      // The current mount remains dismissed even when browser storage is unavailable.
    }
    const returnTarget = previousFocusRef.current;
    const dismissedDialog = dialogRef.current;
    returnTarget?.closest<HTMLElement>('[aria-hidden="true"]')?.removeAttribute("aria-hidden");
    onDismiss();
    focusSessionKeyRef.current = null;
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
    }
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      const activeElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      if (
        activeElement !== document.body
        && isAvailableFocusTarget(activeElement)
        && !dismissedDialog?.contains(activeElement)
      ) return;
      if (!focusProgrammaticTarget(returnTarget)) focusFallback();
    });
  }, [onDismiss, storageKey]);
  const focusContinue = useCallback((node: HTMLButtonElement | null) => {
    continueRef.current = node;
    node?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
    continueRef.current?.focus({ preventScroll: true });

    const handleKeyboard = (event: KeyboardEvent) => {
      event.stopPropagation();
      const pageShortcut = (event.metaKey || event.ctrlKey)
        && PAGE_SHORTCUT_KEYS.has(event.key.toLowerCase());
      if (pageShortcut) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", handleKeyboard, true);
    return () => document.removeEventListener("keydown", handleKeyboard, true);
  }, [dismiss, open, storageKey]);

  useLayoutEffect(() => () => {
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
  }, [storageKey]);

  if (!open || !releaseNote || !storageKey) return null;

  return (
    <Dialog
      open
      onClose={dismiss}
      aria-labelledby="whats-new-title"
      disableAutoFocus
      disableEnforceFocus
      disableRestoreFocus
      slotProps={{ paper: { className: "whats-new-dialog" } }}
    >
      <div
        ref={dialogRef}
        className="whats-new-content"
        tabIndex={-1}
      >
        <DialogTitle id="whats-new-title">{releaseNote.title}</DialogTitle>
        <DialogContent className="whats-new-body">
          <p className="whats-new-kicker">обновление редактора</p>
          <p className="whats-new-intro">{releaseNote.intro}</p>
          <ul>
            {releaseNote.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            ref={focusContinue}
            type="button"
            className="whats-new-continue"
            onClick={dismiss}
          >
            Продолжить работу
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}
