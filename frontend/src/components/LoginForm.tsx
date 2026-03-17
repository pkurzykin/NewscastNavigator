import { useState } from "react";

interface LoginFormProps {
  onSubmit: (username: string, password: string) => Promise<void>;
  loading: boolean;
}

export default function LoginForm({ onSubmit, loading }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className="card"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit(username, password);
      }}
    >
      <h2>Вход в Newscast Navigator Web</h2>

      <label>
        Логин
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
        />
      </label>

      <label>
        Пароль
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      <button type="submit" disabled={loading}>
        {loading ? "Вход..." : "Войти"}
      </button>
    </form>
  );
}
