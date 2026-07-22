import { useEffect, useState } from "react";

import { fetchPersonalActions } from "../api";
import type { PersonalAction } from "../types";


export default function AttentionQueue() {
  const [items, setItems] = useState<PersonalAction[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchPersonalActions()
      .then((response) => {
        if (active) setItems(response.items);
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, []);

  if (!ready || items.length === 0) return null;

  return (
    <section className="attention-queue" aria-label="Требует внимания">
      <div className="attention-queue-heading">
        <h3>Требует внимания</h3>
        <span>{items.length}</span>
      </div>
      <ul>
        {items.map((item) => (
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
