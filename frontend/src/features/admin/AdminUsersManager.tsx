import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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

interface ModalDialogProps {
  labelledBy: string;
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
}

function ModalDialog({
  labelledBy,
  pending,
  onClose,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return undefined;
    if (typeof element.showModal === "function") {
      element.showModal();
    } else {
      element.setAttribute("open", "");
    }
    return () => {
      if (element.open && typeof element.close === "function") {
        element.close();
      } else {
        element.removeAttribute("open");
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="admin-dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      {children}
    </dialog>
  );
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
    if (password.length < 12 || passwordConfirmation.length < 12) {
      setError("Временный пароль должен содержать не менее 12 символов");
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
    <ModalDialog labelledBy="admin-create-title" pending={submitting} onClose={onClose}>
      <header>
        <h3 id="admin-create-title">Добавить сотрудника</h3>
        <button type="button" className="text-button" aria-label="Закрыть" disabled={submitting} onClick={onClose}>×</button>
      </header>
      <form onSubmit={submit}>
        <label>
          Имя
          <input value={displayName} disabled={submitting} required autoFocus onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          Логин
          <input value={username} disabled={submitting} required autoComplete="off" onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Должность
          <input value={position} disabled={submitting} required onChange={(event) => setPosition(event.target.value)} />
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
            required
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
            required
            disabled={submitting}
            autoComplete="new-password"
            onChange={(event) => setPasswordConfirmation(event.target.value)}
          />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <footer>
          <button
            type="submit"
            disabled={
              submitting
              || !displayName.trim()
              || !username.trim()
              || !position.trim()
              || functionCodes.length === 0
              || password.length < 12
              || passwordConfirmation.length < 12
            }
          >
            {submitting ? "Создание..." : "Создать сотрудника"}
          </button>
          <button type="button" className="secondary" disabled={submitting} onClick={onClose}>Отмена</button>
        </footer>
      </form>
    </ModalDialog>
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
    <ModalDialog labelledBy="admin-edit-title" pending={submitting} onClose={onClose}>
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
          <input value={displayName} disabled={submitting} required autoFocus onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          Должность
          <input value={position} disabled={submitting} required onChange={(event) => setPosition(event.target.value)} />
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
    </ModalDialog>
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
    if (password.length < 12 || passwordConfirmation.length < 12) {
      setError("Временный пароль должен содержать не менее 12 символов");
      return;
    }
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
    <ModalDialog labelledBy="admin-reset-title" pending={submitting} onClose={onClose}>
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
            required
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
            required
            disabled={submitting}
            autoComplete="new-password"
            onChange={(event) => setPasswordConfirmation(event.target.value)}
          />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <footer>
          <button
            type="submit"
            disabled={submitting || password.length < 12 || passwordConfirmation.length < 12}
          >
            {submitting ? "Сброс..." : "Сбросить пароль"}
          </button>
          <button type="button" className="secondary" disabled={submitting} onClick={onClose}>Отмена</button>
        </footer>
      </form>
    </ModalDialog>
  );
}

export default function AdminUsersManager({ currentUserId }: AdminUsersManagerProps) {
  const [response, setResponse] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [commandPending, setCommandPending] = useState(false);
  const commandPendingRef = useRef(false);
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);

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

  const runCommand = async (command: () => Promise<unknown>): Promise<boolean> => {
    if (commandPendingRef.current) return false;
    commandPendingRef.current = true;
    setCommandPending(true);
    setCommandError("");
    try {
      await command();
      setCommandError("");
      return true;
    } finally {
      commandPendingRef.current = false;
      setCommandPending(false);
    }
  };

  const submitDialogCommand = async (command: () => Promise<unknown>) => {
    const started = await runCommand(command);
    if (!started) {
      throw new Error("Дождитесь завершения текущей операции");
    }
    void refresh().catch(() => undefined);
  };

  const setActive = async (user: AdminUserItem, isActive: boolean) => {
    if (commandPendingRef.current) return;
    if (!isActive && !window.confirm(`Отключить учётную запись сотрудника «${user.display_name}»?`)) {
      return;
    }
    try {
      const started = await runCommand(() => updateAdminUser(user.id, { is_active: isActive }));
      if (started) void refresh().catch(() => undefined);
    } catch (requestError) {
      setCommandError(errorMessage(requestError, "Не удалось изменить состояние учётной записи"));
    }
  };

  const openDialog = (
    nextDialog: Exclude<DialogState, null>,
    trigger: HTMLButtonElement,
  ) => {
    if (commandPendingRef.current) return;
    setCommandError("");
    dialogTriggerRef.current = trigger;
    setDialog(nextDialog);
  };

  const closeDialog = () => {
    setDialog(null);
    const trigger = dialogTriggerRef.current;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  if (loading && !response) {
    return <p className="muted" role="status">Загрузка сотрудников...</p>;
  }

  if (!response) {
    return (
      <section className="admin-load-error">
        <p className="error" role="alert">{loadError || "Не удалось загрузить сотрудников"}</p>
        <button type="button" className="secondary" disabled={commandPending} onClick={() => void refresh().catch(() => undefined)}>Повторить</button>
      </section>
    );
  }

  const functionLabels = new Map(response.function_options.map((option) => [option.code, option.label]));

  return (
    <section className="admin-users-manager">
      <div className="admin-users-toolbar">
        <button
          type="button"
          disabled={commandPending}
          onClick={(event) => openDialog({ kind: "create" }, event.currentTarget)}
        >
          Добавить сотрудника
        </button>
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
                        disabled={commandPending}
                        onClick={(event) => openDialog({ kind: "edit", user }, event.currentTarget)}
                      >
                        Изменить
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        aria-label={`Сбросить пароль ${user.display_name}`}
                        disabled={commandPending}
                        onClick={(event) => openDialog({ kind: "reset", user }, event.currentTarget)}
                      >
                        Сбросить пароль
                      </button>
                      <button
                        type="button"
                        className={user.is_active ? "text-button admin-danger-action" : "text-button"}
                        aria-label={`${user.is_active ? "Отключить" : "Активировать"} ${user.display_name}`}
                        disabled={commandPending}
                        onClick={() => void setActive(user, !user.is_active)}
                      >
                        {user.is_active ? "Отключить" : "Активировать"}
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
          submitting={commandPending}
          onClose={closeDialog}
          onSubmit={(payload) => submitDialogCommand(() => createAdminUser(payload))}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <EditDialog
          user={dialog.user}
          functionOptions={response.function_options}
          submitting={commandPending}
          onClose={closeDialog}
          onSubmit={(payload) => submitDialogCommand(() => updateAdminUser(dialog.user.id, payload))}
        />
      ) : null}
      {dialog?.kind === "reset" ? (
        <ResetPasswordDialog
          user={dialog.user}
          submitting={commandPending}
          onClose={closeDialog}
          onSubmit={(payload) => submitDialogCommand(() => resetAdminUserPassword(dialog.user.id, payload))}
        />
      ) : null}
    </section>
  );
}
