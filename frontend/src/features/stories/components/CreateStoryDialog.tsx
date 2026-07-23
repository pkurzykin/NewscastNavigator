import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";

import { createStory } from "../api";
import type { StoryCreateOptions } from "../types";


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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [rubricId, setRubricId] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !options) return;
    setError("");
    setRubricId((current) => current || String(options.rubrics[0]?.id ?? ""));
    setAuthorId((current) => current || String(options.authors[0]?.id ?? ""));
    titleRef.current?.focus();
  }, [open, options]);

  useEffect(() => {
    if (!open) return;
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
        requestAnimationFrame(() => returnFocusRef.current?.isConnected && returnFocusRef.current.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])",
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
  }, [onClose, open, pending, returnFocusRef]);

  if (!open || !options?.create_action) return null;

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
      const payload: { title: string; rubric_id: number; author_user_id?: number } = {
        title: normalizedTitle,
        rubric_id: Number(rubricId),
      };
      if (options.authors.length > 1) payload.author_user_id = Number(authorId);
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
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div
        ref={dialogRef}
        className="story-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-create-title"
      >
        <header>
          <h2 id="story-create-title">Новый сюжет</h2>
          <button type="button" className="text-button" disabled={pending} onClick={close} aria-label="Закрыть">×</button>
        </header>
        <form onSubmit={submit}>
          <label>
            Название
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={255}
            />
          </label>
          <label>
            Рубрика
            <select value={rubricId} onChange={(event) => setRubricId(event.target.value)} required>
              {options.rubrics.map((rubric) => (
                <option key={rubric.id} value={rubric.id}>{rubric.name}</option>
              ))}
            </select>
          </label>
          <label>
            Автор
            <select
              value={authorId}
              onChange={(event) => setAuthorId(event.target.value)}
              required
              disabled={options.authors.length === 1}
            >
              {options.authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.display_name} · {author.position}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="error" role="alert">{error} Можно повторить действие.</p> : null}
          <footer>
            <button
              type="submit"
              className="primary"
              disabled={pending || !title.trim() || !rubricId || !authorId}
            >
              {pending ? "Создание..." : "Создать"}
            </button>
            <button type="button" className="secondary" disabled={pending} onClick={close}>Отмена</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
