import { useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { fetchStory, updateStoryManagement } from "../api";
import type { StoryListItem } from "../types";

export type StoryAuthorPatch = Pick<StoryListItem, "author" | "management">;
interface Props {
  story: Pick<StoryListItem, "id" | "title" | "author" | "management">;
  onChanged: (patch: StoryAuthorPatch) => void;
}

export default function StoryAuthorControl({ story, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(String(story.author.id));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const scope = useRef({ storyId: story.id, generation: 0 });
  const pendingRef = useRef(false);
  if (scope.current.storyId !== story.id) {
    scope.current = { storyId: story.id, generation: 0 };
  }
  useEffect(() => {
    setOpen(false);
    setPending(false);
    pendingRef.current = false;
    setError("");
    setAcknowledged(false);
    return () => { scope.current.generation += 1; };
  }, [story.id]);

  const close = () => { if (!pendingRef.current) setOpen(false); };
  const save = async () => {
    if (!story.management || pendingRef.current) return;
    const activeScope = scope.current;
    const generation = ++activeScope.generation;
    const isCurrent = () => scope.current === activeScope && activeScope.generation === generation;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      if (!acknowledged) {
        await updateStoryManagement(story.management.action, { author_user_id: Number(selectedId) });
        if (!isCurrent()) return;
        setAcknowledged(true);
      }
      const updated = await fetchStory(story.id);
      if (!isCurrent()) return;
      // Refresh only this command's metadata; never replace the mounted editor or its title draft.
      onChanged({ author: updated.author, management: updated.management });
      setOpen(false);
    } catch (requestError) {
      if (isCurrent()) setError(requestError instanceof Error ? requestError.message : "Не удалось изменить автора");
    } finally {
      if (isCurrent()) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };
  if (!story.management) return null;
  const options = story.management.author_options;
  return (
    <>
      <Button variant="outlined" onClick={() => {
        setSelectedId(String(story.author.id)); setAcknowledged(false); setError(""); setOpen(true);
      }}>Изменить</Button>
      <Dialog open={open} onClose={close} aria-labelledby="story-author-dialog-title" maxWidth="xs">
        <DialogTitle id="story-author-dialog-title">Изменить автора</DialogTitle>
        <DialogContent>
          <p className="muted small">{story.title}</p>
          <TextField select label="Автор" value={selectedId} disabled={pending || acknowledged}
            slotProps={{ select: { native: true } }}
            onChange={(event) => setSelectedId(event.target.value)}>
            {!options.some((option) => option.id === story.author.id) ? (
              <option value={story.author.id} disabled>{story.author.display_name.trim() || story.author.username} (недоступен)</option>
            ) : null}
            {options.map((option) => <option key={option.id} value={option.id}>{option.display_name.trim() || option.username}</option>)}
          </TextField>
          {error ? <Alert severity="error" sx={{ mt: 3 }}>{error}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button autoFocus variant="outlined" disabled={pending} onClick={close}>Отмена</Button>
          <Button variant="contained" disabled={pending || (!acknowledged && selectedId === String(story.author.id))}
            onClick={() => void save()}>{pending ? "Сохранение..." : acknowledged ? "Повторить обновление" : "Сохранить"}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
