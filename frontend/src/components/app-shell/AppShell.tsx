import type { ReactNode } from "react";

import { BRAND } from "../../shared/brand";
import type { UserPublic } from "../../shared/types";
import UserProfileMenu from "./UserProfileMenu";

export type AppShellSection = "queue" | "story" | "admin";

interface AppShellProps {
  user: UserPublic;
  activeSection: AppShellSection;
  onOpenQueue: () => void;
  onOpenChangePassword: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export default function AppShell({
  user,
  activeSection,
  onOpenQueue,
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
          <button
            type="button"
            className={activeSection === "queue" ? "active" : ""}
            aria-current={activeSection === "queue" ? "page" : undefined}
            onClick={onOpenQueue}
          >
            Список сюжетов
          </button>
          <span
            className={activeSection === "story" ? "active" : ""}
            aria-current={activeSection === "story" ? "page" : undefined}
          >
            Карточка сюжета
          </span>
        </nav>

        <UserProfileMenu
          user={user}
          onOpenChangePassword={onOpenChangePassword}
          onLogout={onLogout}
        />
      </header>

      <section className="app-shell-content">{children}</section>
    </main>
  );
}
