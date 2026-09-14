import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { useRef } from "react";
import type { StoryListItem } from "../types";

export default function ArchiveDeleteDialog({ story, pending, error, onCancel, onConfirm }: {
  story: StoryListItem;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return <Dialog open fullWidth maxWidth="xs" aria-labelledby="archive-delete-title"
    aria-describedby="archive-delete-description" onClose={() => { if (!pending) onCancel(); }}
    slotProps={{ transition: { onEntered: () => cancel.current?.focus() } }}>
    <DialogTitle id="archive-delete-title">Удалить сюжет?</DialogTitle>
    <DialogContent>
      <p><strong>{story.title}</strong></p>
      <p id="archive-delete-description">{story.delete_action?.confirmation
        || "Сюжет и вся его история будут удалены без возможности восстановления."}</p>
      {error ? <Alert severity="error">{error}</Alert> : null}
    </DialogContent>
    <DialogActions>
      <Button ref={cancel} autoFocus disabled={pending} onClick={onCancel}>Отмена</Button>
      <Button variant="contained" color="error" disabled={pending} onClick={onConfirm}>
        {pending ? "Удаление…" : "Удалить навсегда"}
      </Button>
    </DialogActions>
  </Dialog>;
}
