import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { type FormEvent, useRef, useState } from "react";

import { addMaterial } from "../api";
import MaterialLocation from "./MaterialLocation";
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
  const submittingRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const busy = mutationPending || pending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mutationPending || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError("");
    try {
      await onMutate(() => addMaterial(storyId, { title: title.trim(), location: location.trim() }));
      setTitle("");
      setLocation("");
      setOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось добавить материал");
      requestAnimationFrame(() => titleRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  };

  return (
    <section className="production-section production-materials" aria-labelledby="production-materials-title">
      <header className="production-section-head">
        <div>
          <h3 id="production-materials-title">Материалы</h3>
        </div>
        {canAdd ? <Button variant="outlined" disabled={busy} onClick={() => setOpen(true)}>Добавить материал</Button> : null}
      </header>
      {materials.length ? (
        <ul className="production-material-list">
          {materials.map((material) => (
            <li key={material.id}>
              <div className="production-material-copy">
                <strong>{material.title}</strong>
                <MaterialLocation key={material.location} location={material.location} />
              </div>
              <small>Добавил: {material.added_by.display_name} · {formatDateTime(material.added_at)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="muted production-empty">Материалы пока не добавлены.</p>}
      {canAdd ? (
        <Dialog
          open={open}
          onClose={() => { if (!busy) setOpen(false); }}
          aria-labelledby="material-dialog-title"
          slotProps={{ paper: { "aria-busy": busy } }}
        >
          <DialogTitle id="material-dialog-title">Добавить материал</DialogTitle>
          <DialogContent>
        <form id="production-material-form" className="production-material-form" onSubmit={(event) => void submit(event)}>
          <TextField
            label="Название материала"
            inputRef={titleRef}
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            slotProps={{ htmlInput: { maxLength: 255, "aria-label": "Название материала" } }}
          />
          <TextField
            label="Путь или ссылка"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            required
            slotProps={{ htmlInput: { maxLength: 4096, "aria-label": "Путь или ссылка" } }}
          />
        </form>
        {error ? <Alert severity="error">{error} Можно повторить действие.</Alert> : null}
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" disabled={busy} onClick={() => setOpen(false)}>Отмена</Button>
            <Button type="submit" form="production-material-form" variant="contained" disabled={busy}>
              {pending ? "Добавление..." : "Добавить"}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </section>
  );
}
