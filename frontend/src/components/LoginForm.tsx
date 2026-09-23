import { useState } from "react";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";

interface LoginFormProps {
  onSubmit: (username: string, password: string) => Promise<void>;
  loading: boolean;
}

export default function LoginForm({ onSubmit, loading }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className="card auth-form"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit(username, password);
      }}
    >
      <h2>Вход в Newscast Navigator Web</h2>

      <TextField
        label="Логин"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoComplete="username"
        required
      />

      <TextField
        label="Пароль"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        required
      />

      <Button variant="contained" type="submit" disabled={loading}>
        {loading ? "Вход..." : "Войти"}
      </Button>
    </form>
  );
}
