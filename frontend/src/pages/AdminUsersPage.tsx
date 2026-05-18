import { useCallback, useEffect, useState } from "react";

import {
  createUser,
  fetchUsers,
  resetUserTemporaryPassword,
  updateUser,
} from "../shared/api";
import {
  USER_ROLE_LABELS,
  USER_ROLE_ORDER,
} from "../shared/labels";
import type {
  UserListItem,
  UserPublic,
} from "../shared/types";

const USER_ROLE_OPTIONS = USER_ROLE_ORDER.map((value) => ({
  value,
  label: USER_ROLE_LABELS[value]
}));

interface AdminUsersPageProps {
  token: string;
  user: UserPublic;
}

export default function AdminUsersPage({ token, user }: AdminUsersPageProps) {
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [managedUsers, setManagedUsers] = useState<UserListItem[]>([]);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserFullName, setNewUserFullName] = useState("");
  const [newUserJobTitle, setNewUserJobTitle] = useState("");
  const [newUserRole, setNewUserRole] = useState("author");
  const [lastTemporaryPassword, setLastTemporaryPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadManagedUsers = useCallback(async () => {
    if (user.role !== "admin") {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await fetchUsers(token);
      setManagedUsers(payload.items || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить пользователей");
    } finally {
      setLoading(false);
    }
  }, [token, user.role]);

  useEffect(() => {
    void loadManagedUsers();
  }, [loadManagedUsers]);

  async function handleCreateUser(): Promise<void> {
    if (!newUserUsername.trim()) {
      return;
    }
    setActionLoading(true);
    setError("");
    setSuccess("");
    try {
      const payload = await createUser(token, {
        username: newUserUsername.trim(),
        full_name: newUserFullName.trim() || null,
        job_title: newUserJobTitle.trim() || null,
        role: newUserRole,
      });
      setLastTemporaryPassword(`${payload.user.username}: ${payload.temporary_password}`);
      setSuccess(payload.message);
      setNewUserUsername("");
      setNewUserFullName("");
      setNewUserJobTitle("");
      setNewUserRole("author");
      await loadManagedUsers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось создать пользователя");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUpdateManagedUser(
    userId: number,
    payload: {
      full_name?: string | null;
      job_title?: string | null;
      role?: string | null;
      is_active?: boolean | null;
    }
  ): Promise<void> {
    setActionLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await updateUser(token, userId, payload);
      setSuccess(response.message);
      setManagedUsers((previous) =>
        previous.map((item) => (item.id === userId ? response.user : item))
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось обновить пользователя");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResetManagedUserPassword(userId: number): Promise<void> {
    setActionLoading(true);
    setError("");
    setSuccess("");
    try {
      const payload = await resetUserTemporaryPassword(token, userId);
      setLastTemporaryPassword(`${payload.user.username}: ${payload.temporary_password}`);
      setSuccess(payload.message);
      setManagedUsers((previous) =>
        previous.map((item) => (item.id === userId ? payload.user : item))
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сбросить временный пароль");
    } finally {
      setActionLoading(false);
    }
  }

  if (user.role !== "admin") {
    return (
      <section className="main-workspace">
        <section className="main-hero">
          <div>
            <p className="muted small">администрирование</p>
            <h2>Недоступно</h2>
            <p className="muted">Управление пользователями доступно только администратору.</p>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="main-workspace">
      <section className="main-hero">
        <div>
          <p className="muted small">администрирование</p>
          <h2>Пользователи</h2>
          <p className="muted">
            Учетные записи, роли, деактивация и сброс временных паролей отдельно от списка сюжетов.
          </p>
        </div>
        <div className="main-user-actions">
          <button
            type="button"
            className="secondary"
            disabled={loading || actionLoading}
            onClick={() => void loadManagedUsers()}
          >
            {loading ? "Загрузка..." : "Обновить пользователей"}
          </button>
        </div>
      </section>

      <div className="card">
        <div className="filters-grid">
          <label>
            Логин
            <input value={newUserUsername} onChange={(event) => setNewUserUsername(event.target.value)} />
          </label>
          <label>
            ФИО
            <input value={newUserFullName} onChange={(event) => setNewUserFullName(event.target.value)} />
          </label>
          <label>
            Должность
            <input value={newUserJobTitle} onChange={(event) => setNewUserJobTitle(event.target.value)} />
          </label>
          <label>
            Роль
            <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}>
              {USER_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="muted small">
          Роль "Оператор" доступна для учета пользователей. Права оператора на работу с материалами
          требуют отдельного backend-этапа.
        </p>

        <div className="row controls wrap">
          <button
            type="button"
            disabled={actionLoading || !newUserUsername.trim()}
            onClick={() => void handleCreateUser()}
          >
            {actionLoading ? "Сохранение..." : "Создать пользователя"}
          </button>
          {lastTemporaryPassword ? (
            <span className="muted">
              Временный пароль: <strong>{lastTemporaryPassword}</strong>
            </span>
          ) : null}
        </div>
      </div>

      <div className="workspace-list">
        {managedUsers.length === 0 ? <p className="muted">Пользователи не загружены</p> : null}
        {managedUsers.map((managedUser) => (
          <div key={managedUser.id} className="workspace-item">
            <p>
              <strong>{managedUser.username}</strong> · {managedUser.is_active ? "активен" : "деактивирован"} ·{" "}
              {managedUser.must_change_password ? "ждет смены пароля" : "пароль установлен"}
            </p>
            <div className="filters-grid">
              <label>
                ФИО
                <input
                  value={managedUser.full_name || ""}
                  disabled={actionLoading}
                  onChange={(event) =>
                    setManagedUsers((previous) =>
                      previous.map((item) =>
                        item.id === managedUser.id ? { ...item, full_name: event.target.value } : item
                      )
                    )
                  }
                />
              </label>
              <label>
                Должность
                <input
                  value={managedUser.job_title || ""}
                  disabled={actionLoading}
                  onChange={(event) =>
                    setManagedUsers((previous) =>
                      previous.map((item) =>
                        item.id === managedUser.id ? { ...item, job_title: event.target.value } : item
                      )
                    )
                  }
                />
              </label>
              <label>
                Роль
                <select
                  value={managedUser.role}
                  disabled={actionLoading}
                  onChange={(event) =>
                    setManagedUsers((previous) =>
                      previous.map((item) =>
                        item.id === managedUser.id ? { ...item, role: event.target.value } : item
                      )
                    )
                  }
                >
                  {USER_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Активность
                <select
                  value={managedUser.is_active ? "active" : "inactive"}
                  disabled={actionLoading}
                  onChange={(event) =>
                    setManagedUsers((previous) =>
                      previous.map((item) =>
                        item.id === managedUser.id
                          ? { ...item, is_active: event.target.value === "active" }
                          : item
                      )
                    )
                  }
                >
                  <option value="active">Активен</option>
                  <option value="inactive">Деактивирован</option>
                </select>
              </label>
            </div>
            <div className="row controls wrap">
              <button
                type="button"
                className="secondary"
                disabled={actionLoading}
                onClick={() =>
                  void handleUpdateManagedUser(managedUser.id, {
                    full_name: managedUser.full_name || null,
                    job_title: managedUser.job_title || null,
                    role: managedUser.role,
                    is_active: managedUser.is_active,
                  })
                }
              >
                {actionLoading ? "Сохранение..." : "Сохранить"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={actionLoading}
                onClick={() => void handleResetManagedUserPassword(managedUser.id)}
              >
                {actionLoading ? "Сброс..." : "Сбросить временный пароль"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}
    </section>
  );
}
