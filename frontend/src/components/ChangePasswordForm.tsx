import { useState } from "react";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";

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
      className="card auth-form"
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

      <TextField
        label="Текущий пароль"
        type="password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        autoComplete="current-password"
        required
      />

      <TextField
        label="Новый пароль"
        type="password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        autoComplete="new-password"
        slotProps={{ htmlInput: { minLength: 12 } }}
        required
      />

      <TextField
        label="Повтори новый пароль"
        type="password"
        value={repeatPassword}
        onChange={(event) => setRepeatPassword(event.target.value)}
        autoComplete="new-password"
        slotProps={{ htmlInput: { minLength: 12 } }}
        required
      />

      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="row wrap">
        <Button variant="contained" type="submit" disabled={loading}>
          {loading ? "Сохранение..." : "Установить пароль"}
        </Button>
        {!required && onCancel ? (
          <Button type="button" variant="outlined" onClick={onCancel} disabled={loading}>
            Назад
          </Button>
        ) : null}
      </div>
    </form>
  );
}
