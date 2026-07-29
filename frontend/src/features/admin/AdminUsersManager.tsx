import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  createAdminUser,
  fetchAdminUsers,
  resetAdminUserPassword,
  updateAdminUser,
} from "./api";
import type {
  AdminUserItem,
  AdminUsersResponse,
  CreateAdminUserPayload,
  ResetAdminUserPasswordPayload,
  UpdateAdminUserPayload,
} from "./types";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; user: AdminUserItem }
  | { kind: "reset"; user: AdminUserItem }
  | null;

interface AdminUsersManagerProps {
  currentUserId: number;
}

interface FunctionOptionsProps {
  options: AdminUsersResponse["function_options"];
  selectedCodes: string[];
  disabled: boolean;
  onChange: (codes: string[]) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function FunctionOptions({
  options,
  selectedCodes,
  disabled,
  onChange,
}: FunctionOptionsProps) {
  return (
    <fieldset className="admin-function-options">
      <legend>Функции</legend>
      <div>
        {options.map((option) => {
          const checked = selectedCodes.includes(option.code);
          return (
            <label key={option.code} className="admin-function-option">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  onChange(
                    checked
                      ? selectedCodes.filter((code) => code !== option.code)
                      : [...selectedCodes, option.code],
                  );
                }}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface CreateDialogProps {
  functionOptions: AdminUsersResponse["function_options"];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateAdminUserPayload) => Promise<void>;
}

function CreateDialog({
  functionOptions,
  submitting,
  onClose,
  onSubmit,
}: CreateDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [position, setPosition] = useState("");
  const [functionCodes, setFunctionCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const payload = {
      username: username.trim(),
      display_name: displayName.trim(),
      position: position.trim(),
      function_codes: functionOptions
        .filter((option) => functionCodes.includes(option.code))
        .map((option) => option.code),
      temporary_password: password,
    };
    if (!payload.username || !payload.display_name || !payload.position) {
      setError("Заполните имя, логин и должность");
      return;
    }
    if (payload.function_codes.length === 0) {
      setError("Выберите хотя бы одну функцию");
      return;
    }
    if (password !== passwordConfirmation) {
      setError("Пароли не совпадают");
      return;
    }
    setError("");
    try {
      await onSubmit(payload);
      setPassword("");
      setPasswordConfirmation("");
      onClose();
    } catch (requestError) {
      setError(errorMessage(requestError, "Не удалось добавить сотрудника"));
    }
  };

  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <dialog
        open
        className="admin-dialog"
        aria-modal="true"
        aria-labelledby="admin-create-title"
      >
        <header>
          <h3 id="admin-create-title">Добавить сотрудника</h3>
          <button type="button" className="text-button" aria-label="Закрыть" disabled={submitting} onClick={onClose}>×</button>
        </header>
        <form onSubmit={submit}>
          <label>
            Имя
            <input value={displayName} disabled={submitting} autoFocus onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            Логин
            <input value={username} disabled={submitting} autoComplete="off" onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Должность
            <input value={position} disabled={submitting} onChange={(event) => setPosition(event.target.value)} />
          </label>
          <FunctionOptions
            options={functionOptions}
            selectedCodes={functionCodes}
            disabled={submitting}
            onChange={setFunctionCodes}
          />
          <label>
            Временный пароль
            <input
              type="password"
              value={password}
              minLength={12}
              disabled={submitting}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Повторите пароль
            <input
              type="password"
              value={passwordConfirmation}
              minLength={12}
              disabled={submitting}
              autoComplete="new-password"
              onChange={(event) => setPasswordConfirmation(event.target.value)}
            />
          </label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <footer>
            <button type="submit" disabled={submitting}>
              {submitting ? "Создание..." : "Создать сотрудника"}
            </button>
            <button type="button" className="secondary" disabled={submitting} onClick={onClose}>Отмена</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}

interface EditDialogProps {
  user: AdminUserItem;
  functionOptions: AdminUsersResponse["function_options"];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: UpdateAdminUserPayload) => Promise<void>;
}

function EditDialog({
  user,
  functionOptions,
  submitting,
  onClose,
  onSubmit,
}: EditDialogProps) {
  const allowedCodes = new Set(functionOptions.map((option) => option.code));
  const [displayName, setDisplayName] = useState(user.display_name);
  const [position, setPosition] = useState(user.position);
  const [functionCodes, setFunctionCodes] = useState(
    user.function_codes.filter((code) => allowedCodes.has(code)),
  );
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const payload = {
      display_name: displayName.trim(),
      position: position.trim(),
      function_codes: functionOptions
        .filter((option) => functionCodes.includes(option.code))
        .map((option) => option.code),
    };
    if (!payload.display_name || !payload.position) {
      setError("Заполните имя и должность");
      return;
    }
    if (payload.function_codes.length === 0) {
      setError("Выберите хотя бы одну функцию");
      return;
    }
    setError("");
    try {
      await onSubmit(payload);
      onClose();
    } catch (requestError) {
      setError(errorMessage(requestError, "Не удалось изменить сотрудника"));
    }
  };

  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <dialog open className="admin-dialog" aria-modal="true" aria-labelledby="admin-edit-title">
        <header>
          <div>
            <h3 id="admin-edit-title">Изменить сотрудника</h3>
            <p className="muted">{user.username}</p>
          </div>
          <button type="button" className="text-button" aria-label="Закрыть" disabled={submitting} onClick={onClose}>×</button>
        </header>
        <form onSubmit={submit}>
          <label>
            Имя
            <input value={displayName} disabled={submitting} autoFocus onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            Должность
            <input value={position} disabled={submitting} onChange={(event) => setPosition(event.target.value)} />
          </label>
          <FunctionOptions
            options={functionOptions}
            selectedCodes={functionCodes}
            disabled={submitting}
            onChange={setFunctionCodes}
          />
          {error ? <p className="error" role="alert">{error}</p> : null}
          <footer>
            <button type="submit" disabled={submitting}>
              {submitting ? "Сохранение..." : "Сохранить изменения"}
            </button>
            <button type="button" className="secondary" disabled={submitting} onClick={onClose}>Отмена</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}

interface ResetPasswordDialogProps {
  user: AdminUserItem;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: ResetAdminUserPasswordPayload) => Promise<void>;
}

function ResetPasswordDialog({
  user,
  submitting,
  onClose,
  onSubmit,
}: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (password !== passwordConfirmation) {
      setError("Пароли не совпадают");
      return;
    }
    setError("");
    try {
      await onSubmit({ temporary_password: password });
      setPassword("");
      setPasswordConfirmation("");
      onClose();
    } catch (requestError) {
      setError(errorMessage(requestError, "Не удалось сбросить пароль"));
    }
  };

  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <dialog open className="admin-dialog" aria-modal="true" aria-labelledby="admin-reset-title">
        <header>
          <div>
            <h3 id="admin-reset-title">Сбросить пароль</h3>
            <p className="muted">{user.display_name}</p>
          </div>
          <button type="button" className="text-button" aria-label="Закрыть" disabled={submitting} onClick={onClose}>×</button>
        </header>
        <form onSubmit={submit}>
          <label>
            Новый временный пароль
            <input
              type="password"
              value={password}
              minLength={12}
              disabled={submitting}
              autoFocus
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Повторите пароль
            <input
              type="password"
              value={passwordConfirmation}
              minLength={12}
              disabled={submitting}
              autoComplete="new-password"
              onChange={(event) => setPasswordConfirmation(event.target.value)}
            />
          </label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <footer>
            <button type="submit" disabled={submitting}>
              {submitting ? "Сброс..." : "Сбросить пароль"}
            </button>
            <button type="button" className="secondary" disabled={submitting} onClick={onClose}>Отмена</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}

export default function AdminUsersManager({ currentUserId }: AdminUsersManagerProps) {
  const [response, setResponse] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setResponse(await fetchAdminUsers());
    } catch (requestError) {
      setLoadError(errorMessage(requestError, "Не удалось загрузить сотрудников"));
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const submitDialogCommand = async (command: () => Promise<unknown>) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await command();
      await refresh().catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const setActive = async (user: AdminUserItem, isActive: boolean) => {
    if (pendingUserId !== null) return;
    if (!isActive && !window.confirm(`Отключить учётную запись сотрудника «${user.display_name}»?`)) {
      return;
    }
    setPendingUserId(user.id);
    setCommandError("");
    try {
      await updateAdminUser(user.id, { is_active: isActive });
      await refresh().catch(() => undefined);
    } catch (requestError) {
      setCommandError(errorMessage(requestError, "Не удалось изменить состояние учётной записи"));
    } finally {
      setPendingUserId(null);
    }
  };

  if (loading && !response) {
    return <p className="muted" role="status">Загрузка сотрудников...</p>;
  }

  if (!response) {
    return (
      <section className="admin-load-error">
        <p className="error" role="alert">{loadError || "Не удалось загрузить сотрудников"}</p>
        <button type="button" className="secondary" onClick={() => void refresh().catch(() => undefined)}>Повторить</button>
      </section>
    );
  }

  const functionLabels = new Map(response.function_options.map((option) => [option.code, option.label]));

  return (
    <section className="admin-users-manager">
      <div className="admin-users-toolbar">
        <button type="button" onClick={() => setDialog({ kind: "create" })}>Добавить сотрудника</button>
        {loading ? <span className="muted small" role="status">Обновление списка...</span> : null}
      </div>

      {loadError ? <p className="error" role="alert">{loadError}</p> : null}
      {commandError ? <p className="error" role="alert">{commandError}</p> : null}

      <div className="admin-users-table-wrap">
        <table className="admin-users-table" aria-label="Сотрудники">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Логин</th>
              <th>Должность</th>
              <th>Функции</th>
              <th>Учётная запись</th>
              <th>Пароль</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {response.items.map((user) => {
              const labels = user.function_codes
                .map((code) => functionLabels.get(code))
                .filter((label): label is string => Boolean(label));
              const pending = pendingUserId === user.id;
              return (
                <tr key={user.id} data-current-user={user.id === currentUserId || undefined}>
                  <td>{user.display_name}</td>
                  <td>{user.username}</td>
                  <td>{user.position}</td>
                  <td>{labels.join(", ") || "Не указаны"}</td>
                  <td>{user.is_active ? "Активна" : "Отключена"}</td>
                  <td>{user.must_change_password ? "Требуется смена" : "Установлен"}</td>
                  <td>
                    <div className="admin-user-actions">
                      <button
                        type="button"
                        className="text-button"
                        aria-label={`Изменить ${user.display_name}`}
                        disabled={pendingUserId !== null || submitting}
                        onClick={() => setDialog({ kind: "edit", user })}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        aria-label={`Сбросить пароль ${user.display_name}`}
                        disabled={pendingUserId !== null || submitting}
                        onClick={() => setDialog({ kind: "reset", user })}
                      >
                        Сбросить пароль
                      </button>
                      <button
                        type="button"
                        className={user.is_active ? "text-button admin-danger-action" : "text-button"}
                        aria-label={`${user.is_active ? "Отключить" : "Активировать"} ${user.display_name}`}
                        disabled={pendingUserId !== null || submitting}
                        onClick={() => void setActive(user, !user.is_active)}
                      >
                        {pending ? "Сохранение..." : user.is_active ? "Отключить" : "Активировать"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog?.kind === "create" ? (
        <CreateDialog
          functionOptions={response.function_options}
          submitting={submitting}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => submitDialogCommand(() => createAdminUser(payload))}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <EditDialog
          user={dialog.user}
          functionOptions={response.function_options}
          submitting={submitting}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => submitDialogCommand(() => updateAdminUser(dialog.user.id, payload))}
        />
      ) : null}
      {dialog?.kind === "reset" ? (
        <ResetPasswordDialog
          user={dialog.user}
          submitting={submitting}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => submitDialogCommand(() => resetAdminUserPassword(dialog.user.id, payload))}
        />
      ) : null}
    </section>
  );
}
