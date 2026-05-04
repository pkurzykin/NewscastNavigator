import { Suspense, lazy, useEffect, useState } from "react";

import ChangePasswordForm from "./components/ChangePasswordForm";
import LoginForm from "./components/LoginForm";
import { changePassword, getCurrentUser, login } from "./shared/api";
import { BRAND } from "./shared/brand";
import type { UserPublic } from "./shared/types";

const TOKEN_STORAGE_KEY = "nn_web_auth_token";
const USER_STORAGE_KEY = "nn_web_auth_user";
type AppView = "main" | "editor" | "change_password";

const MainPage = lazy(() => import("./pages/MainPage"));
const EditorPage = lazy(() => import("./pages/EditorPage"));

export default function App() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [token, setToken] = useState<string>("");
  const [view, setView] = useState<AppView>("main");
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);

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
        setPasswordRequired(Boolean(currentUser.must_change_password));
        if (currentUser.must_change_password) {
          setView("change_password");
        }

        const serializedUser = JSON.stringify(currentUser);
        window.localStorage.setItem(USER_STORAGE_KEY, serializedUser);
      } catch (_error) {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
        setToken("");
        setPasswordRequired(false);
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
      const mustChangePassword = Boolean(payload.user.must_change_password);
      setPasswordRequired(mustChangePassword);
      setView(mustChangePassword ? "change_password" : "main");
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
    setPasswordRequired(false);
  }

  function handleOpenEditor(projectId: number): void {
    setActiveProjectId(projectId);
    setView("editor");
  }

  function handleBackToMain(): void {
    setView("main");
    setActiveProjectId(null);
  }

  async function handlePasswordChange(currentPassword: string, newPassword: string): Promise<void> {
    setLoading(true);
    setError("");
    try {
      await changePassword(token, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      const currentUser = await getCurrentUser(token);
      setUser(currentUser);
      setPasswordRequired(Boolean(currentUser.must_change_password));
      setView("main");
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сменить пароль");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChangePassword(): void {
    setView("change_password");
  }

  const usesShell = !bootstrapping && Boolean(user) && view === "main";

  return (
    <main className={usesShell ? "layout layout-shell" : "layout"}>
      {!usesShell ? (
      <header className="header">
        <div className="brand-header">
          <img className="brand-header-logo" src={BRAND.logoPath} alt={`${BRAND.companyName} логотип`} />
          <div>
            <h1>{BRAND.appName}</h1>
            <p className="muted">{BRAND.companyName} · newsroom workflow платформа</p>
          </div>
        </div>
      </header>
      ) : null}

      {bootstrapping ? <p className="muted">Проверка сессии...</p> : null}
      {!bootstrapping && !user ? (
        <LoginForm onSubmit={handleLogin} loading={loading} />
      ) : null}
      {!bootstrapping && user && view === "change_password" ? (
        <ChangePasswordForm
          loading={loading}
          required={passwordRequired}
          onSubmit={handlePasswordChange}
          onCancel={!passwordRequired ? handleBackToMain : undefined}
        />
      ) : null}
      {!bootstrapping && user && view === "main" ? (
        <Suspense fallback={<p className="muted">Загрузка рабочего экрана...</p>}>
          <MainPage
            user={user}
            token={token}
            onLogout={handleLogout}
            onOpenEditor={handleOpenEditor}
            onOpenChangePassword={handleOpenChangePassword}
          />
        </Suspense>
      ) : null}
      {!bootstrapping && user && !passwordRequired && view === "editor" && activeProjectId ? (
        <Suspense fallback={<p className="muted">Загрузка редактора...</p>}>
          <EditorPage
            user={user}
            token={token}
            projectId={activeProjectId}
            onBackToMain={handleBackToMain}
          />
        </Suspense>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
