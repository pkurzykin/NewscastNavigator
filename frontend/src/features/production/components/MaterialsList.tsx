import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
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
  const [open, setOpen] = useState(false);
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
      setOpen(false);
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
          <h3 id="production-materials-title">Материалы</h3>
        </div>
        {canAdd ? <Button disabled={mutationPending || pending} onClick={() => setOpen(true)}>Добавить материал</Button> : null}
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
        <Dialog open={open} onClose={() => { if (!pending) setOpen(false); }} aria-labelledby="material-dialog-title">
          <DialogTitle id="material-dialog-title">Добавить материал</DialogTitle>
          <DialogContent>
        <form id="production-material-form" className="production-material-form" onSubmit={(event) => void submit(event)}>
          <label>
            Название материала
            <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={255} />
          </label>
          <label>
            Путь или ссылка
            <input value={location} onChange={(event) => setLocation(event.target.value)} required maxLength={4096} />
          </label>
        </form>
        {error ? <p className="error production-inline-error" role="alert">{error} Можно повторить действие.</p> : null}
          </DialogContent>
          <DialogActions>
            <Button autoFocus variant="outlined" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button>
            <Button type="submit" form="production-material-form" variant="contained" disabled={mutationPending || pending}>
              {pending ? "Добавление..." : "Добавить"}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </section>
  );
}
