import { useCallback, useEffect, useState } from "react";

import AppRouter from "./app/AppRouter";
import AppFooter from "./components/AppFooter";
import ChangePasswordForm from "./components/ChangePasswordForm";
import LoginForm from "./components/LoginForm";
import { changePassword, getCurrentUser, login, logout } from "./shared/api/client";
import type { CurrentUser } from "./shared/contracts";

function ProductHeader() {
  return (
    <header className="auth-identity">
      <p>Редакционный эфир</p>
      <h1>Newscast Navigator</h1>
      <span>Единая рабочая цепочка сюжета</span>
    </header>
  );
}

export default function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [passwordScreen, setPasswordScreen] = useState(false);

  useEffect(() => {
    void getCurrentUser()
      .then((currentUser) => {
        setUser(currentUser);
        setPasswordScreen(currentUser.must_change_password);
      })
      .catch(() => setUser(null))
      .finally(() => setBootstrapping(false));
  }, []);

  const handleLogin = useCallback(async (username: string, password: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await login(username, password);
      setUser(response.user);
      setPasswordScreen(response.user.must_change_password);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ошибка авторизации");
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePasswordChange = useCallback(async (currentPassword: string, newPassword: string) => {
    setLoading(true);
    setError("");
    try {
      await changePassword({ current_password: currentPassword, new_password: newPassword });
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      setPasswordScreen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сменить пароль");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await logout();
      setUser(null);
      setPasswordScreen(false);
      window.history.replaceState({}, "", "/stories");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось завершить сессию");
    } finally {
      setLoading(false);
    }
  }, []);

  if (bootstrapping || !user || passwordScreen) {
    return (
      <div className="layout auth-layout">
        <main>
          <ProductHeader />
          {bootstrapping ? <p className="muted" role="status">Проверка сессии...</p> : null}
          {!bootstrapping && !user ? <LoginForm onSubmit={handleLogin} loading={loading} /> : null}
          {!bootstrapping && user && passwordScreen ? (
            <ChangePasswordForm loading={loading} required={user.must_change_password} onSubmit={handlePasswordChange} onCancel={user.must_change_password ? undefined : () => setPasswordScreen(false)} />
          ) : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
        </main>
        <AppFooter />
      </div>
    );
  }

  return <AppRouter user={user} onOpenChangePassword={() => setPasswordScreen(true)} onLogout={() => void handleLogout()} />;
}
