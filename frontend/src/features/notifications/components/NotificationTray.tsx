import { useEffect, useState } from "react";

import {
  fetchNotifications,
  NOTIFICATIONS_INVALIDATED_EVENT,
  readNotification,
} from "../api";
import type { InternalNotification, NotificationDiffChange } from "../types";


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
        Редакции {item.diff.from_revision} → {item.diff.to_revision}
        {` · изменений: ${item.diff.summary.total}`}
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

  useEffect(() => {
    let active = true;
    let requestId = 0;
    const load = () => {
      const currentRequest = requestId + 1;
      requestId = currentRequest;
      void fetchNotifications()
        .then((response) => {
          if (active && currentRequest === requestId) {
            setItems(response.items);
            setUnreadCount(response.unread_count);
          }
        })
        .catch(() => {
          if (active && currentRequest === requestId) {
            setItems([]);
            setUnreadCount(0);
          }
        });
    };
    load();
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, load);
    };
  }, []);

  const markRead = async (notificationId: number) => {
    if (pendingId !== null) return;
    setReadError(false);
    setPendingId(notificationId);
    try {
      await readNotification(notificationId);
      setItems((current) => current.filter((item) => item.id !== notificationId));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      setReadError(true);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="notification-tray-wrap">
      <button
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
