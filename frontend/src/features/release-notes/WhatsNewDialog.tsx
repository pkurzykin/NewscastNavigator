import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

export default function WhatsNewDialog({
  userId,
  version,
  releaseNote,
  onDismiss,
}: Props) {
  const storageKey = useMemo(() => (
    releaseNote?.version === version ? releaseNoteStorageKey(userId, version) : null
  ), [releaseNote, userId, version]);
  const [seenKey, setSeenKey] = useState<string | null>(() => (
    storageKey && wasSeen(storageKey) ? storageKey : null
  ));
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const open = Boolean(
    storageKey
    && releaseNote
    && seenKey !== storageKey
    && dismissedKey !== storageKey,
  );

  useEffect(() => {
    closingRef.current = false;
    if (!storageKey) {
      setSeenKey(null);
      setDismissedKey(null);
      return;
    }
    setSeenKey(wasSeen(storageKey) ? storageKey : null);
    setDismissedKey((current) => current === storageKey ? current : null);
  }, [storageKey]);

  const dismiss = useCallback(() => {
    if (!storageKey || closingRef.current) return;
    closingRef.current = true;
    setDismissedKey(storageKey);
    try {
      window.localStorage.setItem(storageKey, "seen");
    } catch {
      // The current mount remains dismissed even when browser storage is unavailable.
    }
    onDismiss();
    const returnTarget = previousFocusRef.current;
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
    }
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    });
  }, [onDismiss, storageKey]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    continueRef.current?.focus({ preventScroll: true });

    const handleKeyboard = (event: KeyboardEvent) => {
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
    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, [dismiss, open]);

  useEffect(() => () => {
    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
    }
  }, []);

  if (!open || !releaseNote || !storageKey) return null;

  return (
    <div
      className="whats-new-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className="whats-new-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        tabIndex={-1}
      >
        <p className="whats-new-kicker">обновление редактора</p>
        <h2 id="whats-new-title">{releaseNote.title}</h2>
        <p className="whats-new-intro">{releaseNote.intro}</p>
        <ul>
          {releaseNote.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <button
          ref={continueRef}
          type="button"
          className="primary"
          onClick={dismiss}
        >
          Продолжить работу
        </button>
      </div>
    </div>
  );
}
