import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchNotifications,
  NOTIFICATIONS_INVALIDATED_EVENT,
  readNotification,
} from "../api";
import type { InternalNotification, NotificationDiffChange } from "../types";
import { useSerializedRefresh } from "../useSerializedRefresh";


function rowText(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "—";
  const text = typeof row.text === "string" ? row.text.trim() : "";
  const speaker = typeof row.speaker_text === "string" ? row.speaker_text.trim() : "";
  return text || speaker || "—";
}

function changeLabel(change: NotificationDiffChange): string {
  if (change.kind === "added") return "Добавлена строка";
  if (change.kind === "removed") return "Удалена строка";
  if (change.kind === "moved") return "Строка перемещена";
  return "Строка изменена";
}

function NotificationDiff({ item }: { item: InternalNotification }) {
  if (!item.diff) return null;
  return (
    <details className="notification-diff">
      <summary>Показать изменения</summary>
      <p className="notification-diff-meta">
        Изменений: {item.diff.summary.total}
      </p>
      <ul>
        {item.diff.changes.map((change) => (
          <li key={`${change.segment_uid}:${change.kind}`}>
            <strong>{changeLabel(change)}</strong>
            <span className="notification-diff-before">{rowText(change.before)}</span>
            <span aria-hidden="true">→</span>
            <span className="notification-diff-after">{rowText(change.after)}</span>
          </li>
        ))}
      </ul>
      {item.diff.href ? <a href={item.diff.href}>Открыть diff в истории</a> : null}
    </details>
  );
}

export default function NotificationTray() {
  const [items, setItems] = useState<InternalNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [readError, setReadError] = useState(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (generation: number) => {
    try {
      const response = await fetchNotifications();
      if (!mountedRef.current || generation !== generationRef.current) return;
      setItems(response.items);
      setUnreadCount(response.unread_count);
    } catch {
      // A transient poll failure must not erase the last known notification state.
    }
  }, []);
  const { refreshNow, supersede: supersedeRefresh } = useSerializedRefresh(load);

  useEffect(() => {
    mountedRef.current = true;
    refreshNow();
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, refreshNow);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, refreshNow);
    };
  }, [refreshNow]);

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      requestAnimationFrame(() => toggleRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const markRead = async (notificationId: number) => {
    if (pendingId !== null) return;
    setReadError(false);
    setPendingId(notificationId);
    try {
      await readNotification(notificationId);
      generationRef.current += 1;
      supersedeRefresh();
      if (!mountedRef.current) return;
      setItems((current) => current.filter((item) => item.id !== notificationId));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      if (mountedRef.current) setReadError(true);
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  };

  return (
    <div ref={wrapRef} className="notification-tray-wrap">
      <button
        ref={toggleRef}
        type="button"
        className="notification-tray-toggle"
        aria-label={`Уведомления, непрочитанных: ${unreadCount}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Уведомления
        {unreadCount > 0 ? <span className="notification-badge">{unreadCount}</span> : null}
      </button>
      {open ? (
        <section className="notification-tray" aria-label="Уведомления">
          <header>
            <h2>Уведомления</h2>
            <span>{unreadCount} непрочитанных</span>
          </header>
          {readError ? (
            <p className="notification-error" role="alert">
              Не удалось отметить уведомление прочитанным. Попробуйте ещё раз.
            </p>
          ) : null}
          {items.length === 0 ? <p className="muted">Новых уведомлений нет</p> : null}
          <ul className="notification-list">
            {items.map((item) => (
              <li key={item.id} className="notification-item">
                <strong>{item.title}</strong>
                <span>{item.story.title}</span>
                <p>{item.summary}</p>
                <NotificationDiff item={item} />
                <div className="notification-actions">
                  <a href={item.target_href}>Открыть сюжет</a>
                  <button
                    type="button"
                    className="secondary"
                    disabled={pendingId !== null}
                    onClick={() => { void markRead(item.id); }}
                  >
                    Отметить прочитанным
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
