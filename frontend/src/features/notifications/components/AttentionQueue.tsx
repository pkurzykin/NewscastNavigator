import { useEffect, useRef, useState } from "react";

import { fetchPersonalActions } from "../api";
import type { PersonalAction } from "../types";


const PREVIEW_LIMIT = 3;


export default function AttentionQueue() {
  const [items, setItems] = useState<PersonalAction[]>([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadAllError, setLoadAllError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void fetchPersonalActions()
      .then((response) => {
        if (active) {
          setItems(response.items);
          setTotal(response.total);
        }
      })
      .catch(() => {
        if (active) {
          setItems([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);

  async function toggleExpanded() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (items.length >= total) {
      setLoadAllError(null);
      setExpanded(true);
      return;
    }

    setLoadingAll(true);
    setLoadAllError(null);
    try {
      const response = await fetchPersonalActions(total);
      if (!mounted.current) return;
      setItems(response.items);
      setTotal(response.total);
      if (response.items.length < response.total) {
        setLoadAllError("Не удалось загрузить все действия. Повторите попытку.");
        return;
      }
      setExpanded(true);
    } catch {
      if (mounted.current) {
        setLoadAllError("Не удалось загрузить все действия. Повторите попытку.");
      }
    } finally {
      if (mounted.current) setLoadingAll(false);
    }
  }

  if (!ready || items.length === 0) return null;
  const visibleItems = expanded ? items : items.slice(0, PREVIEW_LIMIT);
  const canToggle = total > PREVIEW_LIMIT;

  return (
    <section className="attention-queue" aria-label="Требует внимания">
      <div className="attention-queue-heading">
        <h3>Требует внимания</h3>
        <div className="attention-queue-controls">
          <span>{total}</span>
          {canToggle ? (
            <button
              type="button"
              aria-label={
                loadingAll
                  ? "Загружаем все действия"
                  : expanded
                    ? "Свернуть список действий"
                    : "Показать все действия"
              }
              aria-expanded={expanded}
              disabled={loadingAll}
              onClick={() => { void toggleExpanded(); }}
            >
              {loadingAll ? "Загрузка…" : expanded ? "Свернуть" : "Показать все"}
            </button>
          ) : null}
        </div>
      </div>
      {loadingAll ? (
        <p className="attention-queue-message" role="status">Загружаем все действия…</p>
      ) : null}
      {loadAllError ? (
        <p className="attention-queue-message attention-queue-error" role="alert">{loadAllError}</p>
      ) : null}
      <ul>
        {visibleItems.map((item) => (
          <li key={item.id}>
            <span className={`attention-priority attention-priority-${item.story.priority.code}`}>
              {item.story.priority.label}
            </span>
            <span className="attention-copy">
              <strong>{item.story.title}</strong>
              <small>{item.summary}</small>
            </span>
            <a href={item.target_href}>{item.action.label}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
