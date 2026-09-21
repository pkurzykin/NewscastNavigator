import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";

import { createStory } from "../api";
import type { StoryCreateOptions, StoryPriority } from "../types";


interface Props {
  open: boolean;
  options: StoryCreateOptions | null;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onCreated: (storyId: number) => void;
}


export default function CreateStoryDialog({
  open,
  options,
  returnFocusRef,
  onClose,
  onCreated,
}: Props) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [rubricId, setRubricId] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [priority, setPriority] = useState<StoryPriority>("standard");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !options) return;
    setError("");
    setRubricId((current) => current || String(options.rubrics[0]?.id ?? ""));
    setAuthorId((current) => current || String(options.authors[0]?.id ?? ""));
    setPriority(
      (options.priority_options[0]?.code as StoryPriority | undefined) ?? "standard",
    );
    titleRef.current?.focus();
    const focusFrame = requestAnimationFrame(() => {
      titleRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [open, options]);

  if (!options?.create_action) return null;

  const close = () => {
    if (pending) return;
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.isConnected && returnFocusRef.current.focus());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !rubricId || !authorId || pending) return;
    setPending(true);
    setError("");
    try {
      const payload = {
        title: normalizedTitle,
        rubric_id: Number(rubricId),
        author_user_id: Number(authorId),
        priority,
      };
      const ack = await createStory(options.create_action, payload);
      if (!ack.resource) throw new Error("Сервер не вернул созданный сюжет");
      onCreated(ack.resource.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось создать сюжет");
      titleRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      disableAutoFocus
      onClose={(_, reason) => {
        if (reason === "backdropClick" || reason === "escapeKeyDown") close();
      }}
      aria-labelledby="story-create-title"
      slotProps={{ paper: { className: "story-create-dialog" } }}
    >
      <form className="story-create-form" onSubmit={submit}>
        <div className="story-create-title-row">
          <DialogTitle id="story-create-title">Новый сюжет</DialogTitle>
          <IconButton disabled={pending} onClick={close} aria-label="Закрыть">
            <span aria-hidden="true">×</span>
          </IconButton>
        </div>
        <DialogContent className="story-create-content">
          <TextField
            inputRef={titleRef}
            autoFocus
            label="Название"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            slotProps={{ htmlInput: { maxLength: 255, "aria-label": "Название" } }}
          />
          <FormControl fullWidth required size="small">
            <InputLabel id="story-create-rubric-label">Рубрика</InputLabel>
            <Select
              labelId="story-create-rubric-label"
              id="story-create-rubric"
              label="Рубрика"
              value={rubricId}
              onChange={(event) => setRubricId(String(event.target.value))}
              inputProps={{ "aria-label": "Рубрика" }}
            >
              {options.rubrics.map((rubric) => (
                <MenuItem key={rubric.id} value={String(rubric.id)}>{rubric.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth required size="small">
            <InputLabel id="story-create-author-label">Автор</InputLabel>
            <Select
              labelId="story-create-author-label"
              id="story-create-author"
              label="Автор"
              value={authorId}
              onChange={(event) => setAuthorId(String(event.target.value))}
              disabled={options.authors.length === 1}
              inputProps={{ "aria-label": "Автор" }}
            >
              {options.authors.map((author) => (
                <MenuItem key={author.id} value={String(author.id)}>
                  {author.display_name} · {author.position}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel id="story-create-priority-label">Приоритет</InputLabel>
            <Select
              labelId="story-create-priority-label"
              id="story-create-priority"
              label="Приоритет"
              value={priority}
              onChange={(event) => setPriority(event.target.value as StoryPriority)}
              disabled={options.priority_options.length === 1}
              inputProps={{ "aria-label": "Приоритет" }}
            >
              {options.priority_options.map((item) => (
                <MenuItem key={item.code} value={item.code}>{item.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {error ? <Alert severity="error">{error} Можно повторить действие.</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button type="button" variant="outlined" disabled={pending} onClick={close}>Отмена</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={pending || !title.trim() || !rubricId || !authorId}
          >
            {pending ? "Создание…" : "Создать"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
