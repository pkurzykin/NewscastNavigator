import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { createEmptyProject, fetchUsers } from "../shared/api";
import { userRoleLabel } from "../shared/labels";
import type {
  ProjectActionResponse,
  ProjectCreatePayload,
  UserListItem,
} from "../shared/types";

type CreationMode = "source" | "story";

interface CreateProjectDialogProps {
  open: boolean;
  token: string;
  canCreateStory: boolean;
  onClose: () => void;
  onCreated: (payload: ProjectActionResponse) => Promise<void>;
}

const emptyPayload = {
  storyDate: "",
  title: "",
  rubric: "",
  sourcePath: "",
  authorUserId: "",
  proofreaderUserId: "",
  editAssigneeUserId: "",
  titlesAssigneeUserId: "",
};

function userOptionLabel(user: UserListItem): string {
  const name = user.full_name?.trim() || user.username;
  return `${name} · ${userRoleLabel(user.role)}`;
}

function optionalUserId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function usersByRole(users: UserListItem[], roles: string[]): UserListItem[] {
  const allowed = new Set(roles);
  return users.filter((user) => user.is_active && allowed.has((user.role || "").toLowerCase()));
}

export default function CreateProjectDialog({
  open,
  token,
  canCreateStory,
  onClose,
  onCreated,
}: CreateProjectDialogProps) {
  const [mode, setMode] = useState<CreationMode>("source");
  const [form, setForm] = useState(emptyPayload);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const authorUsers = useMemo(
    () => usersByRole(users, ["admin", "editor", "author", "proofreader"]),
    [users]
  );
  const proofreaderUsers = useMemo(() => usersByRole(users, ["proofreader"]), [users]);
  const editUsers = useMemo(() => usersByRole(users, ["admin", "editor", "montager"]), [users]);
  const titlesUsers = useMemo(() => usersByRole(users, ["admin", "editor", "designer"]), [users]);

  useEffect(() => {
    if (!open || mode !== "story") {
      return;
    }
    setError("");
    setLoadingUsers(true);
    fetchUsers(token)
      .then((payload) => setUsers(payload.items))
      .catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Не удалось загрузить список участников"
        );
      })
      .finally(() => setLoadingUsers(false));
  }, [mode, open, token]);

  useEffect(() => {
    if (!open) {
      setForm(emptyPayload);
      setMode("source");
      setError("");
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!canCreateStory && mode === "story") {
      setMode("source");
    }
  }, [canCreateStory, mode]);

  if (!open) {
    return null;
  }

  function updateField(field: keyof typeof emptyPayload, value: string): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    if (!form.title.trim()) {
      setError("Укажите название карточки");
      return;
    }
    if (mode === "source" && !form.storyDate) {
      setError("Для исходников укажите дату материала");
      return;
    }
    if (mode === "source" && !form.sourcePath.trim()) {
      setError("Для исходников укажите путь в архиве");
      return;
    }
    if (mode === "story" && !form.rubric.trim()) {
      setError("Для сюжета в работу укажите рубрику");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const payload: ProjectCreatePayload = {
        creation_mode: mode,
        title: form.title.trim(),
        source_path: form.sourcePath.trim() || null,
        story_date: form.storyDate || null,
      };
      if (mode === "story") {
        payload.rubric = form.rubric.trim();
        payload.author_user_id = optionalUserId(form.authorUserId);
        payload.proofreader_user_id = optionalUserId(form.proofreaderUserId);
        payload.edit_assignee_user_id = optionalUserId(form.editAssigneeUserId);
        payload.titles_assignee_user_id = optionalUserId(form.titlesAssigneeUserId);
      }

      const created = await createEmptyProject(token, payload);
      await onCreated(created);
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось создать карточку"
      );
    } finally {
      setSubmitting(false);
    }
  }

  function renderUserSelect(
    label: string,
    field: keyof typeof emptyPayload,
    options: UserListItem[]
  ) {
    return (
      <label>
        {label}
        <select value={form[field]} onChange={(event) => updateField(field, event.target.value)}>
          <option value="">Можно назначить позже</option>
          {options.map((user) => (
            <option key={user.id} value={user.id}>
              {userOptionLabel(user)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="create-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-dialog-title"
      >
        <header className="create-project-dialog-head">
          <div>
            <p className="muted small">новая карточка newsroom</p>
            <h3 id="create-project-dialog-title">Создать карточку</h3>
          </div>
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            Закрыть
          </button>
        </header>

        <div className="create-mode-toggle" aria-label="Тип создаваемой карточки">
          <button
            type="button"
            className={mode === "source" ? "active" : ""}
            onClick={() => setMode("source")}
          >
            Исходники / материал
          </button>
          <button
            type="button"
            className={mode === "story" ? "active" : ""}
            disabled={!canCreateStory}
            title={!canCreateStory ? "Сюжет в работу создают автор, редактор или администратор" : undefined}
            onClick={() => {
              if (canCreateStory) {
                setMode("story");
              }
            }}
          >
            Сюжет в работу
          </button>
        </div>

        <form onSubmit={(event) => void submit(event)}>
          <div className="create-project-form">
            <label>
              Дата материала
              <input
                type="date"
                value={form.storyDate}
                onChange={(event) => updateField("storyDate", event.target.value)}
              />
            </label>
            <label>
              Название
              <input
                value={form.title}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder={mode === "source" ? "Короткое имя исходников" : "Название сюжета"}
                autoFocus
              />
            </label>
            {mode === "story" ? (
              <label>
                Рубрика
                <input
                  value={form.rubric}
                  onChange={(event) => updateField("rubric", event.target.value)}
                  placeholder="Новости, производство, безопасность"
                />
              </label>
            ) : null}
            <label className="create-project-form-wide">
              Путь к исходникам / архиву
              <input
                value={form.sourcePath}
                onChange={(event) => updateField("sourcePath", event.target.value)}
                placeholder="\\\\server\\share\\news\\..."
              />
            </label>

            {mode === "story" ? (
              <div className="create-project-assignees create-project-form-wide">
                <div>
                  <strong>Назначения</strong>
                  <span className="muted small">
                    Пустые роли останутся в карточке как можно назначить позже.
                  </span>
                </div>
                {renderUserSelect("Автор / ответственный за текст", "authorUserId", authorUsers)}
                {renderUserSelect("Корректор", "proofreaderUserId", proofreaderUsers)}
                {renderUserSelect("Ответственный за монтаж", "editAssigneeUserId", editUsers)}
                {renderUserSelect("Ответственный за титры", "titlesAssigneeUserId", titlesUsers)}
              </div>
            ) : null}
          </div>

          {loadingUsers && mode === "story" ? (
            <p className="muted small">Загружаю участников...</p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}

          <footer className="create-project-dialog-actions">
            <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button type="submit" disabled={submitting || (mode === "story" && loadingUsers)}>
              {submitting ? "Создание..." : "Создать карточку"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
