import type { ReactNode } from "react";

import { BRAND } from "../../shared/brand";
import type { CurrentUser } from "../../shared/contracts";
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
        <div className="app-shell-brand">
          <img
            className="app-shell-logo"
            src={BRAND.logoPath}
            alt={`${BRAND.companyName} logo`}
            width="1307"
            height="132"
          />
          <div>
            <p>{BRAND.companyName}</p>
            <h1>{BRAND.appName}</h1>
          </div>
        </div>

        <nav className="app-shell-nav" aria-label="Основные разделы">
          <a href="/stories" className={activeSection === "stories" || activeSection === "story" ? "active" : ""} aria-current={activeSection === "stories" || activeSection === "story" ? "page" : undefined}>Сюжеты</a>
          <a href="/archive" className={activeSection === "archive" ? "active" : ""} aria-current={activeSection === "archive" ? "page" : undefined}>Архив</a>
          {canManageUsers ? (
            <a href="/admin" className={activeSection === "admin" ? "active" : ""} aria-current={activeSection === "admin" ? "page" : undefined}>Сотрудники</a>
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
    </main>
  );
}
