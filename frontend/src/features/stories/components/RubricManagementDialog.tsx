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
  const dialogRef = useRef<HTMLDivElement>(null);
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
    createInputRef.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingKey) {
        event.preventDefault();
        onClose();
        requestAnimationFrame(() => {
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
        });
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [onClose, open, pendingKey, returnFocusRef]);

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
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="rubric-management-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rubric-management-title"
      >
        <header>
          <div>
            <p className="muted small">справочник реестра</p>
            <h2 id="rubric-management-title">Управление рубриками</h2>
          </div>
          <button
            type="button"
            className="text-button"
            disabled={Boolean(pendingKey)}
            onClick={close}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>
        <form className="rubric-create-form" onSubmit={submitCreate}>
          <label>
            Название новой рубрики
            <input
              ref={createInputRef}
              value={newName}
              maxLength={120}
              disabled={Boolean(pendingKey)}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="primary"
            disabled={Boolean(pendingKey) || !newName.trim()}
          >
            {pendingKey === "create" ? "Создание..." : "Создать рубрику"}
          </button>
        </form>
        {error ? <p className="error" role="alert">{error} Можно повторить действие.</p> : null}
        <div className="rubric-management-list">
          {management.items.map((item) => (
            <section className="rubric-management-row" key={item.id}>
              <label>
                Название рубрики {item.name}
                <input
                  aria-label={`Название рубрики ${item.name}`}
                  value={draftNames[item.id] ?? item.name}
                  maxLength={120}
                  disabled={Boolean(pendingKey)}
                  onChange={(event) => {
                    const next = {
                      ...draftNamesRef.current,
                      [item.id]: event.target.value,
                    };
                    draftNamesRef.current = next;
                    setDraftNames(next);
                  }}
                />
              </label>
              <span className={item.is_active ? "status-chip" : "status-chip muted"}>
                {item.is_active ? "Активна" : "Отключена"}
              </span>
              <button
                type="button"
                className="secondary"
                aria-label={`Сохранить рубрику ${item.name}`}
                disabled={
                  Boolean(pendingKey)
                  || !(draftNames[item.id] ?? "").trim()
                  || (draftNames[item.id] ?? "").trim() === item.name
                }
                onClick={() => saveName(item)}
              >
                {pendingKey === `name:${item.id}` ? "Сохранение..." : "Сохранить"}
              </button>
              <button
                type="button"
                className="secondary"
                aria-label={`${item.is_active ? "Отключить" : "Включить"} рубрику ${item.name}`}
                disabled={Boolean(pendingKey)}
                onClick={() => toggleActive(item)}
              >
                {pendingKey === `active:${item.id}`
                  ? "Сохранение..."
                  : item.is_active ? "Отключить" : "Включить"}
              </button>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
