import type { ReactNode } from "react";

import type { CurrentUser } from "../../shared/contracts";
import AppFooter from "../AppFooter";
import UserProfileMenu from "./UserProfileMenu";
import NotificationTray from "../../features/notifications/components/NotificationTray";

export type AppShellSection = "stories" | "archive" | "story" | "admin";

interface AppShellProps {
  user: CurrentUser;
  activeSection: AppShellSection;
  canManageUsers: boolean;
  onOpenChangePassword: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export default function AppShell({
  user,
  activeSection,
  canManageUsers,
  onOpenChangePassword,
  onLogout,
  children,
}: AppShellProps) {
  return (
    <main className="app-shell">
      <header className="app-shell-header">
        <div className="app-shell-identity">
          <p>Редакционный эфир</p>
          <h1>Newscast Navigator</h1>
        </div>

        <nav className="app-shell-nav" aria-label="Основные разделы">
          <a href="/stories" aria-current={activeSection === "stories" || activeSection === "story" ? "page" : undefined}>Сюжеты</a>
          <a href="/archive" aria-current={activeSection === "archive" ? "page" : undefined}>Архив</a>
          {canManageUsers ? (
            <a href="/admin" aria-current={activeSection === "admin" ? "page" : undefined}>Сотрудники</a>
          ) : null}
        </nav>

        <div className="app-shell-tools">
          <NotificationTray />
          <UserProfileMenu
            user={user}
            onOpenChangePassword={onOpenChangePassword}
            onLogout={onLogout}
          />
        </div>
      </header>

      <section className="app-shell-content">{children}</section>
      <AppFooter />
    </main>
  );
}
