import { useEffect, useState } from "react";

import { fetchPersonalActions } from "../api";
import type { PersonalAction } from "../types";


const PREVIEW_LIMIT = 3;


export default function AttentionQueue() {
  const [items, setItems] = useState<PersonalAction[]>([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
    return () => { active = false; };
  }, []);

  if (!ready || items.length === 0) return null;
  const visibleItems = expanded ? items : items.slice(0, PREVIEW_LIMIT);
  const canToggle = items.length > PREVIEW_LIMIT;

  return (
    <section className="attention-queue" aria-label="Требует внимания">
      <div className="attention-queue-heading">
        <h3>Требует внимания</h3>
        <div className="attention-queue-controls">
          <span>{total}</span>
          {canToggle ? (
            <button
              type="button"
              aria-label={expanded ? "Свернуть список действий" : "Показать все действия"}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Свернуть" : "Показать все"}
            </button>
          ) : null}
        </div>
      </div>
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
