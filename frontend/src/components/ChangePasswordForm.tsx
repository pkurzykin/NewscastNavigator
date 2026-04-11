import { useState } from "react";

interface ChangePasswordFormProps {
  loading: boolean;
  required: boolean;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
  onCancel?: () => void;
}

export default function ChangePasswordForm({
  loading,
  required,
  onSubmit,
  onCancel,
}: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState("");

  return (
    <form
      className="card"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        if (newPassword !== repeatPassword) {
          setError("Новый пароль и подтверждение не совпадают");
          return;
        }
        await onSubmit(currentPassword, newPassword);
        setCurrentPassword("");
        setNewPassword("");
        setRepeatPassword("");
      }}
    >
      <h2>{required ? "Нужно сменить временный пароль" : "Смена пароля"}</h2>
      <p className="muted">
        {required
          ? "Первый вход выполнен по временному паролю. Прежде чем продолжить работу, установи постоянный пароль."
          : "Пароль должен быть не короче 12 символов."}
      </p>

      <label>
        Текущий пароль
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      <label>
        Новый пароль
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>

      <label>
        Повтори новый пароль
        <input
          type="password"
          value={repeatPassword}
          onChange={(event) => setRepeatPassword(event.target.value)}
          autoComplete="new-password"
          minLength={12}
          required
        />
      </label>

      {error ? <p className="error">{error}</p> : null}

      <div className="row wrap">
        <button type="submit" disabled={loading}>
          {loading ? "Сохранение..." : "Установить пароль"}
        </button>
        {!required && onCancel ? (
          <button type="button" className="secondary" onClick={onCancel} disabled={loading}>
            Назад
          </button>
        ) : null}
      </div>
    </form>
  );
}
