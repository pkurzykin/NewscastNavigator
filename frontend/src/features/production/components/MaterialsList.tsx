import { type FormEvent, useState } from "react";

import { addMaterial } from "../api";
import type { ProductionMaterial, ProductionMutationCoordinator } from "../types";


const formatDateTime = (value: string) => new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "short",
  timeStyle: "short",
}).format(new Date(value));

interface Props {
  storyId: number;
  materials: ProductionMaterial[];
  canAdd: boolean;
  mutationPending: boolean;
  onMutate: ProductionMutationCoordinator;
}

export default function MaterialsList({ storyId, materials, canAdd, mutationPending, onMutate }: Props) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await onMutate(() => addMaterial(storyId, { title: title.trim(), location: location.trim() }));
      setTitle("");
      setLocation("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось добавить материал");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="production-section production-materials" aria-labelledby="production-materials-title">
      <header className="production-section-head">
        <div>
          <p className="production-kicker">Внешние источники</p>
          <h3 id="production-materials-title">Материалы</h3>
        </div>
        <span className="production-count">{materials.length}</span>
      </header>
      {materials.length ? (
        <ul className="production-material-list">
          {materials.map((material) => (
            <li key={material.id}>
              <div className="production-material-copy">
                <strong>{material.title}</strong>
                <span>{material.location}</span>
              </div>
              <small>Добавил: {material.added_by.display_name} · {formatDateTime(material.added_at)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="muted production-empty">Материалы пока не добавлены.</p>}
      {canAdd ? (
        <form className="production-material-form" onSubmit={(event) => void submit(event)}>
          <label>
            Название материала
            <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={255} />
          </label>
          <label>
            Путь или ссылка
            <input value={location} onChange={(event) => setLocation(event.target.value)} required maxLength={4096} />
          </label>
          <button type="submit" className="secondary" disabled={mutationPending || pending}>
            {pending ? "Добавление..." : "Добавить материал"}
          </button>
        </form>
      ) : null}
      {error ? <p className="error production-inline-error" role="alert">{error} Можно повторить действие.</p> : null}
    </section>
  );
}
