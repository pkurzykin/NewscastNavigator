import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import {
  type FormEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { createRubric, updateRubric } from "../api";
import type { RubricManagementItem, RubricManagementState } from "../types";


interface Props {
  open: boolean;
  management: RubricManagementState | null;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}


export default function RubricManagementDialog({
  open,
  management,
  returnFocusRef,
  onClose,
  onChanged,
}: Props) {
  const createInputRef = useRef<HTMLInputElement>(null);
  const draftNamesRef = useRef<Record<number, string>>({});
  const serverNamesRef = useRef<Record<number, string>>({});
  const wasOpenRef = useRef(false);
  const [newName, setNewName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<number, string>>({});
  const [pendingKey, setPendingKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !management) {
      if (!open) {
        wasOpenRef.current = false;
        draftNamesRef.current = {};
        serverNamesRef.current = {};
      }
      return;
    }
    const previousServerNames = wasOpenRef.current
      ? serverNamesRef.current
      : {};
    const previousDraftNames = wasOpenRef.current
      ? draftNamesRef.current
      : {};
    const nextServerNames = Object.fromEntries(
      management.items.map((item) => [item.id, item.name]),
    );
    const nextDraftNames = Object.fromEntries(
      management.items.map((item) => {
        const previousServerName = previousServerNames[item.id];
        const previousDraftName = previousDraftNames[item.id];
        const hasUnsavedDraft = (
          previousServerName !== undefined
          && previousDraftName !== undefined
          && previousDraftName !== previousServerName
        );
        return [item.id, hasUnsavedDraft ? previousDraftName : item.name];
      }),
    );
    wasOpenRef.current = true;
    serverNamesRef.current = nextServerNames;
    draftNamesRef.current = nextDraftNames;
    setDraftNames(nextDraftNames);
    setError("");
  }, [management, open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => createInputRef.current?.focus());
  }, [open]);

  if (!open || !management) return null;

  const close = () => {
    if (pendingKey) return;
    onClose();
    requestAnimationFrame(() => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    });
  };

  const run = async (key: string, command: () => Promise<unknown>) => {
    if (pendingKey) return;
    setPendingKey(key);
    setError("");
    try {
      await command();
      await onChanged();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось изменить рубрики",
      );
    } finally {
      setPendingKey("");
    }
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const normalized = newName.trim();
    if (!normalized) return;
    void run("create", async () => {
      await createRubric(management.create_action, normalized);
      setNewName("");
    });
  };

  const saveName = (item: RubricManagementItem) => {
    const normalized = (draftNames[item.id] ?? "").trim();
    if (!normalized || normalized === item.name) return;
    void run(`name:${item.id}`, () => updateRubric(
      item.update_action,
      { name: normalized },
    ));
  };

  const toggleActive = (item: RubricManagementItem) => {
    void run(`active:${item.id}`, () => updateRubric(
      item.update_action,
      { is_active: !item.is_active },
    ));
  };

  return (
    <Dialog
      open
      fullWidth
      maxWidth="md"
      aria-labelledby="rubric-management-title"
      onClose={(_event, _reason) => close()}
      slotProps={{
        paper: {
          "aria-busy": Boolean(pendingKey),
          className: "rubric-management-dialog",
        },
      }}
    >
      <div className="rubric-management-title">
        <DialogTitle id="rubric-management-title">Управление рубриками</DialogTitle>
        <IconButton
          type="button"
          size="small"
          disabled={Boolean(pendingKey)}
          onClick={close}
          aria-label="Закрыть"
        >
          ×
        </IconButton>
      </div>
      <DialogContent dividers className="rubric-management-content">
        <form className="rubric-create-form" onSubmit={submitCreate}>
          <TextField
            inputRef={createInputRef}
            label="Название новой рубрики"
            value={newName}
            disabled={Boolean(pendingKey)}
            slotProps={{ htmlInput: { maxLength: 120 } }}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={Boolean(pendingKey) || !newName.trim()}
          >
            {pendingKey === "create" ? "Создание..." : "Создать рубрику"}
          </Button>
        </form>
        {error ? <Alert severity="error">{error} Можно повторить действие.</Alert> : null}
        <div className="rubric-management-list">
          {management.items.map((item) => (
            <section className="rubric-management-row" key={item.id}>
              <TextField
                label="Название рубрики"
                value={draftNames[item.id] ?? item.name}
                disabled={Boolean(pendingKey)}
                slotProps={{
                  htmlInput: {
                    "aria-label": `Название рубрики ${item.name}`,
                    maxLength: 120,
                  },
                }}
                onChange={(event) => {
                  const next = {
                    ...draftNamesRef.current,
                    [item.id]: event.target.value,
                  };
                  draftNamesRef.current = next;
                  setDraftNames(next);
                }}
              />
              <Chip
                size="small"
                variant="outlined"
                color={item.is_active ? "primary" : "default"}
                label={item.is_active ? "Активна" : "Отключена"}
              />
              <Button
                type="button"
                variant="outlined"
                size="small"
                aria-label={`Сохранить рубрику ${item.name}`}
                disabled={
                  Boolean(pendingKey)
                  || !(draftNames[item.id] ?? "").trim()
                  || (draftNames[item.id] ?? "").trim() === item.name
                }
                onClick={() => saveName(item)}
              >
                {pendingKey === `name:${item.id}` ? "Сохранение..." : "Сохранить"}
              </Button>
              <Button
                type="button"
                variant="outlined"
                size="small"
                aria-label={`${item.is_active ? "Отключить" : "Включить"} рубрику ${item.name}`}
                disabled={Boolean(pendingKey)}
                onClick={() => toggleActive(item)}
              >
                {pendingKey === `active:${item.id}`
                  ? "Сохранение..."
                  : item.is_active ? "Отключить" : "Включить"}
              </Button>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
