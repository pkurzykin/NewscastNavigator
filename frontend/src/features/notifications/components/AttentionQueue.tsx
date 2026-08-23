import { useCallback, useEffect, useRef, useState } from "react";

import { fetchPersonalActions, NOTIFICATIONS_INVALIDATED_EVENT } from "../api";
import type { PersonalAction } from "../types";
import { useSerializedRefresh } from "../useSerializedRefresh";


const PREVIEW_LIMIT = 3;
const INITIAL_LIMIT = 20;


export default function AttentionQueue() {
  const [items, setItems] = useState<PersonalAction[]>([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadAllError, setLoadAllError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);
  const generationRef = useRef(0);
  const limitRef = useRef(INITIAL_LIMIT);
  const fullLoadPendingRef = useRef(false);

  const load = useCallback(async (generation: number) => {
    try {
      const response = await fetchPersonalActions(limitRef.current);
      if (!mounted.current || generation !== generationRef.current) return;
      setItems(response.items);
      setTotal(response.total);
      if (fullLoadPendingRef.current) {
        fullLoadPendingRef.current = false;
        setLoadingAll(false);
        if (response.items.length < response.total) {
          setLoadAllError("Не удалось загрузить все действия. Повторите попытку.");
          return;
        }
        limitRef.current = response.total;
        setLoadAllError(null);
        setExpanded(true);
      }
    } catch {
      if (!mounted.current || generation !== generationRef.current) return;
      if (fullLoadPendingRef.current) {
        fullLoadPendingRef.current = false;
        setLoadingAll(false);
        setLoadAllError("Не удалось загрузить все действия. Повторите попытку.");
      }
    } finally {
      if (mounted.current && generation === generationRef.current) setReady(true);
    }
  }, []);
  const { refreshNow, supersede: supersedeRefresh } = useSerializedRefresh(load);

  useEffect(() => {
    mounted.current = true;
    refreshNow();
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, refreshNow);
    return () => {
      mounted.current = false;
      window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, refreshNow);
    };
  }, [refreshNow]);

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

    limitRef.current = total;
    fullLoadPendingRef.current = true;
    setLoadingAll(true);
    setLoadAllError(null);
    generationRef.current += 1;
    supersedeRefresh();
    refreshNow();
  }

  if (!ready) return null;
  if (items.length === 0) {
    return <span hidden data-attention-state="empty" />;
  }
  const visibleItems = expanded ? items : items.slice(0, PREVIEW_LIMIT);
  const canToggle = total > PREVIEW_LIMIT;

  return (
    <section
      className="attention-queue"
      aria-label="Требует внимания"
      data-attention-state="ready"
    >
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
