import type { ReactNode } from "react";

import { BRAND } from "../shared/brand";
import type { UserPublic } from "../shared/types";
import UserProfileMenu from "./UserProfileMenu";

export type AppSection =
  | "my_work"
  | "management"
  | "production"
  | "all_projects"
  | "archive"
  | "admin";

interface AppShellProps {
  user: UserPublic;
  activeSection: AppSection;
  children: ReactNode;
  onNavigate: (section: AppSection) => void;
  onLogout: () => void;
  onOpenChangePassword: () => void;
}

const NAV_ITEMS: Array<{ key: AppSection; label: string }> = [
  { key: "my_work", label: "Моя работа" },
  { key: "management", label: "Управление" },
  { key: "production", label: "Производство" },
  { key: "all_projects", label: "Все сюжеты" },
  { key: "archive", label: "Архив" },
  { key: "admin", label: "Администрирование" },
];

export default function AppShell({
  user,
  activeSection,
  children,
  onNavigate,
  onLogout,
  onOpenChangePassword,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-brand">
          <img src={BRAND.logoPath} alt={`${BRAND.companyName} логотип`} />
          <div>
            <strong>{BRAND.appName}</strong>
            <span>карточка сюжета и производство</span>
          </div>
        </div>
        <nav className="app-sidebar-nav" aria-label="Основная навигация">
          {NAV_ITEMS.filter((item) => item.key !== "admin" || user.role === "admin").map(
            (item) => (
              <button
                key={item.key}
                type="button"
                className={
                  item.key === activeSection
                    ? "app-sidebar-nav-item active"
                    : "app-sidebar-nav-item"
                }
                onClick={() => onNavigate(item.key)}
              >
                {item.label}
              </button>
            )
          )}
        </nav>
        <UserProfileMenu
          user={user}
          onLogout={onLogout}
          onOpenChangePassword={onOpenChangePassword}
        />
      </aside>
      <section className="app-content">{children}</section>
    </div>
  );
}
