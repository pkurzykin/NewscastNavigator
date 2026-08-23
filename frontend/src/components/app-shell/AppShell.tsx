import type { ReactNode } from "react";

import { APP_VERSION } from "../../appVersion";
import NotificationTray from "../../features/notifications/components/NotificationTray";
import { useWorkspaceRefreshClock } from "../../features/notifications/useWorkspaceRefreshClock";
import { RELEASE_NOTES } from "../../features/release-notes/releaseNotes";
import WhatsNewDialog from "../../features/release-notes/WhatsNewDialog";
import type { CurrentUser } from "../../shared/contracts";
import AppFooter from "../AppFooter";
import UserProfileMenu from "./UserProfileMenu";

export type AppShellSection = "stories" | "archive" | "story" | "admin";

interface AppShellProps {
  user: CurrentUser;
  activeSection: AppShellSection;
  canManageUsers: boolean;
  onOpenChangePassword: () => void;
  onLogout: () => void;
  children: ReactNode;
}

const handleReleaseNotesDismiss = () => undefined;

export default function AppShell({
  user,
  activeSection,
  canManageUsers,
  onOpenChangePassword,
  onLogout,
  children,
}: AppShellProps) {
  useWorkspaceRefreshClock();

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <div className="app-shell-header-inner">
          <a className="app-shell-identity" href="/stories" aria-label="На главную">
            <p>Редакционный эфир</p>
            <h1>Newscast Navigator</h1>
          </a>

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
        </div>
      </header>

      <main className="app-shell-content">{children}</main>
      <AppFooter />
      <WhatsNewDialog
        userId={user.id}
        version={APP_VERSION}
        releaseNote={RELEASE_NOTES[APP_VERSION]}
        onDismiss={handleReleaseNotesDismiss}
      />
    </div>
  );
}
