import type { ReactNode } from "react";
import Button from "@mui/material/Button";

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
            <svg className="app-shell-mark" aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 8v6M7 4v14M11 7v8M15 2v18M19 6v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <p className="visually-hidden">Редакционный эфир</p>
            <h1>Newscast Navigator</h1>
          </a>

          <nav className="app-shell-nav" aria-label="Основные разделы">
            <Button component="a" href="/stories" aria-current={activeSection === "stories" || activeSection === "story" ? "page" : undefined}>Сюжеты</Button>
            <Button component="a" href="/archive" aria-current={activeSection === "archive" ? "page" : undefined}>Архив</Button>
            {canManageUsers ? (
              <Button component="a" href="/admin" aria-current={activeSection === "admin" ? "page" : undefined}>Сотрудники</Button>
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
