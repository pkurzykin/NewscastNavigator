import { useEffect, useState } from "react";

import LoginForm from "./components/LoginForm";
import EditorPage from "./pages/EditorPage";
import MainPage from "./pages/MainPage";
import { getCurrentUser, login } from "./shared/api";
import type { UserPublic } from "./shared/types";

const TOKEN_STORAGE_KEY = "nn_web_auth_token";
const USER_STORAGE_KEY = "nn_web_auth_user";
type AppView = "main" | "editor";

export default function App() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [token, setToken] = useState<string>("");
  const [view, setView] = useState<AppView>("main");
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
    if (!savedToken) {
      setBootstrapping(false);
      return;
    }

    setToken(savedToken);
    void (async () => {
      try {
        const currentUser = await getCurrentUser(savedToken);
        setUser(currentUser);

        const serializedUser = JSON.stringify(currentUser);
        window.localStorage.setItem(USER_STORAGE_KEY, serializedUser);
      } catch (_error) {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
        setToken("");
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  async function handleLogin(username: string, password: string): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const payload = await login(username, password);
      setToken(payload.access_token);
      setUser(payload.user);
      setView("main");
      setActiveProjectId(null);
      window.localStorage.setItem(TOKEN_STORAGE_KEY, payload.access_token);
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(payload.user));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ошибка авторизации"
      );
    } finally {
      setLoading(false);
    }
  }

  function handleLogout(): void {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(USER_STORAGE_KEY);
    setToken("");
    setUser(null);
    setView("main");
    setActiveProjectId(null);
    setError("");
  }

  function handleOpenEditor(projectId: number): void {
    setActiveProjectId(projectId);
    setView("editor");
  }

  function handleBackToMain(): void {
    setView("main");
    setActiveProjectId(null);
  }

  return (
    <main className="layout">
      <header className="header">
        <h1>Newscast Navigator Web</h1>
        <p className="muted">
          Web migration: FastAPI + PostgreSQL + React
        </p>
      </header>

      {bootstrapping ? <p className="muted">Проверка сессии...</p> : null}
      {!bootstrapping && !user ? (
        <LoginForm onSubmit={handleLogin} loading={loading} />
      ) : null}
      {!bootstrapping && user && view === "main" ? (
        <MainPage
          user={user}
          token={token}
          onLogout={handleLogout}
          onOpenEditor={handleOpenEditor}
        />
      ) : null}
      {!bootstrapping && user && view === "editor" && activeProjectId ? (
        <EditorPage
          user={user}
          token={token}
          projectId={activeProjectId}
          onBackToMain={handleBackToMain}
        />
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
